import { describe, expect, it } from "vitest";

import {
  PATCHVERDICT_NODE_RUNTIME_BIN,
  PATCHVERDICT_NODE_RUNTIME_ROOT,
  PATCHVERDICT_NODE_VERSION,
  pinnedNodeArtifactForMachine,
} from "./node-runtime.js";

describe("pinned third-party Node runtime", () => {
  it("pins the supported runtime above modern Vite's Node 22 floor", () => {
    expect(PATCHVERDICT_NODE_VERSION).toBe("22.14.0");
    expect(PATCHVERDICT_NODE_RUNTIME_ROOT).toBe(
      "/tmp/patchverdict-node-v22.14.0",
    );
    expect(PATCHVERDICT_NODE_RUNTIME_BIN).toBe(
      "/tmp/patchverdict-node-v22.14.0/bin",
    );
  });

  it("selects checksum-pinned official archives for E2B architectures", () => {
    expect(pinnedNodeArtifactForMachine("x86_64")).toEqual({
      archiveName: "node-v22.14.0-linux-x64.tar.gz",
      sha256:
        "9d942932535988091034dc94cc5f42b6dc8784d6366df3a36c4c9ccb3996f0c2",
    });
    expect(pinnedNodeArtifactForMachine("aarch64")).toEqual({
      archiveName: "node-v22.14.0-linux-arm64.tar.gz",
      sha256:
        "8cf30ff7250f9463b53c18f89c6c606dfda70378215b2c905d0a9a8b08bd45e0",
    });
    expect(pinnedNodeArtifactForMachine("arm64")).toEqual(
      pinnedNodeArtifactForMachine("aarch64"),
    );
  });

  it("fails closed for unrecognized sandbox architectures", () => {
    expect(pinnedNodeArtifactForMachine("i686")).toBeNull();
    expect(pinnedNodeArtifactForMachine("")).toBeNull();
  });
});
