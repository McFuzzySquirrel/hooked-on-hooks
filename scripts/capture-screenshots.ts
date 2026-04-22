import { test, expect, type Page } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const BASE_URL = process.env.UI_BASE_URL ?? 'http://127.0.0.1:5173';
const SCREENSHOT_DIR = join(
  REPO_ROOT,
  'docs',
  'tutorials',
  'assets',
  'tutorial-screenshots',
  'session-dashboard'
);

const SESSION_LIST_JSON = process.env.SESSION_LIST_JSON ?? join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'screenshot-demo',
  'session-list.demo.json'
);
const SESSION_EXPORT_JSON = process.env.SESSION_EXPORT_JSON ?? join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'screenshot-demo',
  'session-export.demo.json'
);
const SANITIZE_SCREENSHOTS = process.env.SANITIZE_SCREENSHOTS !== 'false';

async function sanitizeVisibleData(page: Page): Promise<void> {
  if (!SANITIZE_SCREENSHOTS) return;

  await page.evaluate(() => {
    const hide = (el: Element, replacement: string): void => {
      if (el instanceof HTMLElement) {
        el.textContent = replacement;
      }
    };

    document.querySelectorAll('.mono').forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;

      if (text.includes('/')) {
        hide(el, '[path hidden]');
        return;
      }

      if (text.length >= 16 && /[a-z0-9\-]{12,}/i.test(text)) {
        hide(el, '[id hidden]');
      }
    });

    document.querySelectorAll('.turn-message, .tool-result, .reasoning-snippet, .search-results li').forEach((el) => {
      const text = (el.textContent ?? '').trim();
      if (!text) return;
      if (text.length > 120) {
        hide(el, `${text.slice(0, 100)}... [sanitized]`);
      }
    });
  });
}

test.describe('Session Dashboard walkthrough screenshots', () => {
  test('capture selector and dashboard flow', async ({ page }) => {
    await page.setViewportSize({ width: 1560, height: 980 });
    await page.goto(BASE_URL);
    await page.waitForSelector('h1:has-text("Copilot Session Explorer")', { timeout: 15_000 });

    const sessionListInput = page
      .locator('label:has-text("Load Session List JSON") input[type="file"]')
      .first();
    await sessionListInput.setInputFiles(SESSION_LIST_JSON);

    await expect(page.locator('.session-card').first()).toBeVisible({ timeout: 10_000 });
    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '01-selector-loaded.png'),
      fullPage: false,
    });

    const firstCheckbox = page.locator('.session-card input[type="checkbox"]').first();
    await firstCheckbox.check();
    await expect(page.locator('.summary-box')).toBeVisible({ timeout: 5_000 });
    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '02-selector-selection-and-export-command.png'),
      fullPage: false,
    });

    await page.getByRole('button', { name: 'Session Dashboard' }).click();
    const exportInput = page
      .locator('label:has-text("Load Export JSON") input[type="file"]')
      .first();
    await exportInput.setInputFiles(SESSION_EXPORT_JSON);

    await expect(page.locator('.session-item').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });

    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '03-dashboard-overview.png'),
      fullPage: false,
    });

    await page.getByRole('button', { name: 'Turns' }).click();
    await page.waitForTimeout(500);
    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '04-dashboard-turns-with-tools-skills-agents.png'),
      fullPage: false,
    });

    await page.getByRole('button', { name: 'Models & Tokens' }).click();
    await page.waitForTimeout(500);
    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '05-dashboard-models-and-tokens.png'),
      fullPage: false,
    });

    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByPlaceholder('Search all session content').fill('tool');
    await page.waitForTimeout(500);
    await sanitizeVisibleData(page);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, '06-dashboard-search.png'),
      fullPage: false,
    });
  });
});
