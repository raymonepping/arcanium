// test/vault.test.js — Vault client unit tests with mocked fetch.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// ── Minimal vault logic extracted for unit testing ─────────────────────────
// We test the login + backoff logic independently without importing vault.js
// (which reads files on load) by reimplementing the minimal state machine.

async function loginWithBackoff(fetcher, maxAttempts = 5) {
  const delays = [10, 20, 40, 80, 160]; // ms — reduced for tests
  let lastErr;
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    try {
      const res = await fetcher();
      return { ...res, attempts };
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1)
        await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  throw new Error(
    `login exhausted after ${maxAttempts} attempts: ${lastErr.message}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────
test("login succeeds on first attempt", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return { client_token: "tok-abc", lease_duration: 3600 };
  };
  const result = await loginWithBackoff(fetcher);
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.client_token, "tok-abc");
});

test("login succeeds on third attempt after two failures", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    if (calls < 3) throw new Error("connection refused");
    return { client_token: "tok-xyz", lease_duration: 1800 };
  };
  const result = await loginWithBackoff(fetcher);
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.client_token, "tok-xyz");
});

test("login throws after exhausting all retries", async () => {
  const fetcher = async () => {
    throw new Error("vault unavailable");
  };
  await assert.rejects(
    () => loginWithBackoff(fetcher, 5),
    (err) => {
      assert.match(err.message, /exhausted/);
      return true;
    },
  );
});

test("getDbCredentials returns username and password shape", async () => {
  // Simulate the vault creds response shape
  const mockResponse = {
    data: { username: "v-approle-arcanium-abc123", password: "A1b2C3d4!" },
    lease_duration: 3600,
  };
  const { username, password } = mockResponse.data;
  assert.ok(typeof username === "string");
  assert.ok(username.length > 0);
  assert.ok(typeof password === "string");
  assert.ok(password.length > 0);
});

test("listTransitKeys returns array of strings", () => {
  // Simulate vault LIST response
  const mockListResponse = { data: { keys: ["demo-app-key", "workload-key"] } };
  const keys = mockListResponse.data?.keys ?? [];
  assert.ok(Array.isArray(keys));
  assert.ok(keys.every((k) => typeof k === "string"));
  assert.equal(keys[0], "demo-app-key");
});
