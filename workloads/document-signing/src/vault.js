// vault.js — Vault client for document-signing workload. AppRole + token refresh.
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import config from "./config.js";

let _ca;
function getCa() {
  if (!_ca) _ca = readFileSync(config.vault.cacert);
  return _ca;
}

export function vaultRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/v1/${path}`, config.vault.addr);
    const data = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["X-Vault-Token"] = token;
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        ca: getCa(),
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(
              `Vault ${method} ${path} → ${res.statusCode}: ${text}`,
            );
            err.vaultStatus = res.statusCode;
            return reject(err);
          }
          const ct = res.headers["content-type"] || "";
          try {
            resolve(ct.includes("application/json") ? JSON.parse(text) : text);
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const state = { authenticated: false, token: null, refreshTimer: null };

async function login() {
  const delays = [1000, 2000, 4000, 8000, 16000];
  let lastErr;
  for (let i = 0; i < delays.length; i++) {
    try {
      const res = await vaultRequest("POST", "auth/approle/login", {
        role_id: config.vault.roleId,
        secret_id: config.vault.secretId,
      });
      const { client_token, lease_duration } = res.auth;
      state.token = client_token;
      state.authenticated = true;
      console.log(
        `[vault] authenticated (ttl=${lease_duration}s attempt=${i + 1})`,
      );
      scheduleRefresh(lease_duration);
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[vault] login attempt ${i + 1} failed: ${err.message}`);
      if (i < delays.length - 1) await sleep(delays[i]);
    }
  }
  throw new Error(`[vault] login exhausted: ${lastErr.message}`);
}

function scheduleRefresh(ttlSeconds) {
  clearTimeout(state.refreshTimer);
  const delay = Math.floor(ttlSeconds * 0.8) * 1000;
  state.refreshTimer = setTimeout(async () => {
    try {
      await login();
    } catch (err) {
      console.error(`[vault] token refresh failed: ${err.message}`);
      state.authenticated = false;
    }
  }, delay);
  state.refreshTimer.unref();
}

export async function init() {
  await login();
}
export function getToken() {
  return state.token;
}
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
