/**
 * Export controls for event data (PRIV-FR-04).
 * Export is disabled by default and requires explicit destination configuration.
 */
export interface ExportConfig {
  /** Whether export is explicitly enabled. Defaults to false. */
  enabled: boolean;
  /** Required when enabled. Must be a non-empty destination string (URL or path). */
  destination?: string;
}

/** Safe default: export is disabled with no destination configured. */
export const DEFAULT_EXPORT_CONFIG: ExportConfig = { enabled: false };

/**
 * Type guard that returns true only when export is explicitly enabled AND a
 * non-empty destination is configured. Satisfies PRIV-FR-04.
 */
export function canExport(config: ExportConfig): config is ExportConfig & { destination: string } {
  return (
    config.enabled === true &&
    typeof config.destination === "string" &&
    config.destination.trim().length > 0
  );
}
