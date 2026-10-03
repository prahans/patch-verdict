import type { MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

export function MissionHeader({ verdict }: { verdict: MissionResult["verdict"] }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="brand-group">
          <a href="#mission" className="brand" aria-label="PatchVerdict Mission Control">
            <span className="brand-symbol"><Icon name="shield" width="25" height="25" /></span>
            <span>PATCH<span className="brand-secondary">VERDICT</span><span className="brand-period">.</span></span>
          </a>
          <span className="brand-tagline">Every patch earns its verdict.</span>
        </div>
        <span className={`verdict-badge ${verdict === "VERIFIED" ? "is-verified" : verdict === "FAILED" ? "is-failed" : "is-unavailable"}`}>
          <Icon name="shield" width="15" height="15" />{verdict ?? "UNAVAILABLE"}
        </span>
      </div>
    </header>
  );
}
