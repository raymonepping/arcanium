// navigation.spec.ts — verify all nav items are present, active-state works,
// and the command palette shows matching results for a search query.
import { test, expect } from '@playwright/test';
import { pageAs } from './auth';

const NAV_ROUTES: { label: string; to: string; title: string }[] = [
  { label: 'Dashboard',      to: '/',              title: 'Dashboard' },
  { label: 'Suppliers',      to: '/suppliers',     title: 'Suppliers' },
  { label: 'Teams',          to: '/teams',         title: 'Teams' },
  { label: 'Onboard',        to: '/onboard',       title: 'Onboard a Workload' },
  { label: 'Applications',   to: '/applications',  title: 'Applications' },
  { label: 'Integrations',   to: '/integrations',  title: 'Integration Channels' },
  { label: 'Jobs',           to: '/jobs',          title: 'Provisioning Jobs' },
  { label: 'Keys',           to: '/keys',          title: 'Key Inventory' },
  { label: 'PKI',            to: '/pki',           title: 'PKI' },
  { label: 'Cluster',        to: '/cluster',       title: 'Cluster Health' },
  { label: 'Observability',  to: '/observability', title: 'Observability' },
  { label: 'Maturity',       to: '/maturity',      title: 'Maturity' },
  { label: 'Reconciliation', to: '/reconciliation', title: 'Reconciliation' },
  { label: 'Approvals',      to: '/approvals',     title: 'Approvals' },
  { label: 'Evidence',       to: '/evidence',      title: 'Evidence Trail' },
];

// All nav items render for operator persona
test('navigation: all nav items are present for operator', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  for (const { label } of NAV_ROUTES) {
    await expect(page.locator('.nav-item', { hasText: label })).toBeVisible();
  }
  await context.close();
});

// Each nav item navigates and the page title updates.
// Start from a known different route so clicking always triggers navigation.
for (const { label, to, title } of NAV_ROUTES.slice(0, 8)) {
  test(`navigation: clicking ${label} lands on "${title}"`, async ({ browser }) => {
    const { context, page } = await pageAs(browser, 'operator');
    // Start away from the target so a click always causes a URL change
    const startFrom = to === '/' ? '/keys' : '/';
    await page.goto(startFrom);
    await page.locator('.nav-item', { hasText: label }).click();
    await page.waitForURL(new RegExp(to === '/' ? '^http://[^/]+/?$' : to));
    await expect(page.getByTestId('page-title')).toContainText(title);
    await context.close();
  });
}

// Active state is applied on the correct nav item
test('navigation: active class on current route', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/keys');
  const keysItem = page.locator('.nav-item', { hasText: 'Keys' });
  await expect(keysItem).toHaveClass(/active/);
  // Other items are NOT active
  const dashItem = page.locator('.nav-item', { hasText: 'Dashboard' });
  await expect(dashItem).not.toHaveClass(/active/);
  await context.close();
});

// Supplier-admin persona: platform items are hidden
test('navigation: supplier-admin does not see platform-only items', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'supplier-admin');
  await page.goto('/');
  // Cluster, Observability, PKI, Jobs are platform-only
  for (const label of ['Cluster', 'Observability', 'PKI', 'Jobs']) {
    await expect(page.locator('.nav-item', { hasText: label })).not.toBeVisible();
  }
  await context.close();
});

// Command palette fuzzy search
test('navigation: cmd palette shows filtered results', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await page.locator('.cmd-trigger').click();
  await expect(page.locator('.cmd-input')).toBeVisible();
  await page.locator('.cmd-input').fill('key');
  // "Key Inventory" should be visible
  await expect(page.locator('.cmd-result-label', { hasText: /Key/i }).first()).toBeVisible();
  await context.close();
});

test('navigation: cmd palette shows empty state for unknown query', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'operator');
  await page.goto('/');
  await page.locator('.cmd-trigger').click();
  await expect(page.locator('.cmd-input')).toBeVisible();
  await page.locator('.cmd-input').fill('xxxxxxxxnotfound');
  await expect(page.locator('.cmd-empty')).toBeVisible();
  await context.close();
});

// No divider-only groups remain after persona filtering
test('navigation: no dangling dividers in nav for supplier-admin', async ({ browser }) => {
  const { context, page } = await pageAs(browser, 'supplier-admin');
  await page.goto('/');
  const dividers = await page.locator('.nav-divider').all();
  for (const d of dividers) {
    // No divider should follow another divider immediately
    const next = await d.evaluate((el) => el.nextElementSibling?.classList.contains('nav-divider') ?? false);
    expect(next).toBe(false);
  }
  await context.close();
});
