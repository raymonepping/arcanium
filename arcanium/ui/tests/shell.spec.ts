// shell.spec.ts — verify the Arcanium shell chrome renders correctly.
// Checks: sidebar, topbar, brand mark, env badge, footer, cmd palette.
import { test, expect } from '@playwright/test';
import { pageAs } from './auth';

// ── Login page ────────────────────────────────────────────────────────────
test('login: page renders brand, sign-in button and note', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  await expect(page.getByTestId('login-card')).toBeVisible();
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await expect(page.getByTestId('sign-in')).toHaveText('Sign in');
  // Brand name visible inside the card
  await expect(page.locator('.login-brand')).toContainText('Arcanium');
  // The subtitle is present
  await expect(page.locator('.login-sub')).toContainText('Enterprise Cryptographic Control Plane');
});

test('login: no error notice on a fresh visit', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-error')).not.toBeVisible();
});

// ── Authenticated shell ───────────────────────────────────────────────────
test('shell: sidebar is visible on desktop', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await context.close();
});

test('shell: topbar is visible and shows env badge', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('env-badge')).toHaveText('DEMO');
  await context.close();
});

test('shell: page title updates on navigation', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await expect(page.getByTestId('page-title')).toHaveText('Dashboard');
  await page.goto('/keys');
  await expect(page.getByTestId('page-title')).toHaveText('Key Inventory');
  await page.goto('/approvals');
  await expect(page.getByTestId('page-title')).toHaveText('Approvals');
  await context.close();
});

test('shell: footer is present in flow (not fixed)', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  const footer = page.getByTestId('footer');
  await expect(footer).toBeVisible();
  // Footer must NOT be position:fixed — it should be in normal document flow
  const position = await footer.evaluate((el) => window.getComputedStyle(el).position);
  expect(position).not.toBe('fixed');
  await context.close();
});

// ── Command palette ───────────────────────────────────────────────────────
test('shell: clicking Search opens the command palette', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  // Click the search trigger button (same as ⌘K but doesn't rely on meta key events)
  await page.locator('.cmd-trigger').click();
  await expect(page.locator('.cmd-input')).toBeVisible();
  await context.close();
});

test('shell: Esc closes the command palette', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await page.locator('.cmd-trigger').click();
  await expect(page.locator('.cmd-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cmd-input')).not.toBeVisible();
  await context.close();
});

test('shell: command palette navigates on Enter', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await page.locator('.cmd-trigger').click();
  await page.locator('.cmd-input').fill('Evidence');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/evidence/);
  await context.close();
});

// ── Sidebar collapse ──────────────────────────────────────────────────────
test('shell: sidebar collapses to icon rail on toggle', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  const sidebar = page.getByTestId('sidebar');
  // Initially expanded — brand name visible
  await expect(page.locator('.brand-name')).toBeVisible();
  // Click collapse toggle
  await page.locator('.sidebar-toggle').click();
  await expect(sidebar).toHaveClass(/collapsed/);
  // Brand name hidden in collapsed state
  await expect(page.locator('.brand-name')).not.toBeVisible();
  await context.close();
});

// ── Supplier-admin persona ────────────────────────────────────────────────
test('shell: supplier-admin sees tenant banner', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'supplier-admin');
  await page.goto('/');
  // Tenant banner is shown only for supplier-admin persona
  await expect(page.locator('.tenant-banner')).toBeVisible();
  await context.close();
});

test('shell: operator persona has no tenant banner', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await expect(page.locator('.tenant-banner')).not.toBeVisible();
  await context.close();
});

// ── Mobile: sidebar hidden at 390px ──────────────────────────────────────
test('shell: sidebar is hidden on phone viewport', async ({ browser }) => {
  // Set viewport BEFORE navigation so CSS media query is evaluated at the right width
  const context = await browser.newContext({
    storageState: (await import('./users')).stateFile('operator'),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  // At ≤900px the CSS hides the sidebar
  const sidebar = page.getByTestId('sidebar');
  const display = await sidebar.evaluate((el) => window.getComputedStyle(el).display);
  expect(display).toBe('none');
  await context.close();
});
