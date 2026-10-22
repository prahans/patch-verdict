import type { OpenRouter } from "@openrouter/sdk";
import type {
  SendChatCompletionRequestRequest,
  SendChatCompletionRequestResponse,
} from "@openrouter/sdk/models/operations";
import { getMissionDeadline } from "../mission/deadline.js";

const MAX_ATTEMPTS = 4;
const REQUEST_BUDGET_MS = 90_000;
const MISSION_RESERVE_MS = 5_000;
const RETRYABLE = new Set([429, 502, 503, 504]);

type Category =
  | "RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "AUTHENTICATION"
  | "FORBIDDEN"
  | "CREDITS"
  | "INVALID_REQUEST"
  | "REQUEST_FAILED"
  | "TIMEOUT";
type Reason = "NON_RETRYABLE" | "RETRIES_EXHAUSTED" | "DEADLINE_EXCEEDED";

// Never attach the SDK error as a cause: it can contain headers and prompt data.
export class OpenRouterRequestError extends Error {
  readonly statusCode: number | undefined;
  constructor(
    readonly category: Category,
    readonly reason: Reason,
    readonly attempts: number,
    statusCode?: number,
  ) {
    super(
      `OpenRouter request failed: ${category}${statusCode === undefined ? "" : ` (HTTP ${statusCode})`}; ${reason}; attempts=${attempts}.`,
    );
    this.name = "OpenRouterRequestError";
    this.statusCode = statusCode;
  }
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error))
    return;
  const status = error.statusCode;
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
    ? status
    : undefined;
}

function categoryFor(status: number | undefined): Category {
  if (status === 429) return "RATE_LIMIT";
  if (status === 502 || status === 503 || status === 504)
    return "PROVIDER_UNAVAILABLE";
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) return "FORBIDDEN";
  if (status === 408) return "TIMEOUT";
  if (status === 402) return "CREDITS";
  if (status !== undefined && status >= 400 && status < 500)
    return "INVALID_REQUEST";
  return "REQUEST_FAILED";
}

function retryAfterMs(error: unknown): number {
  if (
    typeof error !== "object" ||
    error === null ||
    !("headers" in error) ||
    !(error.headers instanceof Headers)
  )
    return 0;
  const milliseconds = error.headers.get("retry-after-ms");
  if (milliseconds !== null && /^\d+(?:\.\d+)?$/.test(milliseconds.trim())) {
    const parsed = Number(milliseconds);
    return parsed;
  }
  const value = error.headers.get("retry-after")?.trim();
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const parsed = Number(value) * 1000;
    return parsed;
  }
  // Do not let Date.parse reinterpret malformed numeric delays as dates.
  if (!/^[A-Za-z]{3,9},?\s/.test(value)) return 0;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Request deadline reached"));
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await untilAborted(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, delayMs);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function createReliableChat(
  client: Pick<OpenRouter["chat"], "send">,
  options: { getDeadline?: () => number } = {},
) {
  return {
    async send(
      request: SendChatCompletionRequestRequest,
    ): Promise<SendChatCompletionRequestResponse> {
      // The engine uses complete, non-streaming replies. A stream cannot safely
      // be replayed after a partial result has already reached the caller.
      if (request.chatRequest.stream) {
        throw new OpenRouterRequestError("INVALID_REQUEST", "NON_RETRYABLE", 0);
      }
      const deadline = Math.min(
        (options.getDeadline ?? getMissionDeadline)() - MISSION_RESERVE_MS,
        Date.now() + REQUEST_BUDGET_MS,
      );
      let attempts = 0;
      let lastStatus: number | undefined;
      const timedOut = () =>
        new OpenRouterRequestError(
          "TIMEOUT",
          "DEADLINE_EXCEEDED",
          attempts,
          lastStatus,
        );
      if (!Number.isFinite(deadline) || deadline <= Date.now())
        throw timedOut();

      // Construct once. Every retry carries the same conversation, prior tool
      // results, model and parameters. No agent or tool code is retried here.
      const retryRequest: SendChatCompletionRequestRequest = {
        ...request,
        chatRequest: {
          ...request.chatRequest,
          provider: {
            ...request.chatRequest.provider,
            allowFallbacks: true,
            ...(request.chatRequest.tools?.length ||
            request.chatRequest.toolChoice !== undefined
              ? { requireParameters: true }
              : {}),
          },
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deadline - Date.now());
      try {
        while (true) {
          if (controller.signal.aborted || Date.now() >= deadline)
            throw timedOut();
          attempts++;
          try {
            const response = await untilAborted(
              client.send(retryRequest, {
                // SDK 1.4.14 otherwise retries 5xx for up to an hour, but not 429.
                retries: { strategy: "none" },
                signal: controller.signal,
              }),
              controller.signal,
            );
            if (controller.signal.aborted || Date.now() >= deadline)
              throw timedOut();
            return response;
          } catch (error) {
            if (controller.signal.aborted || Date.now() >= deadline)
              throw timedOut();
            const status = httpStatus(error);
            lastStatus = status;
            if (status === undefined || !RETRYABLE.has(status)) {
              throw new OpenRouterRequestError(
                categoryFor(status),
                "NON_RETRYABLE",
                attempts,
                status,
              );
            }
            if (attempts >= MAX_ATTEMPTS) {
              throw new OpenRouterRequestError(
                categoryFor(status),
                "RETRIES_EXHAUSTED",
                attempts,
                status,
              );
            }
            const base = Math.min(8_000, 1_000 * 2 ** (attempts - 1));
            const delayMs = Math.ceil(
              Math.max(
                base / 2 + (Math.random() * base) / 2,
                retryAfterMs(error),
              ),
            );
            // Retry-After is a minimum, never shortened to fit our budget.
            if (delayMs >= deadline - Date.now()) throw timedOut();
            console.warn("OpenRouter retry", {
              statusCode: status,
              attempt: attempts,
              nextAttempt: attempts + 1,
              delayMs,
            });
            try {
              await waitForRetry(delayMs, controller.signal);
            } catch {
              throw timedOut();
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
