import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialHypothesisBoard } from "./create-hypothesis-board.js";
import type { HypothesisBoard } from "./hypothesis-board.js";
import type { ReconnaissanceContext } from "./reconnaissance.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("../ai/openrouter.js", () => ({
  AGENT_MODEL: "test-model",
  openRouter: { chat: { send } },
}));

const board: HypothesisBoard = {
  observedFailure:
    "The baseline suite leaves prior rendered DOM visible to later DarkMode assertions.",
  hypotheses: [
    {
      id: "H1",
      layer: "CONFIGURATION",
      hypothesis:
        "The active Vitest execution configuration allows state to persist across the failing suite.",
      status: "OPEN",
      supportingEvidenceRefs: [{ kind: "FILE", source: "vite.config.ts" }],
      contradictingEvidenceRefs: [],
      missingEvidence: [
        "A controlled run changing the relevant execution setting.",
      ],
    },
    {
      id: "H2",
      layer: "TEST_INFRASTRUCTURE",
      hypothesis:
        "The shared test setup does not register the cleanup behavior required by these tests.",
      status: "OPEN",
      supportingEvidenceRefs: [{ kind: "FILE", source: "vitest.setup.ts" }],
      contradictingEvidenceRefs: [],
      missingEvidence: [
        "Evidence distinguishing repository setup from runtime lifecycle behavior.",
      ],
    },
  ],
  discriminationGoal: {
    question:
      "Does the failure follow runner configuration or the repository shared test setup?",
    competingHypothesisIds: ["H1", "H2"],
    evidenceNeeded:
      "A controlled observation changing one causal variable while preserving the same test suite.",
  },
};

const reconnaissance: ReconnaissanceContext = {
  inventory: [
    "package.json",
    "vite.config.ts",
    "vitest.setup.ts",
    "src/components/DarkMode.test.tsx",
    "src/utils/test-utils.tsx",
  ],
  inventoryDepth: 5,
  inventoryPreview: [
    "package.json",
    "vite.config.ts",
    "vitest.setup.ts",
    "src/components/DarkMode.test.tsx",
    "src/utils/test-utils.tsx",
  ],
  inventoryTruncated: false,
  failingPaths: ["src/components/DarkMode.test.tsx"],
  runnerConfigs: ["vite.config.ts"],
  testSetups: ["vitest.setup.ts"],
  files: [
    {
      path: "package.json",
      roles: ["PACKAGE_MANIFEST"],
      content: '{"scripts":{"test":"vitest run"}}',
      truncated: false,
    },
    {
      path: "vite.config.ts",
      roles: ["RUNNER_CONFIG"],
      content: "export default {}",
      truncated: false,
    },
    {
      path: "vitest.setup.ts",
      roles: ["TEST_SETUP"],
      content: "import '@testing-library/jest-dom';",
      truncated: false,
    },
    {
      path: "src/components/DarkMode.test.tsx",
      roles: ["FAILING_FILE"],
      content: "test('dark mode', () => {})",
      truncated: false,
    },
  ],
  preInspectedFiles: [
    "package.json",
    "vite.config.ts",
    "vitest.setup.ts",
    "src/components/DarkMode.test.tsx",
  ],
  readFailures: [],
};

const baseline = {
  command: "npm test",
  exitCode: 1,
  reproduced: true as const,
  requiredOutput: ["Found multiple elements"],
  outputExcerpt: "Found multiple elements with the text: /light/",
};

function completion(content: unknown) {
  return {
    choices: [{ message: { role: "assistant", content } }],
  };
}

describe("createInitialHypothesisBoard", () => {
  beforeEach(() => send.mockReset());

  it("requests schema-enforced output and accepts structured object content", async () => {
    send.mockResolvedValueOnce(completion(board));

    expect(
      await createInitialHypothesisBoard({
        issue: "DarkMode tests retain DOM between suites.",
        baseline,
        reconnaissance,
      }),
    ).toEqual(board);

    const request = send.mock.calls[0]![0].chatRequest;
    expect(request.responseFormat).toMatchObject({
      type: "json_schema",
      jsonSchema: {
        name: "patchverdict_hypothesis_board",
        strict: true,
      },
    });
    expect(request.responseFormat.jsonSchema.schema).toBeTruthy();

    const responseSchema = JSON.stringify(
      request.responseFormat.jsonSchema.schema,
    );

    expect(responseSchema).toContain('"npm test"');
    expect(responseSchema).toContain('"vite.config.ts"');
    expect(responseSchema).toContain('"vitest.setup.ts"');
    expect(responseSchema).not.toContain('"src/utils/test-utils.tsx"');
    expect(request).not.toHaveProperty("tools");
  });

  it("uses the same schema boundary for the one repair attempt", async () => {
    send.mockResolvedValueOnce(completion("not-json"));
    send.mockResolvedValueOnce(completion(board));

    expect(
      await createInitialHypothesisBoard({
        issue: "DarkMode tests retain DOM between suites.",
        baseline,
        reconnaissance,
      }),
    ).toEqual(board);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].chatRequest.responseFormat).toMatchObject({
      type: "json_schema",
      jsonSchema: {
        name: "patchverdict_hypothesis_board_repair",
        strict: true,
      },
    });
  });
});
