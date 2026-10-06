import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { authorizePatchToolInput } from "./patch-authorization.js";

const patchIntents = [
  {
    id: "intent-1",
    path: "vitest.setup.ts",
    objective: "Ensure rendered DOM is cleaned between tests.",
    evidenceRefs: [
      {
        kind: "FILE",
        source: "vitest.setup.ts",
      },
    ],
  },
] satisfies InvestigationDiagnosis["patchIntents"];

describe("authorizePatchToolInput", () => {
  it("accepts an authorized intent and path", () => {
    expect(
      authorizePatchToolInput(
        {
          intentId: "intent-1",
          path: "vitest.setup.ts",
          content: "export {};",
        },
        patchIntents,
      ),
    ).toEqual({
      ok: true,
      intentId: "intent-1",
      input: {
        path: "vitest.setup.ts",
        content: "export {};",
      },
    });
  });

  it("rejects a missing intent id", () => {
    expect(
      authorizePatchToolInput(
        {
          path: "vitest.setup.ts",
          content: "export {};",
        },
        patchIntents,
      ),
    ).toEqual({
      ok: false,
      error:
        "apply_patch requires a valid intentId, repository-relative path, and replacement content.",
    });
  });

  it("rejects an unknown intent id", () => {
    expect(
      authorizePatchToolInput(
        {
          intentId: "intent-999",
          path: "vitest.setup.ts",
          content: "export {};",
        },
        patchIntents,
      ),
    ).toEqual({
      ok: false,
      error:
        'Patch intent "intent-999" is not authorized by the validated investigation.',
    });
  });

  it("rejects a path outside the selected intent", () => {
    expect(
      authorizePatchToolInput(
        {
          intentId: "intent-1",
          path: "src/components/DarkMode.test.tsx",
          content: "export {};",
        },
        patchIntents,
      ),
    ).toEqual({
      ok: false,
      error:
        'Patch intent "intent-1" authorizes only "vitest.setup.ts", not "src/components/DarkMode.test.tsx".',
    });
  });

  it("accepts an equivalent leading-dot repository path and canonicalizes it", () => {
    expect(
      authorizePatchToolInput(
        {
          intentId: "intent-1",
          path: "./vitest.setup.ts",
          content: "export {};",
        },
        patchIntents,
      ),
    ).toEqual({
      ok: true,
      intentId: "intent-1",
      input: {
        path: "vitest.setup.ts",
        content: "export {};",
      },
    });
  });

  it("rejects duplicate matching intent ids defensively", () => {
    expect(
      authorizePatchToolInput(
        {
          intentId: "intent-1",
          path: "vitest.setup.ts",
          content: "export {};",
        },
        [...patchIntents, patchIntents[0]!],
      ),
    ).toEqual({
      ok: false,
      error:
        'Patch intent "intent-1" is ambiguous because the validated investigation contains duplicate intent ids.',
    });
  });
});
