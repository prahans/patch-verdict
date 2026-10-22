import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_MISSION_TIMEOUT_MS = 270_000;
const deadlines = new AsyncLocalStorage<number>();

// Each mission owns its budget, including when several missions share a process.
export function withMissionDeadline<T>(
  deadlineAtMs: number,
  operation: () => T,
): T {
  if (!Number.isSafeInteger(deadlineAtMs) || deadlineAtMs <= 0) {
    throw new Error(
      "The mission deadline must be a positive Unix timestamp in milliseconds.",
    );
  }
  return deadlines.run(deadlineAtMs, operation);
}

export function getMissionDeadline(): number {
  return deadlines.getStore() ?? Date.now() + DEFAULT_MISSION_TIMEOUT_MS;
}

export function resolveMissionDeadline(
  value = process.env.PATCHVERDICT_MISSION_DEADLINE_MS,
  now = Date.now(),
): number {
  if (value === undefined) return now + DEFAULT_MISSION_TIMEOUT_MS;
  const deadline = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(deadline) || deadline <= 0) {
    throw new Error(
      "PATCHVERDICT_MISSION_DEADLINE_MS must be a positive Unix timestamp in milliseconds.",
    );
  }
  return deadline;
}
