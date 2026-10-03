import type { MissionResult } from "@/lib/mock-mission";
import { Icon } from "./icon";

export function InvestigationReport({ investigation, details }: {
  investigation: NonNullable<MissionResult["investigation"]>;
  details: { sourcePath: string; testPath: string };
}) {
  return (
    <section className="panel investigation-panel" aria-labelledby="investigation-title">
      <div className="panel-header">
        <div className="panel-heading"><Icon name="spark" /><h2 id="investigation-title">Investigation Report</h2></div>
        <span className="layer-label amber">AI REASONING</span>
      </div>
      <div className="investigation-body">
        <p className="eyebrow">ROOT CAUSE ANALYSIS</p>
        <p className="report-text">{investigation.report}</p>
        <dl className="report-references">
          <div><dt>Source</dt><dd><Icon name="file" width="14" height="14" /><code>{details.sourcePath}</code></dd></div>
          <div><dt>Test</dt><dd><Icon name="file" width="14" height="14" /><code>{details.testPath}</code></dd></div>
        </dl>
      </div>
      <div className="panel-footer"><Icon name="spark" width="13" height="13" /><span>{investigation.iterations} investigation iterations</span><span className="ml-auto text-amber">Reasoning, not proof</span></div>
    </section>
  );
}
