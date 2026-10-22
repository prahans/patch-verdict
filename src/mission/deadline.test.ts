import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MISSION_TIMEOUT_MS,
  getMissionDeadline,
  resolveMissionDeadline,
  withMissionDeadline,
} from "./deadline.js";

afterEach(() => vi.useRealTimers());

describe("mission request deadlines", () => {
  it("starts a CLI budget once and accepts the earlier web deadline without extending it", () => {
    vi.stubEnv("PATCHVERDICT_MISSION_DEADLINE_MS", undefined);
    try {
      expect(resolveMissionDeadline(undefined, 1_000)).toBe(1_000 + DEFAULT_MISSION_TIMEOUT_MS);
      expect(resolveMissionDeadline("2000", 100_000)).toBe(2_000);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["", "-1", "0", "1.5", "NaN", "Infinity", "9e9", "secret-value", "9007199254740992"])(
    "rejects an invalid deadline without echoing the value (%s)", (value) => {
      expect(() => resolveMissionDeadline(value, 1_000)).toThrow(
        "PATCHVERDICT_MISSION_DEADLINE_MS must be a positive Unix timestamp in milliseconds.",
      );
    },
  );

  it("keeps overlapping async mission budgets isolated and restores the outer context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const readLater = async () => {
      await gate;
      return getMissionDeadline();
    };
    const first = withMissionDeadline(30_000, readLater);
    const second = withMissionDeadline(60_000, readLater);
    release();
    expect(await first).toBe(30_000);
    expect(await second).toBe(60_000);
    expect(getMissionDeadline()).toBe(Date.now() + DEFAULT_MISSION_TIMEOUT_MS);
  });

  it("does not refresh a mission deadline after an awaited operation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    await withMissionDeadline(30_000, async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(getMissionDeadline()).toBe(30_000);
    });
  });
});
