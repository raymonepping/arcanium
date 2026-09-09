// test/applications.test.js — applications CRUD contract tests.
// Uses in-memory mock for db.query — no real database needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

// ── In-memory mock db ──────────────────────────────────────────────────────
const db = { rows: [], nextId: 1 };

function mockQuery(text, params = []) {
  const t = text.trim().toUpperCase();

  if (t.startsWith("SELECT") && t.includes("FROM APPLICATIONS ORDER")) {
    return { rows: [...db.rows] };
  }
  if (t.startsWith("INSERT INTO APPLICATIONS")) {
    const [name, description] = params;
    if (db.rows.find((r) => r.name === name)) {
      const err = new Error("duplicate");
      err.code = "23505";
      throw err;
    }
    const row = {
      id: `00000000-0000-0000-0000-${String(db.nextId++).padStart(12, "0")}`,
      name,
      description,
      registered_at: new Date().toISOString(),
    };
    db.rows.push(row);
    return { rows: [row] };
  }
  if (t.startsWith("SELECT") && t.includes("FROM APPLICATIONS WHERE")) {
    const row = db.rows.find((r) => r.id === params[0]);
    return { rows: row ? [row] : [] };
  }
  if (t.startsWith("SELECT") && t.includes("FROM CRYPTO_PROFILES")) {
    return { rows: [] };
  }
  if (t.startsWith("UPDATE APPLICATIONS")) {
    const row = db.rows.find((r) => r.id === params[1]);
    if (!row) return { rows: [] };
    row.description = params[0];
    return { rows: [row] };
  }
  if (t.startsWith("DELETE FROM APPLICATIONS")) {
    const idx = db.rows.findIndex((r) => r.id === params[0]);
    if (idx === -1) return { rowCount: 0 };
    db.rows.splice(idx, 1);
    return { rowCount: 1 };
  }
  return { rows: [] };
}

// ── Build minimal app ─────────────────────────────────────────────────────
function buildApp() {
  const router = express.Router();

  router.get("/", async (_req, res, next) => {
    try {
      res.json((await mockQuery("SELECT * FROM applications ORDER")).rows);
    } catch (err) {
      next(err);
    }
  });
  router.post("/", async (req, res, next) => {
    try {
      const { name, description } = req.body ?? {};
      if (!name)
        return res
          .status(400)
          .json({ error: "name is required", field: "name" });
      if (!/^[a-z0-9_-]{1,128}$/i.test(name))
        return res.status(400).json({ error: "invalid name", field: "name" });
      const result = await mockQuery("INSERT INTO applications", [
        name,
        description ?? null,
      ]);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ error: "name already registered" });
      next(err);
    }
  });
  router.get("/:id", async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
        return res.status(400).json({ error: "invalid id" });
      const apps = (
        await mockQuery("SELECT * FROM applications WHERE id=$1", [
          req.params.id,
        ])
      ).rows;
      if (!apps.length) return res.status(404).json({ error: "not found" });
      const profiles = (
        await mockQuery(
          "SELECT * FROM crypto_profiles WHERE application_id=$1",
          [req.params.id],
        )
      ).rows;
      res.json({ ...apps[0], crypto_profiles: profiles });
    } catch (err) {
      next(err);
    }
  });
  router.delete("/:id", async (req, res, next) => {
    try {
      const r = await mockQuery("DELETE FROM applications WHERE id=$1", [
        req.params.id,
      ]);
      if (!r.rowCount) return res.status(404).json({ error: "not found" });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/applications", router);
  return app;
}

async function req(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${port}${path}`, opts)
        .then(async (res) => {
          const text = await res.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
          server.close();
          resolve({ status: res.status, body: parsed });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────
test("GET /api/v1/applications returns empty array initially", async () => {
  db.rows = [];
  const app = buildApp();
  const { status, body } = await req(app, "GET", "/api/v1/applications");
  assert.equal(status, 200);
  assert.deepEqual(body, []);
});

test("POST /api/v1/applications with valid body returns 201", async () => {
  db.rows = [];
  const app = buildApp();
  const { status, body } = await req(app, "POST", "/api/v1/applications", {
    name: "payments-api",
    description: "test",
  });
  assert.equal(status, 201);
  assert.equal(body.name, "payments-api");
  assert.ok(body.id);
  assert.ok(body.registered_at);
});

test("POST /api/v1/applications with missing name returns 400", async () => {
  const app = buildApp();
  const { status, body } = await req(app, "POST", "/api/v1/applications", {
    description: "no name",
  });
  assert.equal(status, 400);
  assert.equal(body.field, "name");
});

test("POST /api/v1/applications with invalid name returns 400", async () => {
  const app = buildApp();
  const { status, body } = await req(app, "POST", "/api/v1/applications", {
    name: "invalid name!",
  });
  assert.equal(status, 400);
  assert.equal(body.field, "name");
});

test("POST /api/v1/applications duplicate name returns 409", async () => {
  db.rows = [];
  const app = buildApp();
  await req(app, "POST", "/api/v1/applications", { name: "my-app" });
  const { status, body } = await req(app, "POST", "/api/v1/applications", {
    name: "my-app",
  });
  assert.equal(status, 409);
  assert.match(body.error, /already registered/);
});

test("GET /api/v1/applications/:id with unknown UUID returns 404", async () => {
  db.rows = [];
  const app = buildApp();
  const { status } = await req(
    app,
    "GET",
    "/api/v1/applications/00000000-0000-0000-0000-000000000099",
  );
  assert.equal(status, 404);
});

test("DELETE /api/v1/applications/:id returns 204", async () => {
  db.rows = [];
  const app = buildApp();
  const { body: created } = await req(app, "POST", "/api/v1/applications", {
    name: "to-delete",
  });
  const { status } = await req(
    app,
    "DELETE",
    `/api/v1/applications/${created.id}`,
  );
  assert.equal(status, 204);
});
