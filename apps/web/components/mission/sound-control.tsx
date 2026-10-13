"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icon";
import {
  isMissionSoundEnabled,
  playMissionSound,
  setMissionSoundEnabled,
  subscribeMissionSoundPreference,
} from "@/lib/mission-sound";

function subscribe(onStoreChange: () => void) {
  return subscribeMissionSoundPreference(() => onStoreChange());
}

export function SoundControl() {
  const enabled = useSyncExternalStore(
    subscribe,
    isMissionSoundEnabled,
    () => false,
  );

  async function toggle() {
    const next = !enabled;
    setMissionSoundEnabled(next);

    if (next) {
      await playMissionSound("start");
    }
  }

  return (
    <button
      className={`sound-toggle ${enabled ? "is-enabled" : ""}`}
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? "Mute mission sounds" : "Enable mission sounds"}
      title={enabled ? "Mission sounds on" : "Mission sounds off"}
      onClick={toggle}
    >
      <Icon
        name={enabled ? "volume" : "volume-off"}
        width="15"
        height="15"
      />
      <span className="sound-toggle-label">Sound</span>
      <span className="sound-toggle-state">{enabled ? "ON" : "OFF"}</span>
    </button>
  );
}
