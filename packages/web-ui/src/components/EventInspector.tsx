import type { InspectorEntry } from "../types.js";

interface Props {
  entry: InspectorEntry | null;
}

const panelStyle: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 10,
  border: "1px solid #475569",
  padding: "1rem 1.25rem",
  position: "sticky",
  top: "1.5rem",
};

/**
 * Displays detailed information for a selected timeline event (LIVE-FR-04).
 * When no entry is selected, shows a placeholder.
 */
export function EventInspector({ entry }: Props) {
  if (!entry) {
    return (
      <aside aria-label="Event inspector" style={panelStyle}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Event Inspector</h3>
        <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
          Select a timeline entry to inspect.
        </p>
      </aside>
    );
  }

  return (
    <aside aria-label="Event inspector" style={panelStyle}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Event Inspector</h3>
      <dl>
        <dt>Event ID</dt>
        <dd><code>{entry.eventId}</code></dd>
        <dt>Type</dt>
        <dd>{entry.eventType}</dd>
        <dt>Timestamp</dt>
        <dd>{entry.timestamp}</dd>
        <dt>Session ID</dt>
        <dd>{entry.sessionId}</dd>
        {entry.turnId && (
          <>
            <dt>Turn ID</dt>
            <dd><code>{entry.turnId}</code></dd>
          </>
        )}
        {entry.traceId && (
          <>
            <dt>Trace ID</dt>
            <dd><code>{entry.traceId}</code></dd>
          </>
        )}
        {entry.spanId && (
          <>
            <dt>Span ID</dt>
            <dd><code>{entry.spanId}</code></dd>
          </>
        )}
        {entry.parentSpanId && (
          <>
            <dt>Parent Span ID</dt>
            <dd><code>{entry.parentSpanId}</code></dd>
          </>
        )}
      </dl>
      <pre
        aria-label="Event payload"
        style={{
          background: "#0f172a",
          padding: "0.75rem 1rem",
          overflow: "auto",
          borderRadius: 6,
          border: "1px solid #475569",
          fontSize: "0.8rem",
          marginTop: "0.75rem",
          color: "#f1f5f9",
          maxHeight: 320,
        }}
      >
        {JSON.stringify(entry.payload, null, 2)}
      </pre>
    </aside>
  );
}
