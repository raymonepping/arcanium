// errorHandler.js — global Express error handler.
// Must be mounted LAST in the middleware chain (4-arg signature).

export function errorHandler(err, req, res, next) {
  // eslint-disable-line no-unused-vars
  // Log full error internally
  if (process.env.NODE_ENV !== "test") {
    console.error(
      `[error] ${req.method} ${req.path} → request_id=${req.requestId}`,
      err.stack || err.message,
    );
  }
  // Prompt 24, Deliverable 2 — every error response carries request_id so
  // a UI error toast can point back at the exact log line (apiError.ts).
  const requestId = req.requestId;

  // Map known pg error codes to HTTP status
  if (err.code === "23505")
    return res
      .status(409)
      .json({ error: "resource already exists", request_id: requestId });
  if (err.code === "23503")
    return res.status(409).json({
      error: "referenced resource does not exist",
      request_id: requestId,
    });

  // Map custom status codes
  const status = err.status || 500;
  const message = status < 500 ? err.message : "internal server error";
  res.status(status).json({ error: message, request_id: requestId });
}
