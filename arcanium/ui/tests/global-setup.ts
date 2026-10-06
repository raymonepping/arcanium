// global-setup.ts — pre-warm session state for every test persona.
// Runs once before the test suite, saving a storageState JSON per user.
// Each test file calls pageAs(browser, user) to restore these sessions.
import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { USERS, USERNAME, PASSWORD, stateFile } from './users';

const BASE = process.env.ARCANIUM_UI_URL ?? 'http://localhost:3000';

export default async function globalSetup(_config: FullConfig) {
  mkdirSync(resolve(__dirname, '.auth'), { recursive: true });

  const browser = await chromium.launch();

  for (const persona of USERS) {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE}/login`);
    await page.getByTestId('sign-in').click();

    // Keycloak OIDC login form
    await page.waitForURL(/\/realms\/arcanium\//);
    await page.locator('#username').fill(USERNAME[persona]);
    await page.locator('#password').fill(PASSWORD[persona]);
    await page.locator('#kc-login').click();

    // Wait until back on Arcanium
    await page.waitForURL((u) => u.href.startsWith(BASE) && !u.pathname.startsWith('/login'), { timeout: 30_000 });

    await context.storageState({ path: stateFile(persona) });
    await context.close();
  }

  await browser.close();
}
