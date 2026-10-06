// @screens — full-page screenshots of every Arcanium screen.
// Run with:  npx playwright test screens --grep @screens
// Output written to docs/screenshots/.
import { test } from '@playwright/test';
import { resolve } from 'node:path';
import { pageAs } from './auth';
import { ROOT, type User } from './users';

const OUT = resolve(ROOT, 'docs/screenshots');

const ROUTES = [
  '/', '/suppliers', '/teams', '/onboard', '/applications',
  '/integrations', '/jobs', '/keys', '/pki',
  '/cluster', '/observability', '/maturity',
  '/reconciliation', '/approvals', '/evidence',
];

const name = (r: string) => (r === '/' ? 'overview' : r.slice(1).replace(/\//g, '-'));

for (const [user, width, height, tag] of [
  ['operator',  1440, 900,  'desktop'],
  ['operator',  390,  844,  'phone'],
  ['auditor',   1440, 900,  'auditor'],
] as [User, number, number, string][]) {
  test(`@screens ${user} ${tag}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await pageAs(browser, user);
    await page.setViewportSize({ width, height });

    const { mkdirSync } = await import('node:fs');
    mkdirSync(`${OUT}/${tag}`, { recursive: true });

    for (const r of ROUTES) {
      await page.goto(r);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${tag}/${name(r)}.png`, fullPage: true });
    }

    // Detail screens — capture first application and first key detail if available
    await page.goto('/applications');
    await page.waitForLoadState('networkidle');
    const appLinks = page.locator('.arc-table tbody tr');
    if (await appLinks.count() > 0) {
      await appLinks.first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${tag}/application-detail.png`, fullPage: true });
    }

    await page.goto('/keys');
    await page.waitForLoadState('networkidle');
    const keyRows = page.locator('.arc-table tbody tr');
    if (await keyRows.count() > 0) {
      await keyRows.first().click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${tag}/key-detail.png`, fullPage: true });
    }

    await context.close();
  });
}
