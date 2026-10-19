/** Sanitized OpenRouter failure report: never print request bodies or provider raw data. */
type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

function body(value: unknown): Obj | undefined {
  if (typeof value !== "string" || value.length > 16_384) return obj(value);
  try {
    return obj(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function status(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{3}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(parsed) && parsed >= 400 && parsed <= 599
    ? parsed
    : undefined;
}

function safeType(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(value)
    ? value
    : undefined;
}

function firstDefined<T>(values: (T | undefined)[]): T | undefined {
  return values.find((value) => value !== undefined);
}

/**
 * Return actionable diagnostic fields only. Provider "raw", prompt content,
 * tokens, API keys, and untrusted error messages must never enter mission proof.
 */
export function describeOpenRouterFailure(error: unknown, model: string): string {
  const root = obj(error);
  const payload = body(root?.body) ?? obj(root?.response);
  const detail = obj(root?.error) ?? obj(payload?.error);
  const nested = obj(root?.data);
  const nestedError = obj(nested?.error);
  const metadata =
    obj(detail?.metadata) ??
    obj(nestedError?.metadata) ??
    obj(payload?.metadata) ??
    obj(root?.metadata);

  const httpStatus = firstDefined([
    status(root?.statusCode),
    status(root?.status),
    status(detail?.code),
    status(payload?.statusCode),
    status(payload?.status),
    status(nestedError?.code),
  ]);
  const errorType = firstDefined([
    safeType(metadata?.error_type),
    safeType(detail?.error_type),
    safeType(nestedError?.error_type),
    safeType(root?.error_type),
  ]);
  const safeModel = /^[a-zA-Z0-9._\/-]{1,100}$/.test(model)
    ? model
    : "configured model";
  const fields = [
    httpStatus ? `HTTP ${httpStatus}` : "status unavailable",
    ...(errorType ? [`type ${errorType}`] : []),
  ];

  const guidance =
    httpStatus === 401
      ? "Verify OPENROUTER_API_KEY."
      : httpStatus === 402
        ? "Check OpenRouter credits or spending limits."
        : httpStatus === 403
          ? "Check provider access and account guardrails."
          : httpStatus === 429
            ? "Rate limited; wait for Retry-After and avoid repeated missions."
            : httpStatus === 400 || httpStatus === 404
              ? "Check model ID and request/tool compatibility."
              : httpStatus === 408 || httpStatus === 502 || httpStatus === 503 ||
                  httpStatus === 504 || httpStatus === 529
                ? "Provider may be unavailable or overloaded; check OpenRouter activity/status."
                : "Check the request in your OpenRouter Activity page for the upstream reason.";

  return `OpenRouter AI request failed for ${safeModel} (${fields.join(", ")}). ${guidance}`;
}
