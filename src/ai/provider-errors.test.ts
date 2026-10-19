import { describe, expect, it } from "vitest";
import { describeOpenRouterFailure } from "./provider-errors.js";

describe("safe OpenRouter provider diagnostics", () => {
  it("reports status and typed provider errors without echoing raw payloads", () => {
    const secret = "sk-or-v1-secret-should-never-appear";
    const result = describeOpenRouterFailure(
      {
        statusCode: 502,
        body: {
          error: {
            message: "Provider returned error: " + secret,
            code: 502,
            metadata: {
              error_type: "provider_unavailable",
              raw: { api_key: secret, prompt: "private issue text" },
            },
          },
        },
      },
      "qwen/qwen3-coder-next",
    );
    expect(result).toContain("HTTP 502");
    expect(result).toContain("provider_unavailable");
    expect(result).toContain("qwen/qwen3-coder-next");
    expect(result).not.toContain(secret);
    expect(result).not.toContain("private issue text");
  });

  it("directs credit and rate-limit failures to appropriate actions", () => {
    expect(
      describeOpenRouterFailure({ statusCode: 402 }, "test-model"),
    ).toContain("credits");
    expect(
      describeOpenRouterFailure({ statusCode: 429 }, "test-model"),
    ).toContain("Rate limited");
  });

  it("handles nested JSON string response bodies", () => {
    const failure = describeOpenRouterFailure(
      { body: JSON.stringify({ error: { code: 503, metadata: { error_type: "provider_overloaded" } } }) },
      "test-model",
    );
    expect(failure).toContain("HTTP 503");
    expect(failure).toContain("provider_overloaded");
  });

  it("never exposes arbitrary messages or untrusted model values", () => {
    const result = describeOpenRouterFailure(
      { message: "Provider returned error", body: '{"error":{"message":"secret token"}}' },
      "bad model name with injected text",
    );
    expect(result).toContain("status unavailable");
    expect(result).toContain("configured model");
    expect(result).not.toContain("secret token");
  });
});
