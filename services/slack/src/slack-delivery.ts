import type { WebhookDelivery, WebhookDispatcher } from "@emulators/core";

const TIMEOUT_MS = 3000;
const RETRY_DELAYS_MS = [0, 60_000, 300_000];
const MAX_LOGGED = 500;
const PENDING_PREFIX = "slack-delivery:pending:";
const LOG_PREFIX = "slack-delivery:log:";
const SEQ_KEY = "slack-delivery:seq";

type RetryReason = "http_timeout" | "http_error" | "connection_failed";

type Pending = {
  id: number;
  event: string;
  body: string;
  retryNum: number;
  dueAt: number;
  reason?: RetryReason;
  firstLogId?: number;
};

type Outcome = { delivery: WebhookDelivery; retry: RetryReason | null };

async function sign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function logKey(id: number): string {
  return `${LOG_PREFIX}${String(id).padStart(12, "0")}`;
}

export class SlackDelivery {
  private log: WebhookDelivery[] = [];
  private loaded = false;
  private hookId = 0;

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly url: string,
    private readonly signingSecret: string,
  ) {}

  async attach(webhooks: WebhookDispatcher, hookId: number): Promise<void> {
    this.hookId = hookId;
    await this.load();
    webhooks.dispatch = (event, _action, payload) => this.enqueue(event, JSON.stringify(payload));
    webhooks.getDeliveries = (id) => (id === undefined ? [...this.log] : this.log.filter((d) => d.hook_id === id));
    webhooks.redeliver = async (deliveryId, options) => {
      const original = this.log.find((d) => d.id === deliveryId);
      if (!original) return undefined;
      const retryNum = (original.redelivery_count ?? 0) + 1;
      const pending: Pending = {
        id: await this.nextId(),
        event: original.event,
        body: JSON.stringify(original.payload),
        retryNum,
        dueAt: Date.now(),
        firstLogId: original.redelivery_of ?? original.id,
      };
      return (await this.send(pending, options?.headers ?? {})).delivery;
    };
  }

  async run(): Promise<void> {
    await this.load();
    const now = Date.now();
    const due = [...(await this.storage.list<Pending>({ prefix: PENDING_PREFIX })).entries()].filter(
      ([, pending]) => pending.dueAt <= now,
    );
    await Promise.all(due.map(([key, pending]) => this.attempt(key, pending)));
    await this.scheduleNext();
  }

  private async attempt(key: string, pending: Pending): Promise<void> {
    const headers: Record<string, string> =
      pending.retryNum > 0 && pending.reason
        ? { "X-Slack-Retry-Num": String(pending.retryNum), "X-Slack-Retry-Reason": pending.reason }
        : {};
    const { delivery, retry } = await this.send(pending, headers);
    const delay = RETRY_DELAYS_MS[pending.retryNum];
    if (retry && delay !== undefined) {
      await this.storage.put<Pending>(key, {
        ...pending,
        retryNum: pending.retryNum + 1,
        reason: retry,
        dueAt: Date.now() + delay,
        firstLogId: pending.firstLogId ?? delivery.id,
      });
    } else {
      await this.storage.delete(key);
    }
  }

  private async enqueue(event: string, body: string): Promise<void> {
    const id = await this.nextId();
    const dueAt = Date.now();
    await this.storage.put<Pending>(`${PENDING_PREFIX}${id}`, { id, event, body, retryNum: 0, dueAt });
    const alarm = await this.storage.getAlarm();
    if (alarm === null || dueAt < alarm) await this.storage.setAlarm(dueAt);
  }

  private async send(pending: Pending, extraHeaders: Record<string, string>): Promise<Outcome> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign(this.signingSecret, `v0:${timestamp}:${pending.body}`);
    const started = Date.now();
    let status: number | null = null;
    let retry: RetryReason | null = null;
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Slack-Request-Timestamp": String(timestamp),
          "X-Slack-Signature": `v0=${signature}`,
          ...extraHeaders,
        },
        body: pending.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      await response.body?.cancel();
      const noRetry = response.headers.get("x-slack-no-retry") === "1";
      if (!response.ok && !noRetry) retry = "http_error";
    } catch (error) {
      retry = error instanceof Error && error.name === "TimeoutError" ? "http_timeout" : "connection_failed";
    }
    const delivery: WebhookDelivery = {
      id: await this.nextId(),
      hook_id: this.hookId,
      event: pending.event,
      payload: JSON.parse(pending.body),
      status_code: status,
      delivered_at: new Date(started).toISOString(),
      duration: Date.now() - started,
      success: status !== null && status >= 200 && status < 300,
      ...(pending.retryNum > 0 && pending.firstLogId !== undefined
        ? { redelivery_of: pending.firstLogId, redelivery_count: pending.retryNum }
        : {}),
    };
    await this.record(delivery);
    return { delivery, retry };
  }

  private async record(delivery: WebhookDelivery): Promise<void> {
    this.log.push(delivery);
    await this.storage.put(logKey(delivery.id), delivery);
    const overflow = this.log.splice(0, Math.max(0, this.log.length - MAX_LOGGED));
    if (overflow.length > 0) await this.storage.delete(overflow.map((d) => logKey(d.id)));
  }

  private async scheduleNext(): Promise<void> {
    const pending = [...(await this.storage.list<Pending>({ prefix: PENDING_PREFIX })).values()];
    if (pending.length === 0) return;
    await this.storage.setAlarm(Math.min(...pending.map((p) => p.dueAt)));
  }

  private async nextId(): Promise<number> {
    const id = ((await this.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.storage.put(SEQ_KEY, id);
    return id;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.log = [...(await this.storage.list<WebhookDelivery>({ prefix: LOG_PREFIX })).values()];
    this.loaded = true;
  }
}
