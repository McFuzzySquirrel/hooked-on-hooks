/**
 * Playwright screenshot capture for the Copilot Activity Visualiser.
 *
 * Usage:
 *   npx playwright test scripts/capture-screenshots.ts
 *
 * Prerequisites:
 *   - Ingest service running on http://127.0.0.1:7070
 *   - Web UI running on http://127.0.0.1:5173
 *   - A session actively sending events (or already completed)
 */

import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://127.0.0.1:5173';
const SCREENSHOT_DIR = join(__dirname, '..', 'docs', 'tutorials', 'assets', 'tutorial-screenshots', 'ui-features');

test.describe('Visualiser Screenshot Capture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for the app to render
    await page.waitForSelector('[class*="app"], [id="root"], body', { timeout: 10_000 });
    // Give SSE time to deliver state
    await page.waitForTimeout(2000);
  });

  test('full UI overview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'ui-overview.png'),
      fullPage: false,
    });
  });

  test('live activity board', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    // Try to capture the lane/status area
    const lanes = page.locator('[class*="lane"], [class*="status"], [class*="board"]').first();
    if (await lanes.isVisible()) {
      await lanes.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-live-activity-board.png'),
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-live-activity-board.png'),
        fullPage: false,
      });
    }
  });

  test('gantt chart with parallel tools', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    const gantt = page.locator('[class*="gantt"], [class*="Gantt"], [class*="timeline"]').first();
    if (await gantt.isVisible()) {
      await gantt.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-gantt-parallel-tools.png'),
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-gantt-parallel-tools.png'),
        fullPage: false,
      });
    }
  });

  test('event inspector with tracing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    // Click the first event in the list to open inspector
    const eventItem = page.locator('[class*="event"], [class*="Event"]').first();
    if (await eventItem.isVisible()) {
      await eventItem.click();
      await page.waitForTimeout(500);
    }

    const inspector = page.locator('[class*="inspector"], [class*="Inspector"]').first();
    if (await inspector.isVisible()) {
      await inspector.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-event-inspector-tracing.png'),
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-event-inspector-tracing.png'),
        fullPage: false,
      });
    }
  });

  test('filter controls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    const filters = page.locator('[class*="filter"], [class*="Filter"]').first();
    if (await filters.isVisible()) {
      await filters.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-filter-controls.png'),
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-filter-controls.png'),
        fullPage: false,
      });
    }
  });

  test('replay mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    // Look for a replay button/toggle
    const replayBtn = page.locator('button:has-text("Replay"), button:has-text("replay"), [class*="replay"]').first();
    if (await replayBtn.isVisible()) {
      await replayBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'ui-replay-mode.png'),
      fullPage: false,
    });
  });

  test('reporting and export', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    // Look for export/CSV button
    const exportBtn = page.locator('button:has-text("Export"), button:has-text("CSV"), [class*="export"]').first();
    if (await exportBtn.isVisible()) {
      await exportBtn.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-reporting-export-csv.png'),
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-reporting-export-csv.png'),
        fullPage: false,
      });
    }
  });

  test('pairing diagnostics tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1000);

    const pairing = page.locator('[class*="pairing"], [class*="Pairing"], [class*="diagnostic"]').first();
    if (await pairing.isVisible()) {
      // Hover to trigger tooltip
      await pairing.hover();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-pairing-tooltip.png'),
        fullPage: false,
      });
    } else {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'ui-pairing-tooltip.png'),
        fullPage: false,
      });
    }
  });
});
