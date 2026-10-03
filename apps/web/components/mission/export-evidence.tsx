"use client";

import type { MissionResult } from "@/lib/mock-mission";
import { Icon } from "./icon";

export function ExportEvidence({ mission, missionId }: { mission: MissionResult; missionId: string }) {
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ missionId, dataSource: "mock", ...mission }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${missionId.toLowerCase()}-evidence.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <button className="action-button" type="button" onClick={download}><Icon name="download" width="15" height="15" />Export evidence</button>;
}
