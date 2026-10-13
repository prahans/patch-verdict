"use client";

import { useEffect } from "react";
import type { MissionResult } from "@/lib/mission-types";
import { playMissionSoundOnce } from "@/lib/mission-sound";

export function VerdictSound({
  missionId,
  verdict,
}: {
  missionId: string;
  verdict: MissionResult["verdict"];
}) {
  useEffect(() => {
    if (!verdict) return;

    const kind =
      verdict === "VERIFIED"
        ? "verified"
        : verdict === "REVIEW_REQUIRED"
          ? "review"
          : "failed";

    void playMissionSoundOnce(`${missionId}:verdict:${verdict}`, kind);
  }, [missionId, verdict]);

  return null;
}
