import { createHash, randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MissionInput, MissionResult } from "../mission/types.js";
import { writeProofBundle } from "./bundle.js";

const writes = vi.hoisted(() => ({
  before: undefined as ((filename: string) => Promise<void>) | undefined,
  partialManifest: undefined as
    | ((filename: string) => Promise<void>)
    | undefined,
}));

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const filename = String(args[0]);
      await writes.before?.(filename);
      if (/proof\.json(?:\.tmp)?$/.test(filename) && writes.partialManifest) {
        await actual.writeFile(filename, '{"version":', "utf8");
        await writes.partialManifest(filename);
      }
      return actual.writeFile(...args);
    },
  };
});

const outputRoot = path.resolve(process.cwd(), "output");
const created: string[] = [];
const input: MissionInput = {
  issue: "Repair the incorrect result.",
  projectRoot: "/project",
  verificationPlan: {
    reproduction: {
      command: "npm test",
      label: "Reproduction",
      expectation: { expectedExitCodes: [1] },
    },
    fullSuite: { command: "npm test", label: "Full suite" },
  },
};
const result: MissionResult = {
  status: "COMPLETED",
  verdict: "VERIFIED",
  events: [
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      state: "COMPLETED",
      message: "Mission completed with verdict VERIFIED",
    },
  ],
  patch: {
    applied: true,
    baseCommit: "base",
    changedFiles: ["src/repair.ts"],
    diff: "-false\n+true",
  },
  investigation: {
    report: "The repair function returns the wrong value.",
    iterations: 1,
    inspectedFiles: ["src/repair.ts"],
    diagnosis: {
      rootCause: "Returns false instead of true.",
      evidence: [
        {
          kind: "FILE",
          source: "src/repair.ts",
          observation: "Returns false.",
        },
      ],
      relevantFiles: ["src/repair.ts"],
      recommendedPatchTargets: ["src/repair.ts"],
      patchTargetAnalysis: [
        {
          path: "src/repair.ts",
          decision: "RECOMMEND",
          reason: "Owns the incorrect behavior.",
        },
      ],
      confidence: "HIGH",
    },
  },
  evidence: {
    baselineTest: {
      command: "npm test",
      exitCode: 1,
      stdout: "failure",
      stderr: "",
      durationMs: 1,
    },
    postPatchTest: {
      command: "npm test",
      exitCode: 0,
      stdout: "passing",
      stderr: "",
      durationMs: 1,
    },
    fullSuite: {
      command: "npm test",
      exitCode: 0,
      stdout: "passing",
      stderr: "",
      durationMs: 1,
    },
  },
};

function startBundle(
  source?: Parameters<typeof writeProofBundle>[0]["source"],
) {
  const missionId = `bundle-publication-test-${randomUUID()}`;
  const directory = path.join(outputRoot, missionId);
  created.push(directory);
  return {
    missionId,
    directory,
    completion: writeProofBundle({
      missionId,
      input,
      result,
      ...(source && { source }),
    }),
  };
}

afterEach(async () => {
  writes.before = undefined;
  writes.partialManifest = undefined;
  for (const directory of created.splice(0)) {
    const relative = path.relative(outputRoot, path.resolve(directory));
    if (!/^bundle-publication-test-[A-Za-z0-9-]+$/.test(relative)) {
      throw new Error(
        "Refusing to remove a directory outside the test fixtures.",
      );
    }
    await rm(directory, { recursive: true, force: true });
  }
});

describe("proof bundle publication", () => {
  it("writes immutable v3 outcomes and exact patch bytes without changing v2 semantics", async () => {
    const missionId = "bundle-publication-test-" + randomUUID();
    const directory = path.join(outputRoot, missionId);
    created.push(directory);
    const source = {
      mode: "THIRD_PARTY_JS_TS" as const,
      repositoryUrl: "https://github.com/owner/repo",
      targetBranch: "release/2.x",
      defaultBranch: "main",
      baseCommit: "a".repeat(40),
      githubIssue: {
        url: "https://github.com/owner/repo/issues/1",
        number: 1,
        title: input.issue,
        owner: "owner",
        repository: "repo",
      },
    };
    const strictResult: MissionResult = {
      ...result,
      outcome: "REPAIR_EVALUATED",
      verdict: "REVIEW_REQUIRED",
      patch: { ...result.patch!, diff: "exact patch\n\n" },
    };
    await writeProofBundle({ missionId, input, result: strictResult, source });
    const original = await readFile(path.join(directory, "proof.json"));
    const proof = JSON.parse(original.toString());
    expect(proof.version).toBe(3);
    expect(proof.outcome).toBe("REPAIR_EVALUATED");
    expect(proof.mission.source.targetBranch).toBe("release/2.x");
    expect(await readFile(path.join(directory, "patch.diff"), "utf8")).toBe(
      "exact patch\n\n",
    );
    await expect(
      writeProofBundle({ missionId, input, result: strictResult, source }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path.join(directory, "proof.json"))).toEqual(
      original,
    );
  });

  it("records early strict outcomes with null verdict and no candidate artifacts", async () => {
    const missionId = "bundle-publication-test-" + randomUUID();
    const directory = path.join(outputRoot, missionId);
    created.push(directory);
    await writeProofBundle({
      missionId,
      input,
      result: {
        status: "COMPLETED",
        outcome: "UNSUPPORTED_REPOSITORY",
        verdict: null,
        events: [],
        error: "Workspace repositories are unsupported.",
      },
      source: {
        mode: "THIRD_PARTY_JS_TS",
        repositoryUrl: "https://github.com/owner/repo",
        baseCommit: "a".repeat(40),
        targetBranch: "main",
        defaultBranch: "main",
      },
    });
    const proof = JSON.parse(
      await readFile(path.join(directory, "proof.json"), "utf8"),
    );
    expect(proof).toMatchObject({
      version: 3,
      outcome: "UNSUPPORTED_REPOSITORY",
      verdict: null,
      patch: null,
      error: "Workspace repositories are unsupported.",
      frozenReproduction: null,
      targetAfter: null,
    });
  });

  it("binds exact patch artifact bytes with SHA-256 and preserves optional GitHub issue source", async () => {
    const githubIssue = {
      url: "https://github.com/owner/repo/issues/12",
      number: 12,
      title: "Repair result",
      owner: "owner",
      repository: "repo",
      body: "Return the correct result.",
    };
    const source = {
      repositoryUrl: "https://github.com/owner/repo",
      baseCommit: "a".repeat(40),
      githubIssue,
    };
    const run = startBundle(source);
    await run.completion;
    const proof = JSON.parse(
      await readFile(path.join(run.directory, "proof.json"), "utf8"),
    );
    const bytes = await readFile(path.join(run.directory, "patch.diff"));
    expect(proof.patch.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(proof.mission.source).toEqual(source);
    expect(bytes.toString("utf8")).toBe(`${result.patch!.diff}\n`);
  });

  it("keeps proof absent while supporting evidence is being written", async () => {
    const blocked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    writes.before = async (filename) => {
      if (path.basename(filename) === "full-suite.json") {
        blocked.resolve();
        await release.promise;
      }
    };
    const run = startBundle();
    try {
      await blocked.promise;
      await expect(
        access(path.join(run.directory, "proof.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      release.resolve();
      await run.completion;
    }
    const proof = JSON.parse(
      await readFile(path.join(run.directory, "proof.json"), "utf8"),
    );
    expect(proof).toMatchObject({
      version: 2,
      mission: { id: run.missionId, issue: input.issue },
      status: "COMPLETED",
      verdict: "VERIFIED",
    });
    expect(
      JSON.parse(
        await readFile(path.join(run.directory, "events.json"), "utf8"),
      ),
    ).toEqual(result.events);
    expect(await readFile(path.join(run.directory, "patch.diff"), "utf8")).toBe(
      `${result.patch!.diff}\n`,
    );
    expect(
      await readFile(path.join(run.directory, "investigation.md"), "utf8"),
    ).toContain(result.investigation!.report);
    for (const [filename, evidence] of [
      ["baseline-test.json", result.evidence!.baselineTest],
      ["post-patch-test.json", result.evidence!.postPatchTest],
      ["full-suite.json", result.evidence!.fullSuite],
    ] as const) {
      expect(
        JSON.parse(
          await readFile(
            path.join(run.directory, "evidence", filename),
            "utf8",
          ),
        ),
      ).toEqual(evidence);
    }
  });

  it("does not expose a partial proof manifest to readers", async () => {
    const blocked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    writes.partialManifest = async () => {
      blocked.resolve();
      await release.promise;
    };
    const run = startBundle();
    try {
      await blocked.promise;
      await expect(
        access(path.join(run.directory, "proof.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      release.resolve();
      await run.completion;
    }
    expect(
      JSON.parse(
        await readFile(path.join(run.directory, "proof.json"), "utf8"),
      ),
    ).toMatchObject({ version: 2, mission: { id: run.missionId } });
    await expect(
      access(path.join(run.directory, "proof.json.tmp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves no published proof when writing supporting evidence fails", async () => {
    writes.before = async (filename) => {
      if (path.basename(filename) === "full-suite.json")
        throw new Error("Disk write failed");
    };
    const run = startBundle();
    await expect(run.completion).rejects.toThrow("Disk write failed");
    await expect(
      access(path.join(run.directory, "proof.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
