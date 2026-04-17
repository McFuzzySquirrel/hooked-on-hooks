import { EVENT_TYPES } from "../../../../shared/event-schema/src/index.js";
import type { FilterConfig } from "../types.js";

interface Props {
  filter: FilterConfig;
  onChange: (filter: FilterConfig) => void;
}

/**
 * Filter controls for narrowing the event timeline by type and actor (LIVE-FR-05).
 * All controls are keyboard-operable (ACC-02) and properly labelled (ACC-01).
 */
export function FilterControls({ filter, onChange }: Props) {
  return (
    <div role="search" aria-label="Filter controls">
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Filters</h2>
      <label
        htmlFor="actor-filter"
        style={{ fontSize: "0.85rem", color: "#94a3b8", display: "block", marginBottom: 4 }}
      >
        Actor / Tool Name
      </label>
      <input
        id="actor-filter"
        type="text"
        value={filter.actorName ?? ""}
        onChange={(e) =>
          onChange({ ...filter, actorName: e.target.value || undefined })
        }
        placeholder="Filter by agent or tool name…"
        style={{ marginBottom: "0.75rem", width: "100%" }}
      />

      <fieldset>
        <legend>Event Types</legend>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <button
            type="button"
            onClick={() => onChange({ ...filter, eventTypes: [...EVENT_TYPES] })}
            style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}
          >
            Select All
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filter, eventTypes: undefined })}
            style={{ fontSize: "0.78rem", padding: "0.2rem 0.5rem" }}
          >
            Clear All
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.25rem 0.75rem",
          }}
        >
          {EVENT_TYPES.map((et) => (
            <label
              key={et}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.82rem",
                cursor: "pointer",
                padding: "2px 0",
                color: "#f1f5f9",
              }}
            >
              <input
                type="checkbox"
                checked={filter.eventTypes?.includes(et) ?? false}
                onChange={(e) => {
                  const current = filter.eventTypes ?? [];
                  const next = e.target.checked
                    ? [...current, et]
                    : current.filter((t) => t !== et);
                  onChange({ ...filter, eventTypes: next.length > 0 ? next : undefined });
                }}
              />
              {et}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
