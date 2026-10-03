import type { MissionEvent } from "@/lib/mock-mission";
import { Icon } from "./icon";

export function FlightRecorder({ events }: { events: MissionEvent[] }) {
  return (
    <section className="panel flight-panel" aria-labelledby="flight-title">
      <div className="panel-header">
        <div className="panel-heading"><Icon name="activity" /><h2 id="flight-title">Flight Recorder</h2></div>
        <span className="panel-meta">{events.length} events <span className="muted-separator">/</span> UTC</span>
      </div>
      <ol className="event-list">
        {events.map((event, index) => (
          <li className={`event-row state-${event.state.toLowerCase()}`} key={`${event.timestamp}-${index}`}>
            <span className="event-node" aria-hidden="true">{event.state === "COMPLETED" && <Icon name="check" width="10" height="10" />}</span>
            <time dateTime={event.timestamp}>{new Date(event.timestamp).toISOString().slice(11, 19)}</time>
            <span className="event-state">{event.state}</span>
            <span className="event-message">{event.message}</span>
          </li>
        ))}
      </ol>
      <div className="panel-footer"><span className="status-dot green" />Chronological execution record<span className="ml-auto font-mono">END OF RUN</span></div>
    </section>
  );
}
