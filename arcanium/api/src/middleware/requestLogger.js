// requestLogger.js — structured per-request log line.

export function requestLogger(req, res, next) {
  // Skip liveness probe to avoid log noise
  if (req.path === "/health/live") return next();

  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const method = req.method.padEnd(6);
    const path = req.path;
    const status = res.statusCode;
    // Prompt 24, Deliverable 2 — grep by request_id to trace one flow
    // end-to-end across UI -> API -> DB -> Vault -> evidence.
    console.log(
      `[req] ${method} ${path} ${status} ${ms}ms request_id=${req.requestId}`,
    );
  });
  next();
}
