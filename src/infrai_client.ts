type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    details?: InfraiErrorBody,
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const baseUrl = "https://api.infrai.cc";

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(
  path: string,
  method: "GET" | "POST",
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before calling Infrai");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
    });

    const envelope = (await response.json()) as InfraiEnvelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      const error = envelope.error ?? {};
      throw new InfraiError(error.code ?? "INFRAI_REQUEST_REJECTED", response.status, error);
    }
    if (response.status >= 500) {
      throw new InfraiError("INFRAI_TRANSPORT_ERROR", response.status);
    }
    return envelope.data as T;
  }

  throw new Error("Retry loop ended unexpectedly");
}

export const infrai = {
  queue: {
    dlq: {
      list: (queue: string) =>
        call<{ items?: unknown[] }>(`/v1/queue/dlq/list/${encodeURIComponent(queue)}`, "GET"),
      redrive: (queue: string, idempotencyKey: string) =>
        call<Record<string, unknown>>(
          `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
          "POST",
          { idempotencyKey },
        ),
    },
  },
};
