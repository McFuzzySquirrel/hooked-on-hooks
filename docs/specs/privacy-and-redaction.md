# Spec: Privacy and Redaction Policy

## Objective

Prevent sensitive data leakage while preserving useful runtime observability.

## Data Handling Principles

1. Local-first storage by default.
2. Minimum necessary data collection.
3. Explicit opt-in for external export.
4. Redact before persist and before transmit.

## Sensitive Inputs

Treat these as sensitive and redact by default:

1. API keys and tokens
2. Password-like strings
3. Secret environment variable values
4. Private URLs with embedded credentials

## Redaction Rules (MVP)

1. Pattern-based replacement for common token formats.
2. Structured field suppression for `toolArgs.command` values that include
credential patterns.
3. Prompt truncation option for high-compliance environments.

## Storage Policy

1. Default event log location is local repository workspace.
2. Log retention default: 7 days.
3. Optional retention modes: 1 day, 30 days, manual only.
4. Deletion command must be provided (`purge` operation).

## Export Policy

1. Disabled by default.
2. If enabled, only redacted payloads are eligible.
3. Export destination must be explicitly configured.

## Security Controls

1. File permissions restricted to current user.
2. No automatic cloud upload in default configuration.
3. Hook script failures must fail safe and avoid dumping raw payloads.

## Compliance Test Cases

1. Token appears in prompt -> redacted in stored event.
2. Token appears in shell command -> redacted in stored event.
3. Export mode enabled -> transmitted payload remains redacted.
4. Purge command -> all local event logs removed.