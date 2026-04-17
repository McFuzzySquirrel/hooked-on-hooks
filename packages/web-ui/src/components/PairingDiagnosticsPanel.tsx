import { useState, useEffect } from "react";

interface PairingDiagnostics {
  totalPairs: number;
  byMode: {
    toolCallId: number;
    spanId: number;
    heuristic: number;
  };
  unmatched: {
    preToolUse: number;
    postToolUse: number;
  };
}

interface Props {
  ingestBase: string;
}

interface TooltipState {
  title: string;
  body: string;
}

export function PairingDiagnosticsPanel({ ingestBase }: Props) {
  const [data, setData] = useState<PairingDiagnostics | null>(null);
  const [error, setError] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${ingestBase}/diagnostics/pairing`);
        if (!res.ok) throw new Error("non-ok");
        const body = (await res.json()) as PairingDiagnostics;
        if (!cancelled) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ingestBase]);

  if (error || data === null) return null;

  const { totalPairs, byMode, unmatched } = data;
  const totalUnmatched = unmatched.preToolUse + unmatched.postToolUse;

  return (
    <section
      aria-label="Tool pairing diagnostics"
      style={{
        fontSize: "0.75rem",
        background: "#1e1e2e",
        border: "1px solid #313244",
        borderRadius: 6,
        padding: "8px 12px",
        color: "#cdd6f4",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 600, color: "#89b4fa" }}>Tool Pairing</span>
      <Stat
        label="Pairs"
        value={totalPairs}
        color="#a6e3a1"
        title="Total matched tool calls"
        body="All preToolUse to postToolUse pairs found across the current session data, regardless of whether they matched exactly or by fallback heuristic."
        onHover={setTooltip}
      />
      <Stat
        label="by ID"
        value={byMode.toolCallId}
        color="#a6e3a1"
        title="Exact match by toolCallId"
        body="Highest-confidence pairing. The preToolUse and postToolUse events carried the same toolCallId in their payloads, so no heuristic was needed."
        onHover={setTooltip}
      />
      <Stat
        label="by Span"
        value={byMode.spanId}
        color="#f9e2af"
        title="Exact match by spanId"
        body="Second-tier exact pairing. No toolCallId was available, but both events carried the same spanId in the envelope, so the pair was still correlated precisely."
        onHover={setTooltip}
      />
      <Stat
        label="Heuristic"
        value={byMode.heuristic}
        color="#fab387"
        title="Fallback FIFO heuristic"
        body="Lowest-confidence pairing. No exact toolCallId or spanId match was available, so the ingest service paired events by tool name and arrival order."
        onHover={setTooltip}
      />
      {totalUnmatched > 0 && (
        <Stat
          label="Unmatched"
          value={totalUnmatched}
          color="#f38ba8"
          title="Events without a matching pair"
          body="These preToolUse or postToolUse events could not be paired at all. This usually indicates missing end events, incomplete metadata, or out-of-order input."
          onHover={setTooltip}
        />
      )}
      {tooltip && <Tooltip {...tooltip} />}
    </section>
  );
}

function Stat({
  label,
  value,
  color,
  title,
  body,
  onHover,
}: {
  label: string;
  value: number;
  color: string;
  title: string;
  body: string;
  onHover: (state: TooltipState | null) => void;
}) {
  return (
    <span
      onMouseEnter={() => onHover({ title, body })}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: "help", position: "relative" }}
      aria-label={`${label}: ${value}. ${title}. ${body}`}
      title={`${title}: ${body}`}
    >
      <span style={{ color: "#6c7086" }}>{label}: </span>
      <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </span>
  );
}

function Tooltip({ title, body }: TooltipState) {
  return (
    <div
      role="tooltip"
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 12,
        zIndex: 20,
        width: 320,
        background: "#111827",
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "10px 12px",
        boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
        color: "#e2e8f0",
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#94a3b8" }}>{body}</div>
    </div>
  );
}
