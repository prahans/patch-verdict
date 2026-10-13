"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import {
  isMissionSoundEnabled,
  playMissionSound,
  setMissionSoundEnabled,
  subscribeMissionSoundPreference,
} from "@/lib/mission-sound";

export function SoundControl() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEnabled(isMissionSoundEnabled());
    setReady(true);
    return subscribeMissionSoundPreference(setEnabled);
  }, []);

  async function toggle() {
    const next = !enabled;
    setMissionSoundEnabled(next);
    setEnabled(next);

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
      disabled={!ready}
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
