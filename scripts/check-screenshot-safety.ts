import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function main(): void {
  const scriptFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(scriptFile, "..", "..");
  const captureScriptPath = resolve(repoRoot, "scripts", "capture-screenshots.ts");
  const screenshotReadmePath = resolve(
    repoRoot,
    "docs",
    "tutorials",
    "assets",
    "tutorial-screenshots",
    "session-dashboard",
    "README.md"
  );
  const demoListPath = resolve(
    repoRoot,
    "tests",
    "fixtures",
    "screenshot-demo",
    "session-list.demo.json"
  );
  const demoExportPath = resolve(
    repoRoot,
    "tests",
    "fixtures",
    "screenshot-demo",
    "session-export.demo.json"
  );

  assert(existsSync(captureScriptPath), "Missing scripts/capture-screenshots.ts");
  assert(existsSync(screenshotReadmePath), "Missing screenshot walkthrough README");
  assert(existsSync(demoListPath), "Missing demo fixture: session-list.demo.json");
  assert(existsSync(demoExportPath), "Missing demo fixture: session-export.demo.json");

  const captureScript = readFileSync(captureScriptPath, "utf8");
  const screenshotReadme = readFileSync(screenshotReadmePath, "utf8");

  // Guardrail: screenshot capture must default to synthetic demo fixtures.
  assert(
    captureScript.includes("tests',") && captureScript.includes("'fixtures'") && captureScript.includes("'screenshot-demo'"),
    "Screenshot script must default to fixture paths under tests/fixtures/screenshot-demo"
  );
  assert(
    captureScript.includes("SESSION_LIST_JSON") && captureScript.includes("SESSION_EXPORT_JSON"),
    "Screenshot script must expose SESSION_LIST_JSON and SESSION_EXPORT_JSON override env vars"
  );

  // Guardrail: masking should stay on by default.
  assert(
    captureScript.includes("SANITIZE_SCREENSHOTS !== 'false'"),
    "Screenshot masking must be enabled by default"
  );

  // Guardrail: docs should explain the public-safe default and redacted fallback.
  assert(
    screenshotReadme.includes("Public-Safe Default") && screenshotReadme.includes("--redact"),
    "Screenshot README must document safe defaults and redacted real-data fallback"
  );

  process.stdout.write("Screenshot safety checks passed.\n");
}

main();
