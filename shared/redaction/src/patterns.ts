/**
 * Sensitive data patterns for MVP redaction (Privacy spec §Redaction Rules).
 * Applied to all string values in event payloads before persistence and export.
 */

interface RedactionPattern {
  pattern: RegExp;
  replacement: string;
}

const PATTERNS: RedactionPattern[] = [
  // GitHub personal access tokens (classic and fine-grained)
  { pattern: /ghp_[A-Za-z0-9_]{36,}/g,          replacement: "[REDACTED_GITHUB_TOKEN]" },
  { pattern: /ghs_[A-Za-z0-9_]{36,}/g,          replacement: "[REDACTED_GITHUB_TOKEN]" },
  { pattern: /github_pat_[A-Za-z0-9_]{22,}/g,   replacement: "[REDACTED_GITHUB_TOKEN]" },

  // OpenAI-style API keys
  { pattern: /sk-[A-Za-z0-9]{32,}/g,            replacement: "[REDACTED_API_KEY]" },

  // Slack tokens
  { pattern: /xoxb-[A-Za-z0-9-]{24,}/g,         replacement: "[REDACTED_SLACK_TOKEN]" },
  { pattern: /xoxp-[A-Za-z0-9-]{24,}/g,         replacement: "[REDACTED_SLACK_TOKEN]" },

  // AWS-style keys  (AKIA... 20 uppercase chars)
  { pattern: /AKIA[A-Z0-9]{16}/g,               replacement: "[REDACTED_AWS_KEY]" },

  // Generic key=value / key:value assignment patterns (password, secret, token, api_key)
  {
    pattern: /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
    replacement: "[REDACTED_CREDENTIAL]"
  },

  // URLs with embedded credentials (scheme://user:pass@host)
  {
    pattern: /[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/[^@\s]*:[^@\s]*@/g,
    replacement: "[REDACTED_CREDENTIALS]@"
  }
];

/**
 * Apply all sensitive-data patterns to a single string value.
 * Returns the input unchanged if no pattern matches.
 */
export function redactSensitiveStrings(value: string): string {
  let result = value;
  for (const { pattern, replacement } of PATTERNS) {
    // Reset lastIndex between calls (global regex is stateful)
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}
