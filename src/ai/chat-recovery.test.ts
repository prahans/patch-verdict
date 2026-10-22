import { HTTPClient, OpenRouter } from "@openrouter/sdk";
import type { ChatResult } from "@openrouter/sdk/models";
import type { SendChatCompletionRequestRequest } from "@openrouter/sdk/models/operations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReliableChat, OpenRouterRequestError } from "./chat-recovery.js";

const START = Date.UTC(2026, 9, 22, 0, 0, 0);
const response: ChatResult = {
  choices: [],
  created: 0,
  id: "test-completion",
  model: "test-model",
  object: "chat.completion",
  systemFingerprint: null,
};

function request(): SendChatCompletionRequestRequest {
  return {
    chatRequest: {
      model: "test-model",
      stream: false,
      messages: [
        { role: "system", content: "Investigate the reported behavior." },
        { role: "user", content: "The controlled reproduction failed." },
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "read-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"src/repair.ts"}',
              },
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "read-1",
          content: "The already-read source and baseline evidence.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      toolChoice: "auto",
    },
  };
}

function httpFailure(statusCode: number, headers: HeadersInit = {}) {
  return Object.assign(new Error("untrusted-provider-message"), {
    statusCode,
    headers: new Headers(headers),
  });
}

function mockChat(getDeadline = () => START + 600_000) {
  const send = vi.fn<OpenRouter["chat"]["send"]>();
  return { send, chat: createReliableChat({ send }, { getDeadline }) };
}

async function finish<T>(pending: Promise<T>): Promise<T | unknown> {
  const outcome = pending.catch((error: unknown) => error);
  await vi.runAllTimersAsync();
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenRouter request recovery", () => {
  it.each([429, 502, 503, 504])(
    "recovers HTTP %s through the real SDK without losing the conversation",
    async (status) => {
      const captured: Request[] = [];
      const client = new OpenRouter({
        apiKey: "test-only-key",
        httpClient: new HTTPClient({
          fetcher: async (input) => {
            const incoming = input as Request;
            captured.push(incoming.clone());
            if (captured.length === 1) {
              return new Response(
                JSON.stringify({
                  error: { code: status, message: "Provider returned error" },
                }),
                {
                  status,
                  headers: { "content-type": "application/json" },
                },
              );
            }
            return new Response(
              JSON.stringify({
                ...response,
                system_fingerprint: null,
              }),
              { headers: { "content-type": "application/json" } },
            );
          },
        }),
      });
      const sdkSend = vi.spyOn(client.chat, "send");
      const original = request();
      const snapshot = structuredClone(original);
      const result = await finish(
        createReliableChat(client.chat, {
          getDeadline: () => START + 600_000,
        }).send(original),
      );

      expect(result).toMatchObject({ id: "test-completion" });
      expect(captured).toHaveLength(2);
      expect(sdkSend).toHaveBeenCalledTimes(2);
      for (const [, options] of sdkSend.mock.calls) {
        expect(options).toMatchObject({ retries: { strategy: "none" } });
        expect(options?.signal).toBeInstanceOf(AbortSignal);
      }
      const bodies = await Promise.all(
        captured.map((capturedRequest) => capturedRequest.text()),
      );
      expect(bodies[1]).toBe(bodies[0]);
      const wireRequest = JSON.parse(bodies[0]!);
      expect(wireRequest.messages).toHaveLength(4);
      expect(wireRequest.messages[2].tool_calls[0].id).toBe("read-1");
      expect(wireRequest.messages[3]).toEqual({
        role: "tool",
        tool_call_id: "read-1",
        content: "The already-read source and baseline evidence.",
      });
      expect(wireRequest.provider).toMatchObject({
        allow_fallbacks: true,
        require_parameters: true,
      });
      expect(wireRequest.provider.order).toBeUndefined();
      expect(wireRequest.provider.only).toBeUndefined();
      expect(original).toEqual(snapshot);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([429, 502, 503, 504])(
    "stops after four total attempts for HTTP %s",
    async (statusCode) => {
      const { chat, send } = mockChat();
      const calledAt: number[] = [];
      send.mockImplementation(async () => {
        calledAt.push(Date.now() - START);
        throw httpFailure(statusCode);
      });

      const error = await finish(chat.send(request()));

      expect(error).toBeInstanceOf(OpenRouterRequestError);
      expect(error).toMatchObject({
        category: statusCode === 429 ? "RATE_LIMIT" : "PROVIDER_UNAVAILABLE",
        statusCode,
        attempts: 4,
        reason: "RETRIES_EXHAUSTED",
      });
      expect(calledAt).toEqual([0, 500, 1500, 3500]);
      expect(send).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ["text/plain", "upstream capacity exhausted"],
    ["application/json", JSON.stringify({ unexpected: "error schema" })],
  ])(
    "recovers HTTP 429 with %s error content through the SDK",
    async (contentType, body) => {
      let calls = 0;
      const client = new OpenRouter({
        apiKey: "test-only-key",
        httpClient: new HTTPClient({
          fetcher: async () => {
            calls++;
            return calls === 1
              ? new Response(body, {
                  status: 429,
                  headers: { "content-type": contentType },
                })
              : new Response(
                  JSON.stringify({ ...response, system_fingerprint: null }),
                  {
                    headers: { "content-type": "application/json" },
                  },
                );
          },
        }),
      });

      expect(
        await finish(
          createReliableChat(client.chat, {
            getDeadline: () => START + 600_000,
          }).send(request()),
        ),
      ).toMatchObject({ id: "test-completion" });
      expect(calls).toBe(2);
    },
  );

  it("does not guess an HTTP status when invalid JSON makes the SDK discard it", async () => {
    let calls = 0;
    const client = new OpenRouter({
      apiKey: "test-only-key",
      httpClient: new HTTPClient({
        fetcher: async () => {
          calls++;
          return new Response("{invalid json", {
            status: 429,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });

    const error = await finish(
      createReliableChat(client.chat, {
        getDeadline: () => START + 600_000,
      }).send(request()),
    );

    expect(error).toMatchObject({
      category: "REQUEST_FAILED",
      attempts: 1,
      reason: "NON_RETRYABLE",
    });
    expect(calls).toBe(1);
  });

  it.each([
    [400, "INVALID_REQUEST"],
    [401, "AUTHENTICATION"],
    [402, "CREDITS"],
    [403, "FORBIDDEN"],
    [408, "TIMEOUT"],
    [422, "INVALID_REQUEST"],
  ])("does not retry HTTP %s", async (statusCode, category) => {
    const { chat, send } = mockChat();
    send.mockRejectedValue(httpFailure(statusCode as number));

    const error = await finish(chat.send(request()));

    expect(error).toMatchObject({
      category,
      statusCode,
      attempts: 1,
      reason: "NON_RETRYABLE",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(START);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    new TypeError("fetch failed: secret provider text"),
    new Error("unclassified failure"),
    {
      error: {
        code: 429,
        message: "body code alone does not prove an HTTP response",
      },
    },
  ])("does not retry network or unclassified errors", async (failure) => {
    const { chat, send } = mockChat();
    send.mockRejectedValue(failure);

    const error = await finish(chat.send(request()));

    expect(error).toMatchObject({
      category: "REQUEST_FAILED",
      attempts: 1,
      reason: "NON_RETRYABLE",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("uses jitter within the exponential backoff interval", async () => {
    vi.mocked(Math.random).mockReturnValue(0.8);
    const { chat, send } = mockChat();
    const calledAt: number[] = [];
    send.mockImplementation(async () => {
      calledAt.push(Date.now() - START);
      if (calledAt.length < 4) throw httpFailure(429);
      return response;
    });

    expect(await finish(chat.send(request()))).toBe(response);
    expect(calledAt).toEqual([0, 900, 2700, 6300]);
  });

  it.each([
    [{ "retry-after": "3" }, 3000],
    [{ "retry-after": new Date(START + 4000).toUTCString() }, 4000],
    [{ "retry-after": "Thursday, 22-Oct-26 00:00:04 GMT" }, 4000],
    [{ "retry-after-ms": "1250" }, 1250],
    [{ "retry-after": "0" }, 500],
    [{ "retry-after": "invalid" }, 500],
    [{ "retry-after": new Date(START - 1000).toUTCString() }, 500],
  ])(
    "honors Retry-After without shortening backoff: %j",
    async (headers, delay) => {
      const { chat, send } = mockChat();
      const calledAt: number[] = [];
      send.mockImplementation(async () => {
        calledAt.push(Date.now() - START);
        if (calledAt.length === 1)
          throw httpFailure(429, headers as HeadersInit);
        return response;
      });

      expect(await finish(chat.send(request()))).toBe(response);
      expect(calledAt).toEqual([0, delay]);
    },
  );

  it.each(["90", "120", "99999999999999999999999999999999999999"])(
    "stops when Retry-After %s seconds cannot fit the request budget",
    async (retryAfter) => {
      const { chat, send } = mockChat();
      send.mockRejectedValue(httpFailure(429, { "retry-after": retryAfter }));

      const error = await finish(chat.send(request()));

      expect(error).toMatchObject({ attempts: 1, reason: "DEADLINE_EXCEEDED" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(Date.now()).toBe(START);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("preserves request fields and provider preferences while requiring tool support", async () => {
    const { chat, send } = mockChat();
    send.mockResolvedValue(response);
    const original = request();
    original.appTitle = "test-app";
    original.chatRequest.temperature = 0;
    original.chatRequest.provider = { dataCollection: "deny" };

    expect(await finish(chat.send(original))).toBe(response);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      appTitle: "test-app",
      chatRequest: {
        temperature: 0,
        model: "test-model",
        toolChoice: "auto",
        provider: {
          dataCollection: "deny",
          allowFallbacks: true,
          requireParameters: true,
        },
      },
    });
    expect(original.chatRequest.provider).toEqual({ dataCollection: "deny" });
  });
});

describe("OpenRouter recovery deadlines", () => {
  it("does not start an HTTP request when the mission reserve is reached", async () => {
    const { chat, send } = mockChat(() => START + 5000);

    expect(await finish(chat.send(request()))).toMatchObject({
      category: "TIMEOUT",
      attempts: 0,
      reason: "DEADLINE_EXCEEDED",
    });
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight SDK request before the mission reserve", async () => {
    let receivedSignal: AbortSignal | undefined;
    const client = new OpenRouter({
      apiKey: "test-only-key",
      httpClient: new HTTPClient({
        fetcher: (input) =>
          new Promise<Response>((_resolve, reject) => {
            receivedSignal = (input as Request).signal;
            receivedSignal.addEventListener(
              "abort",
              () => reject(receivedSignal?.reason),
              { once: true },
            );
          }),
      }),
    });
    const chat = createReliableChat(client.chat, {
      getDeadline: () => START + 8000,
    });
    const outcome = chat.send(request()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(2999);
    expect(receivedSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({
      category: "TIMEOUT",
      attempts: 1,
      reason: "DEADLINE_EXCEEDED",
    });
    expect(receivedSignal?.aborted).toBe(true);
    expect(Date.now() - START).toBe(3000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes backoff in the shared 90 second request lifetime", async () => {
    const { chat, send } = mockChat();
    send.mockRejectedValueOnce(httpFailure(503, { "retry-after": "10" }));
    send.mockImplementation(() => new Promise(() => {}));
    const outcome = chat.send(request()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(80_000);

    expect(await outcome).toMatchObject({
      category: "TIMEOUT",
      attempts: 2,
      reason: "DEADLINE_EXCEEDED",
    });
    expect(send.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    expect(Date.now() - START).toBe(90_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reset the mission deadline after each transient error", async () => {
    const { chat, send } = mockChat(() => START + 7000);
    send.mockRejectedValue(httpFailure(429));

    const error = await finish(chat.send(request()));

    expect(error).toMatchObject({ attempts: 3, reason: "DEADLINE_EXCEEDED" });
    expect(send).toHaveBeenCalledTimes(3);
    expect(Date.now() - START).toBe(1500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a late completion even if the transport ignores cancellation", async () => {
    const { chat, send } = mockChat(() => START + 6000);
    let complete: ((value: ChatResult) => void) | undefined;
    send.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const outcome = chat.send(request()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toMatchObject({
      category: "TIMEOUT",
      reason: "DEADLINE_EXCEEDED",
    });
    complete?.(response);
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("safe OpenRouter error reporting", () => {
  it("does not expose provider bodies, prompt text, keys, or tokens", async () => {
    const sensitive = [
      "SECRET_API_KEY_SENTINEL",
      "SECRET_PROMPT_SENTINEL",
      "SECRET_TOKEN_SENTINEL",
    ];
    const warn = vi.mocked(console.warn);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const client = new OpenRouter({
      apiKey: sensitive[0]!,
      httpClient: new HTTPClient({
        fetcher: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 429,
                message: sensitive.join(" "),
                metadata: {
                  raw: sensitive.join(" "),
                  provider_name: sensitive[2],
                },
              },
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      }),
    });
    const original = request();
    original.chatRequest.messages.push({
      role: "user",
      content: sensitive[1]!,
    });
    const error = await finish(
      createReliableChat(client.chat, {
        getDeadline: () => START + 600_000,
      }).send(original),
    );

    expect(error).toBeInstanceOf(OpenRouterRequestError);
    expect(error).toMatchObject({
      category: "RATE_LIMIT",
      statusCode: 429,
      attempts: 4,
    });
    const errorFields = Object.getOwnPropertyNames(error).map((key) => [
      key,
      (error as Record<string, unknown>)[key],
    ]);
    const exposed = JSON.stringify([
      String(error),
      errorFields,
      warn.mock.calls,
      log.mock.calls,
      consoleError.mock.calls,
    ]);
    for (const secret of sensitive) expect(exposed).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("body");
    expect(error).not.toHaveProperty("rawResponse");
    expect(error).not.toHaveProperty("headers");
  });
});
