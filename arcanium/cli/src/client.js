// client.js — fetch wrapper for Arcanium API.
// Uses native fetch (Node 22) — same host, no custom CA needed.
import config from "./config.js";

export async function apiGet(path) {
  const res = await fetch(`${config.apiBase}${path}`);
  if (!res.ok)
    throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json().catch(() => null);
}

export async function apiPatch(path, body) {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json().catch(() => null);
}

export async function apiDelete(path) {
  const res = await fetch(`${config.apiBase}${path}`, { method: "DELETE" });
  if (!res.ok)
    throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
}
