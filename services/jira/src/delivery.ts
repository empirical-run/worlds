const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 5;
const RETRY_MIN_MS = 5 * 60_000;
const RETRY_SPREAD_MS = 10 * 60_000;
const RETRIED_STATUSES = new Set([408, 409, 425, 429]);
const MAX_LOGGED = 500;
const PENDING_PREFIX = "jira-delivery:pending:";
const LOG_PREFIX = "jira-delivery:log:";
const SEQ_KEY = "jira-delivery:seq";
const JWT_LIFETIME_S = 180;

export type DeliveryTarget = { url: string; clientId: string; accountId: string; cloudId: string };

type Pending = DeliveryTarget & { id: number; identifier: string; event: string; body: string; retry: number; dueAt: number };

export type DeliveryLog = {
  id: number;
  identifier: string;
  event: string;
  url: string;
  retry: number;
  status_code: number | null;
  error: string | null;
  delivered_at: string;
  duration_ms: number;
};

export type SecretFor = (clientId: string) => string | null;

export class JiraDelivery {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly secretFor: SecretFor,
  ) {}

  async enqueue(target: DeliveryTarget, event: string, payload: unknown): Promise<void> {
    const id = await this.nextId();
    const dueAt = Date.now();
    await this.storage.put<Pending>(`${PENDING_PREFIX}${id}`, {
      ...target,
      id,
      identifier: crypto.randomUUID(),
      event,
      body: JSON.stringify(payload),
      retry: 0,
      dueAt,
    });
    const alarm = await this.storage.getAlarm();
    if (alarm === null || dueAt < alarm) await this.storage.setAlarm(dueAt);
  }

  async run(): Promise<void> {
    const now = Date.now();
    const due = [...(await this.storage.list<Pending>({ prefix: PENDING_PREFIX })).entries()].filter(([, pending]) => pending.dueAt <= now);
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
    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(pending.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${await webhookJwt(secret, pending)}`,
          "User-Agent": "Atlassian Webhook HTTP Client",
          "X-Atlassian-Webhook-Identifier": pending.identifier,
          ...(pending.retry > 0 ? { "X-Atlassian-Webhook-Retry": String(pending.retry) } : {}),
        },
        body: pending.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      await response.body?.cancel();
    } catch (caught) {
      error = caught instanceof Error && caught.name === "TimeoutError" ? "timeout" : "connection_failed";
    }
    await this.record({
      id: await this.nextId(),
      identifier: pending.identifier,
      event: pending.event,
      url: pending.url,
      retry: pending.retry,
      status_code: status,
      error,
      delivered_at: new Date(started).toISOString(),
      duration_ms: Date.now() - started,
    });
    const retryable = status === null || status >= 500 || RETRIED_STATUSES.has(status);
    if (retryable && pending.retry < MAX_RETRIES) {
      await this.storage.put<Pending>(key, { ...pending, retry: pending.retry + 1, dueAt: Date.now() + RETRY_MIN_MS + Math.random() * RETRY_SPREAD_MS });
    } else {
      await this.storage.delete(key);
    }
  }

  private async record(entry: DeliveryLog): Promise<void> {
    await this.storage.put(`${LOG_PREFIX}${String(entry.id).padStart(12, "0")}`, entry);
    const keys = [...(await this.storage.list({ prefix: LOG_PREFIX })).keys()];
    if (keys.length > MAX_LOGGED) await this.storage.delete(keys.slice(0, keys.length - MAX_LOGGED));
  }

  private async nextId(): Promise<number> {
    const id = ((await this.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.storage.put(SEQ_KEY, id);
    return id;
  }
}

async function webhookJwt(secret: string, pending: Pending): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: `jira:${pending.cloudId}`,
    sub: pending.accountId,
    aud: pending.clientId,
    iat: now,
    exp: now + JWT_LIFETIME_S,
  })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64Url(signature)}`;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
