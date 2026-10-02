import type { MissionEvent, MissionState } from "./types.js";

export function createMissionEvent(
  state: MissionState,
  message: string,
): MissionEvent {
  return {
    timestamp: new Date().toISOString(),
    state,
    message,
  };
}
