const TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [60_000, 60 * 60_000, 6 * 60 * 60_000];
const MAX_LOGGED = 500;
const PENDING_PREFIX = "linear-delivery:pending:";
const LOG_PREFIX = "linear-delivery:log:";
const SEQ_KEY = "linear-delivery:seq";

export type DeliveryTarget = { url: string; clientId: string };

type Pending = DeliveryTarget & {
  id: number;
  delivery: string;
  event: string;
  payload: Record<string, unknown>;
  retry: number;
  dueAt: number;
};

export type DeliveryLog = {
  id: number;
  delivery: string;
  event: string;
  url: string;
  retry: number;
  status_code: number | null;
  error: string | null;
  delivered_at: string;
  duration_ms: number;
};

export type SecretFor = (clientId: string) => string | null;

export class LinearDelivery {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly secretFor: SecretFor,
  ) {}

  async enqueue(
    target: DeliveryTarget,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const id = await this.nextId();
    const dueAt = Date.now();
    await this.storage.put<Pending>(`${PENDING_PREFIX}${id}`, {
      ...target,
      id,
      delivery: crypto.randomUUID(),
      event,
      payload,
      retry: 0,
      dueAt,
    });
    const alarm = await this.storage.getAlarm();
    if (alarm === null || dueAt < alarm) {
      await this.storage.setAlarm(dueAt);
    }
  }

  async run(): Promise<void> {
    const now = Date.now();
    const due = [
      ...(await this.storage.list<Pending>({ prefix: PENDING_PREFIX })).entries(),
    ].filter(([, pending]) => pending.dueAt <= now);
    await Promise.all(due.map(([key, pending]) => this.attempt(key, pending)));
  }

  async nextDue(): Promise<number | null> {
    const pending = [...(await this.storage.list<Pending>({ prefix: PENDING_PREFIX })).values()];
    return pending.length ? Math.min(...pending.map((entry) => entry.dueAt)) : null;
  }

  async log(): Promise<DeliveryLog[]> {
    return [...(await this.storage.list<DeliveryLog>({ prefix: LOG_PREFIX })).values()];
  }

  private async attempt(key: string, pending: Pending): Promise<void> {
    const secret = this.secretFor(pending.clientId);
    if (!secret) {
      await this.storage.delete(key);
      return;
    }
    const started = Date.now();
    const body = JSON.stringify({ ...pending.payload, webhookTimestamp: started });
    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(pending.url, {
        method: "POST",
        headers: {
          "Accept-Charset": "utf-8",
          "Content-Type": "application/json; charset=utf-8",
          "Linear-Delivery": pending.delivery,
          "Linear-Event": pending.event,
          "Linear-Signature": await sign(secret, body),
          "Linear-Timestamp": String(started),
          "User-Agent": "Linear-Webhook",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      await response.body?.cancel();
    } catch (caught) {
      error =
        caught instanceof Error && caught.name === "TimeoutError" ? "timeout" : "connection_failed";
    }
    await this.record({
      id: await this.nextId(),
      delivery: pending.delivery,
      event: pending.event,
      url: pending.url,
      retry: pending.retry,
      status_code: status,
      error,
      delivered_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
    });
    const delay = RETRY_DELAYS_MS[pending.retry];
    if (status !== 200 && delay !== undefined) {
      await this.storage.put<Pending>(key, {
        ...pending,
        retry: pending.retry + 1,
        dueAt: Date.now() + delay,
      });
    } else {
      await this.storage.delete(key);
    }
  }

  private async record(entry: DeliveryLog): Promise<void> {
    await this.storage.put(`${LOG_PREFIX}${String(entry.id).padStart(12, "0")}`, entry);
    const keys = [...(await this.storage.list({ prefix: LOG_PREFIX })).keys()];
    if (keys.length > MAX_LOGGED) {
      await this.storage.delete(keys.slice(0, keys.length - MAX_LOGGED));
    }
  }

  private async nextId(): Promise<number> {
    const id = ((await this.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.storage.put(SEQ_KEY, id);
    return id;
  }
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
