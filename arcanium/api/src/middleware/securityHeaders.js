// middleware/securityHeaders.js — Prompt 18 Deliverable 6.
//
// The API is never meant to be reached except through the same-origin Nuxt
// gateway (ui/server/routes/gateway/...) — no CORS headers are set anywhere
// in this codebase, which itself is the CORS policy: no cross-origin caller
// is ever permitted. These headers make that same intent explicit and
// enforced client-side too (CSP), not just true by omission.
export function securityHeaders(req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Belt-and-braces: explicitly absent rather than merely never-set, in
  // case something upstream (a proxy, a future middleware) tries to add one.
  res.removeHeader("Access-Control-Allow-Origin");
  next();
}
