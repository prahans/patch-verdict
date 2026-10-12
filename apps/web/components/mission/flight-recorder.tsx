"use client";

import { useEffect, useRef, useState } from "react";
import type { MissionEvent } from "@/lib/mission-types";
import { Icon } from "./icon";

// Presentation of recorded messages only; this never advances a proof check.
function liveEventTone(event: MissionEvent) {
  const { state, message } = event;
  if (state === "FAILED" || message === "Mission completed with verdict FAILED" ||
    message.startsWith("Verification integrity compromised") ||
    message.startsWith("Reproduction test still fails") || message === "Full test suite fails") return "failed";
  if (message.startsWith("Verification requires human review") ||
    message === "Mission completed with verdict REVIEW_REQUIRED") return "review";
  if (["Reported bug reproduced", "AI investigation completed", "Candidate patch applied",
    "Git diff captured", "Verification integrity preserved", "Reproduction test passes after patch",
    "Reproduction test passes after correction", "Full test suite passes",
    "Mission completed with verdict VERIFIED"].includes(message) ||
    /^Git captured \d+ changed file\(s\)$/.test(message)) return "passed";
  if ((state === "PREPARING" && ["Backend process started.", "Preparing repository..."].includes(message)) ||
    (state === "BASELINE" && message === "Running reproduction test before patch") ||
    (state === "INVESTIGATING" && message === "AI investigation started") ||
    (state === "PATCHING" && ["AI patch phase started", "Reproduction failed; starting the single correction attempt"].includes(message)) ||
    (state === "VERIFYING" && ["Running reproduction test after patch", "Running reproduction test after correction", "Running full test suite"].includes(message)) ||
    (state === "VERDICT" && message === "Calculating deterministic verdict")) return "running";
  return "recorded";
}

export function FlightRecorder({
  events,
  live = false,
  activePhase,
}: {
  events: MissionEvent[];
  live?: boolean;
  activePhase?: MissionEvent["state"];
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef<number | null>(null);
  const [initialEventCount] = useState(events.length);
  const eventCount = events.length;
  const lastState = events.at(-1)?.state;
  const lastTone = live && events.length > 0 ? liveEventTone(events[events.length - 1]) : undefined;
  const footerTone = live
    ? lastTone === "passed" ? "green" : lastTone === "failed" ? "is-failed" : lastTone ? "amber" : "is-unavailable"
    : lastState === "COMPLETED" ? "green" : lastState === "FAILED" ? "is-failed" : "is-unavailable";

  useEffect(() => {
    if (!live || !viewportRef.current) return;
    const appended = previousCount.current !== null && eventCount > previousCount.current;
    previousCount.current = eventCount;
    // Scroll only this viewport, never its page ancestors. Restored history is
    // positioned instantly; only an actual count increase scrolls smoothly.
    viewportRef.current.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: appended && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "smooth" : "instant",
    });
  }, [eventCount, live]);

  const eventList = events.length === 0 ? (
    live ? (
      <p className="live-event-empty">
        <span className={`status-dot ${activePhase ? "live-pulse" : ""}`} aria-hidden="true" />
        <span>
          {activePhase ? "Waiting for backend evidence..." : "No execution events were recorded."}
          {activePhase && <span className="live-terminal-cursor" aria-hidden="true" />}
        </span>
      </p>
    ) : <p className="artifact-unavailable">No execution events were recorded in this proof bundle.</p>
  ) : (
    <ol className="event-list">
      {events.map((event, index) => {
        const tone = live ? liveEventTone(event) : undefined;
        const isActive = live && index === events.length - 1 &&
          event.state === activePhase && tone === "running";
        // Stable keys keep entrance animations from replaying on each poll.
        const isNew = live && index >= initialEventCount;
        return (
          <li
            className={`event-row state-${event.state.toLowerCase()}${live ? ` live-event-${tone}` : ""}${isNew ? " live-event-new" : ""}${isActive ? " live-event-active" : ""}`}
            key={`${event.timestamp}-${index}`}
          >
            <span className={`event-node ${isActive ? "live-pulse" : ""}`} aria-hidden="true">
              {(live ? tone === "passed" : event.state === "COMPLETED") && <Icon name="check" width="10" height="10" />}
            </span>
            <time dateTime={event.timestamp}>{new Date(event.timestamp).toISOString().slice(11, 19)}</time>
            <span className="event-state">{event.state}</span>
            <span className="event-message">
              {event.message}
              {isActive && <span className="live-terminal-cursor" aria-hidden="true" />}
            </span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <section className="panel flight-panel" aria-labelledby="flight-title">
      <div className="panel-header">
        <div className="panel-heading"><Icon name="activity" /><h2 id="flight-title">Flight Recorder</h2></div>
        <span className="panel-meta">{events.length} events <span className="muted-separator">/</span> UTC</span>
      </div>
      {live ? (
        <div className="live-flight-scroll" ref={viewportRef} tabIndex={0} role="region" aria-label="Flight Recorder events">
          {eventList}
        </div>
      ) : eventList}
      <div className="panel-footer"><span className={`status-dot ${footerTone}`} />Chronological execution record<span className="ml-auto font-mono">SAVED EVENTS</span></div>
    </section>
  );
}
