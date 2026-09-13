// routes/pki.js — PKI CA chain and role inventory.

import { Router } from "express";
import { getPkiCaChain, listPkiRoles } from "../vault.js";

export const pkiRouter = Router();

// GET /api/v1/pki/ca-chain
// ?download=1 — Prompt 31: same PEM, but as a real file download
// (Content-Disposition) instead of an inline text/plain response, for the
// UI's "Download CA chain" button. Both forms return public CA material —
// meant to be shared, same as any CA chain — the flag only changes how the
// browser presents it, not what's in it.
pkiRouter.get("/ca-chain", async (req, res, next) => {
  try {
    const pem = await getPkiCaChain();
    res.set("Content-Type", "application/x-pem-file");
    if (req.query.download) {
      res.set(
        "Content-Disposition",
        'attachment; filename="arcanium-ca-chain.pem"',
      );
    }
    res.send(pem);
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/pki/roles
pkiRouter.get("/roles", async (_req, res, next) => {
  try {
    const roles = await listPkiRoles();
    res.json(roles);
  } catch (err) {
    next(err);
  }
});
