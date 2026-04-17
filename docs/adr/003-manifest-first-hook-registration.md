# ADR-003: Manifest-First Hook Registration with Full Event Coverage

- Status: Accepted
- Date: 2026-04-14

## Context

The bootstrap tooling maintained a `HOOK_MAP` that mapped shell-script filenames
to event types and payload snippets. This map covered only 7 of the 11 canonical
event types — `postToolUseFailure`, `agentStop`, `notification`, and
`errorOccurred` were absent. Repos bootstrapped without explicit hook scripts for
those events had no way to capture them.

Additionally, hook registration relied on two ad-hoc mechanisms:

1. **Script-based discovery** — the bootstrap script scanned `.github/hooks/`
   for shell files whose names matched the `HOOK_MAP` and wired them to the
   emitter.
2. **Manifest patching** — if a compatible JSON manifest (e.g. `ejs-hooks.json`)
   already existed in `.github/hooks/`, the bootstrap script added missing
   event entries to it.

Neither mechanism owned a single, authoritative declaration of "what the
visualizer needs." If no manifest existed and no matching scripts were present,
the visualizer had no reliable way to discover which events were configured.

## Decision

1. **Close the HOOK_MAP coverage gap.** Add entries for all 11 event types in
   both `bootstrap-existing-repo.ts` and `unbootstrap-existing-repo.ts`, each
   with appropriate payload snippets, environment-variable fallbacks, and
   timeout defaults.

2. **Introduce a dedicated visualizer manifest.** During bootstrap, always
   create `.github/hooks/visualizer/visualizer-hooks.json` — a machine-readable manifest
   that declares every covered event type with its corresponding hook command.
   This file is:
   - Distinct from user-managed or EJS manifests.
   - Auto-generated and overwritten on each bootstrap run.
   - The single source of truth for what the visualizer captures.
   - Cleaned up automatically by `unbootstrap`.

3. **Keep third-party manifest patching.** Continue scanning for compatible
   manifests (e.g. `ejs-hooks.json`) and adding missing entries for interop, but
   skip the visualizer's own manifest during this pass to avoid circular edits.

4. **Fix canonical-name derivation.** Replace the `name.includes("-")` filter
   with an event-type deduplication IIFE that handles entries without a
   hyphenated variant (e.g. `notification.sh`).

## Rationale

1. Full event coverage eliminates silent gaps — operators no longer need to
   manually wire the four missing event types.
2. A dedicated manifest makes hook registration declarative and inspectable.
   Tools, CI, and humans can read one file to understand the visualizer's
   surface area.
3. Keeping third-party manifest patching preserves backward compatibility with
   EJS overlays and other consumers that expect entries in their own manifests.
4. The canonical-name fix prevents future regressions when adding event types
   whose filenames lack a hyphenated/non-hyphenated pair.

## Consequences

### Positive

1. All 11 event types are captured out of the box after bootstrap.
2. `visualizer-hooks.json` can be committed to version control, making the hook
   contract visible in code review.
3. `syncHookManifests` no longer silently no-ops when no third-party manifest
   exists — the visualizer manifest is always created.
4. Unbootstrap cleanly removes the manifest without touching user manifests.

### Negative

1. Existing repos bootstrapped before this change must re-run bootstrap (or
   unbootstrap + bootstrap) to gain the four new event types and the manifest.
2. The `.github/hooks/visualizer/` subdirectory contains visualizer-owned files that
   operators should not manually edit (they are overwritten on re-bootstrap).

## Alternatives Considered

### A) Extend the existing manifest-patching approach without a dedicated file

Rejected because it left the visualizer without a manifest when no
third-party manifest existed, and it entangled visualizer entries with
user-managed manifests.

### B) Store the manifest in `.visualizer/` instead of `.github/hooks/visualizer/`

Rejected because hook consumers and tooling expect manifests in
`.github/hooks/`. Placing the manifest elsewhere would require additional
discovery logic and break conventions.

### C) Keep only 7 event types and let users add the remaining 4 manually

Rejected because the whole point of bootstrap is to minimize manual setup.
Silent gaps in event coverage undermine the value of the visualizer.

## Follow-Up Actions

1. Update the hooked-on-hooks learning guide with the manifest-first pattern.
2. Consider emitting a deprecation warning when bootstrapping a repo that
   already has stale stub scripts for the previously missing event types.
3. Evaluate whether the visualizer manifest should include a
   `schemaVersion` field for future migration support.
