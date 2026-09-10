// maturity/report.js — Express Router: GET /api/v1/maturity
// Returns the maturity assessment as JSON.

import { Router } from "express";
import { computeMaturity } from "./scorer.js";

export const maturityRouter = Router();

// GET /api/v1/maturity
// Returns the full maturity report:  { level, levelName, score, maxScore, percentage, checks[], evaluatedAt }
maturityRouter.get("/", async (_req, res, next) => {
  try {
    const report = await computeMaturity();
    res.json(report);
  } catch (err) {
    next(err);
  }
});
