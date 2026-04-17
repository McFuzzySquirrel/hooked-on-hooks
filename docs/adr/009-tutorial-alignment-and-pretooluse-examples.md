# ADR-009: Tutorial Alignment and preToolUse Examples Standardisation

- Status: Accepted
- Date: 2026-04-17

## Context

The project ships two parallel tutorial tracks — Bash/Linux and PowerShell —
that walk users from raw vanilla hooks to the full visualiser pipeline. Over
successive feature iterations, tutorial code snippets drifted from the actual
generated scripts:

1. The Bash tutorial (Part 1 and Part 6) showed a simplified 4-line vanilla
   `preToolUse` snippet that did not match the real vanilla example in
   `docs/examples/vanilla-hooks/pre-tool-use.sh`.
2. The PowerShell tutorial used a `Get-VizValue` function with
   `-AsHashtable` conversion — a pattern that does not exist in the codebase.
   The actual bootstrap generates `_vizField` and `_vizNested` helpers that
   use `PSObject.Properties[]` lookup.
3. The PS1 tutorials lacked the structural depth and step-by-step rigor of
   the Bash tutorials (missing "Try it yourself" walkthroughs, expected
   output examples, and optional visualiser checkpoints).
4. `preToolUse` was selected as the canonical example across both tracks
   because it is the most commonly triggered hook, provides clear
   copy-paste-and-test payloads, and covers both the vanilla and enriched
   workflows in a single event type.

When code examples in documentation diverge from the real generated output,
users who copy-paste get unexpected results, which erodes trust in the
tutorial and increases support friction.

## Decision

Align all tutorial code snippets with the actual scripts (vanilla examples
and bootstrap output), standardise on `preToolUse` as the primary worked
example, and bring PowerShell tutorial depth to parity with the Bash track.

### 1) Single Source of Truth for Code Snippets

Tutorial code blocks must be direct copies from, or verifiably equivalent to,
the actual vanilla example files (`docs/examples/vanilla-hooks/`) and the
bootstrap output (`scripts/bootstrap-existing-repo.ts`). If the generated
scripts change, the tutorials must be updated in the same change set.

### 2) preToolUse as Canonical Example

Use `preToolUse` as the primary worked example across all six tutorial parts.
It is the most frequently triggered hook type, has a clear stdin-to-payload
transformation, and covers all tutorial layers (vanilla → schema → enrichment
→ synthesis → emit → bootstrap).

### 3) PowerShell Parity with Bash

PS1 tutorials must match the structural depth and pedagogical style of the
Bash tutorials:

- Bootstrap-first setup (not manual file copy)
- Detailed hook-types table with real payload examples
- Step-by-step "Try it yourself" blocks with expected output
- Optional visualiser checkpoint at each part boundary
- Real `_vizField`/`_vizNested` helper patterns (not fabricated functions)
- Tracing v2 correlation IDs coverage in Parts 2 and 5
- Next Steps links and ADR cross-references in Part 6

### 4) Diff Visibility in Part 6

Both Part 6 tracks (Bash and PowerShell) show the complete vanilla script
side-by-side with the enhanced version, so users can see exactly which lines
the visualiser adds. The vanilla scripts shown must be byte-for-byte
identical to the actual example files.

## Rationale

1. Users copy-paste from tutorials; accuracy is a correctness requirement,
   not a polish item.
2. Converging on one canonical example hook (`preToolUse`) reduces the
   tutorial surface area without losing generality.
3. PowerShell users are a growing audience (Windows Copilot CLI) and deserve
   the same guided experience as Bash users.
4. Embedding checkpoint prompts at part boundaries encourages incremental
   verification, reducing the distance between mistake and detection.

## Consequences

### Positive

1. Copy-paste from any tutorial part produces working scripts.
2. PowerShell users get the same onboarding quality as Bash users.
3. Single canonical example reduces maintenance burden for future hook
   changes.
4. Closer alignment between tutorials and generated code makes tutorial
   regression easier to detect.

### Negative

1. Future changes to vanilla examples or bootstrap output require
   coordinated tutorial updates.
2. Standardising on `preToolUse` means other hook types (e.g., `postToolUse`
   conditional routing) are only shown contextually in Part 4, not as
   primary worked examples.

## Alternatives Considered

### A) Keep tutorials loosely illustrative (pseudo-code style)

Rejected because copy-paste accuracy matters more than brevity for learning
materials.

### B) Auto-generate tutorial snippets from source at build time

Considered but deferred. Build-time extraction would eliminate drift entirely
but adds tooling complexity that is not justified at the current tutorial
size.

### C) Use `postToolUse` as the canonical example (demonstrates branching)

Rejected because `postToolUse` adds conditional routing complexity that
obscures the vanilla-to-enriched progression. Branching is covered in Part 4
where it naturally belongs.

## Cross-links

- ADR-007: `007-readme-quickstart-and-doc-depth-split.md`
- ADR-008: `008-tracing-ux-and-doc-consolidation.md`
- Vanilla examples: `docs/examples/vanilla-hooks/`
- Bash tutorial: `docs/tutorials/from-vanilla-to-visualizer/`
- PS1 tutorial: `docs/tutorials/from-vanilla-to-visualizer-ps1/`
- Bootstrap source: `scripts/bootstrap-existing-repo.ts`

## Follow-Up Actions

1. Any change to vanilla example files or bootstrap stub generators must
   include a tutorial review in the same PR.
2. Consider build-time snippet extraction if the tutorial surface grows
   beyond the current 12-part (6×2 tracks) scope.
3. Validate PS1 tutorial commands on Windows PowerShell 5.1 and PowerShell
   7.x periodically.
