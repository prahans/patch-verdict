import type { ReactNode } from "react";
import type { MissionDetails, MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

// React escapes report content; saved reports are never treated as HTML.
function inlineReport(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function ReportContent({ report }: { report: string }) {
  const lines = report.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const key = index;
    if (line.startsWith("```")) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key} tabIndex={0}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      blocks.push(<h3 key={key}>{inlineReport(heading[1])}</h3>);
      index++;
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|\d+\.)\s+(.+)/);
    if (list) {
      const ordered = !list[1];
      const pattern = ordered ? /^\s*\d+\.\s+(.+)/ : /^\s*[-*+]\s+(.+)/;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = lines[index].match(pattern);
        if (!item) break;
        items.push(<li key={index}>{inlineReport(item[1])}</li>);
        index++;
      }
      blocks.push(ordered ? <ol key={key} start={Number.parseInt(line.trim(), 10)}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !/^(?:```|#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inlineReport(paragraph.join("\n"))}</p>);
  }

  return <div className="report-text report-markdown">{blocks}</div>;
}

export function InvestigationReport({ investigation, details }: {
  investigation: MissionResult["investigation"];
  details: Pick<MissionDetails, "sourcePath" | "testPath">;
}) {
  return (
    <section className="panel investigation-panel" aria-labelledby="investigation-title">
      <div className="panel-header">
        <div className="panel-heading"><Icon name="spark" /><h2 id="investigation-title">Investigation Report</h2></div>
        <span className="layer-label amber">AI REASONING</span>
      </div>
      <div className="investigation-body">
        <p className="eyebrow">ROOT CAUSE ANALYSIS</p>
        {investigation?.report?.trim() ? <ReportContent report={investigation.report} /> : <p className="report-text is-unavailable">No investigation report is available in this proof bundle.</p>}
        <dl className="report-references">
          <div><dt>Source</dt><dd><Icon name="file" width="14" height="14" /><code>{details.sourcePath ?? "Unavailable"}</code></dd></div>
          <div><dt>Test</dt><dd><Icon name="file" width="14" height="14" /><code>{details.testPath ?? "Unavailable"}</code></dd></div>
        </dl>
      </div>
      <div className="panel-footer"><Icon name="spark" width="13" height="13" /><span>{investigation?.iterations !== undefined ? `${investigation.iterations} investigation iterations` : "Investigation iterations unavailable"}</span><span className="ml-auto text-amber">Reasoning, not proof</span></div>
    </section>
  );
}
