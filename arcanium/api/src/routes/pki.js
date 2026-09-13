// routes/pki.js — PKI CA chain and role inventory.

import { Router } from "express";
import { getPkiCaChain, listPkiRoles } from "../vault.js";

export const pkiRouter = Router();

// GET /api/v1/pki/ca-chain
// ?download=1 — Prompt 31: same PEM, but as a real file download
// (Content-Disposition) instead of an inline response, for the UI's
// "Download CA chain" button. Both forms return public CA material —
// meant to be shared, same as any CA chain — the flag only changes how
// the browser presents it, not what's in it.
//
// Found live via Playwright, not curl (curl doesn't care about
// client-side Content-Type-driven parsing): switching this response
// unconditionally to application/x-pem-file broke the PKI page's own
// inline display — ofetch/$fetch only auto-parses a response as text for
// a small set of recognized text-ish Content-Types, and silently returns
// a Blob for anything else, which the page then rendered as the literal
// string "[object Blob]". The inline (non-download) response stays
// text/plain, exactly what it was before this prompt; only ?download=1
// gets the file-download Content-Type, matching what a browser actually
// needs to trigger a save-as for an <a download> link.
pkiRouter.get("/ca-chain", async (req, res, next) => {
  try {
    const pem = await getPkiCaChain();
    if (req.query.download) {
      res
        .set("Content-Type", "application/x-pem-file")
        .set(
          "Content-Disposition",
          'attachment; filename="arcanium-ca-chain.pem"',
        );
    } else {
      res.set("Content-Type", "text/plain");
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
