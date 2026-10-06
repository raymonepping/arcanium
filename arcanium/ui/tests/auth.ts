// auth.ts — sign-in helper for Arcanium Playwright tests.
// Uses the real Keycloak OIDC flow — nothing is mocked or stubbed.
import type { Browser } from '@playwright/test';
import { stateFile, passwordOf, USERNAME, type User } from './users';

/** Drive through the real Keycloak login page for the given persona. */
export async function signIn(page: import('@playwright/test').Page, user: User, returnTo = '/') {
  await page.goto(`/login?next=${encodeURIComponent(returnTo)}`);
  await page.getByTestId('sign-in').click();
  // Wait for Keycloak authorization endpoint
  await page.waitForURL(/\/realms\/arcanium\//);
  await page.locator('#username').fill(USERNAME[user]);
  await page.locator('#password').fill(passwordOf(user));
  await page.locator('#kc-login').click();
  // Back on Arcanium after successful sign-in
  await page.waitForURL((u) => u.origin.includes('localhost') && !u.pathname.startsWith('/login'));
}

/** Return a signed-in page context for `user`, using pre-warmed storageState. */
export async function pageAs(browser: Browser, user: User) {
  const context = await browser.newContext({ storageState: stateFile(user) });
  const page = await context.newPage();
  return { context, page };
}
