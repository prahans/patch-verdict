"use client";

import { useState } from "react";
import type { MissionResult } from "@/lib/mock-mission";

type DiffLine = {
  content: string;
  kind: "context" | "added" | "removed" | "hunk" | "meta";
  oldNumber?: number;
  newNumber?: number;
};

function parseDiff(diff: string): DiffLine[] {
  let oldNumber = 1;
  let newNumber = 1;

  return diff.replace(/\r\n/g, "\n").trimEnd().split("\n").map((line) => {
    if (line.startsWith("@@")) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldNumber = Number(hunk[1]);
        newNumber = Number(hunk[2]);
      }
      return { content: line, kind: "hunk" };
    }

    if (line.startsWith("diff ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("\\")) {
      return { content: line, kind: "meta" };
    }

    if (line.startsWith("+")) {
      return { content: line.slice(1), kind: "added", newNumber: newNumber++ };
    }

    if (line.startsWith("-")) {
      return { content: line.slice(1), kind: "removed", oldNumber: oldNumber++ };
    }

    return {
      content: line.startsWith(" ") ? line.slice(1) : line,
      kind: "context",
      oldNumber: oldNumber++,
      newNumber: newNumber++,
    };
  });
}

export function DiffViewer({ patch }: { patch: NonNullable<MissionResult["patch"]> }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const lines = parseDiff(patch.diff);
  const additions = lines.filter((line) => line.kind === "added").length;
  const deletions = lines.filter((line) => line.kind === "removed").length;

  async function copyDiff() {
    try {
      await navigator.clipboard.writeText(patch.diff);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <section className="panel diff-panel" id="candidate-patch" aria-labelledby="patch-heading">
      <div className="panel-header">
        <div className="panel-heading">
          <span className="eyebrow">Git evidence</span>
          <h2 id="patch-heading">Candidate patch</h2>
          <p className="panel-description">The proposed change, captured from the working tree.</p>
        </div>
        <button className="copy-button" type="button" onClick={copyDiff} aria-label="Copy complete patch diff">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" stroke="currentColor" />
            <path d="M10.5 3.5V2.5a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1" stroke="currentColor" />
          </svg>
          <span aria-live="polite">{copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Retry copy" : "Copy diff"}</span>
        </button>
      </div>
      {copyStatus === "failed" && <p className="panel-description" role="status">Clipboard access is unavailable. Select the diff below to copy it.</p>}
      <div className="diff-toolbar">
        <div className="diff-file">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9.5 1.5h-6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-8l-4-4Z" stroke="currentColor" />
            <path d="M9.5 1.5v4h4" stroke="currentColor" />
          </svg>
          <span>{patch.changedFiles.join(", ")}</span>
        </div>
        <div className="diff-stats" aria-label={`${additions} lines added, ${deletions} lines removed`}>
          <span className="additions">+{additions}</span>
          <span className="deletions">−{deletions}</span>
        </div>
      </div>
      <div className="diff-scroll" tabIndex={0} role="region" aria-label="Candidate patch diff, scroll horizontally to read long lines">
        <table className="diff-table" aria-label="Unified patch diff with original and updated line numbers">
          <tbody>
            {lines.map((line, index) => (
              <tr className={`diff-line diff-line-${line.kind}`} key={index}>
                <td className="diff-gutter" aria-label={line.oldNumber ? `Original line ${line.oldNumber}` : undefined}>{line.oldNumber}</td>
                <td className="diff-gutter" aria-label={line.newNumber ? `Updated line ${line.newNumber}` : undefined}>{line.newNumber}</td>
                <td className="diff-marker" aria-label={line.kind === "added" ? "Added" : line.kind === "removed" ? "Removed" : undefined}>{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</td>
                <td className="diff-code"><code>{line.content || " "}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-footer">
        <span>{patch.changedFiles.length} {patch.changedFiles.length === 1 ? "file" : "files"} changed</span>
        <span>Base <code>{patch.baseCommit.slice(0, 7)}</code></span>
      </div>
    </section>
  );
}
