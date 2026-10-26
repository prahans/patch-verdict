# OpenRouter request recovery

## Diagnosis

The reported missions reproduced the baseline and made several successful AI
requests before Qwen3 Coder Next, routed to Parasail, returned HTTP 429. The same
failure occurred on Windows and EC2. This points to the provider request boundary;
it does not establish an operating-system problem or a repair-engine failure.
HTTP 429 can reflect rate limits or upstream capacity. The exact quota or capacity
constraint cannot be determined from that status alone.

The `@openrouter/sdk` **1.4.14** inspected for the reliability change retries
`5XX` and connection failures by default, but **does not retry 429**. Its generated `funcs/chatSend.js` and
`lib/retries.js` allow a one-hour retry budget with no attempt cap. They understand
`Retry-After`, but cap waits at 60 seconds and check elapsed time before waiting,
so the SDK policy does not enforce PatchVerdict's mission deadline. The SDK's
default backoff formula is polynomial (`500 * x^1.5 + jitter`). In the reported
executions, an unhandled 429 ended the investigation before patch generation.

On **2026-10-22**, the public [model endpoint API](https://openrouter.ai/api/v1/models/qwen/qwen3-coder-next/endpoints)
advertised only Parasail for this model, including `tools` and `tool_choice`
support. That snapshot does not prove which providers were available during the
reported failures. OpenRouter says it tries eligible same-model fallbacks before
returning upstream rate-limit errors. Account allowlists, privacy settings, and
required parameters can further reduce eligibility. See [rate limits](https://openrouter.ai/docs/api_reference/limits#handling-429-errors)
and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

## Recovery boundaries

[The chat adapter](../src/ai/chat-recovery.ts) handles only individual non-streaming
model requests. SDK retries are disabled both on the client and per call to avoid
stacked retry policies.

| Setting                 | Policy                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Retryable HTTP statuses | 429, 502, 503, 504                                                                                                   |
| Attempts                | At most four total, including the initial request                                                                    |
| Local backoff           | Exponential bases of 1, 2, 4 seconds, with equal jitter between half and the full base                               |
| Server delay            | `retry-after-ms`, or `Retry-After` seconds/HTTP date, is a minimum; use the larger of it and local backoff           |
| Request budget          | 90 seconds total, including requests, response parsing, and waits                                                    |
| Mission budget          | Stop model requests five seconds before the absolute mission deadline, or at the request limit, whichever is earlier |
| Other failures          | No retry for authentication, credits, forbidden requests, validation, unknown errors, or ambiguous network failures  |

A server delay that cannot fit the remaining budget fails immediately; it is not
shortened. Deadline cancellation aborts the active HTTP request and waiting. The
five-second reserve gives the runner time to record failure evidence and clean
up; it is not a guarantee that slow filesystem or sandbox cleanup will finish.

The web bridge passes its deadline to the child through the internal
`PATCHVERDICT_MISSION_DEADLINE_MS` timestamp. The real CLI starts a default
270-second model budget before sandbox creation and repository preparation.
Direct `runMission` calls receive an isolated 270-second budget unless an absolute
`deadlineAtMs` is supplied. This limits model requests; existing sandbox command
timeouts and the web process watchdog remain responsible for other operations.

Retries retain the same messages, prior tool results, model, and generation
parameters. Tool-enabled requests set `requireParameters: true` and explicitly
enable `allowFallbacks`. No provider is pinned or blocked and no fallback model is
introduced. A provider may remain unavailable across every attempt.

Repository tools run only after a successful model reply. The adapter cannot
restart an investigation, apply a patch, rerun verification, or publish to GitHub.
It does not change deterministic verdict rules or proof serialization. Existing
failed mission records remain evidence of those original executions.

## Safe diagnostics and validation

Retry logs contain only numeric HTTP status, attempt numbers, and wait duration.
Terminal errors contain fixed categories, termination reason, attempt count, and
HTTP status when available. Raw SDK errors, response bodies, provider messages,
headers, credentials, prompts, and token usage are not attached or logged by the
adapter. `RATE_LIMIT` identifies HTTP 429, not its precise upstream cause.
If the SDK discards the HTTP status while parsing syntactically invalid JSON,
the adapter reports `REQUEST_FAILED` without guessing a retryable status.

The tests use the installed SDK with a fake HTTP transport, fake timers, and
agent tool fixtures. They cover transient recovery, exhausted attempts,
non-retryable errors, server delays, deadline cancellation, unchanged conversation
payloads, and tool execution counts. The web process test checks deadline
propagation. These checks do not establish live Parasail availability or prove a
successful end-to-end mission on Windows or EC2.

Historical validation of the recovery implementation: **129 backend tests** and
**155 web tests** passed, including 38 transport tests, three agent recovery tests,
and 12 deadline tests.
Backend and frontend typechecks, web lint, and the Next.js production build also
passed. The production build required network access for the existing Google
Fonts downloads. No paid provider request or real repair mission was run for
this validation. These are the original implementation results, not a test run
performed during the final documentation audit.

For a live comparison, use a separately configured trusted interactive instance;
the public read-only demo does not launch missions. Live runs require provider
credentials and may incur charges. Use the same controlled issue and reproduction
settings, and confirm that the new recorded base commit matches the original.
The web form does not select a commit: it clones the repository's current default
branch, so a rerun after that branch changes is not a same-base comparison.
Keep the original failed artifacts. The web workflow generates a new mission ID;
CLI users should supply a fresh
`PATCHVERDICT_MISSION_ID` to avoid overwriting the deterministic default output
path. Record the new execution outcome and safe status/attempt diagnostics before
claiming that the observed live failure is resolved.
