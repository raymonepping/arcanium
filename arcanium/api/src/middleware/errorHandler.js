// errorHandler.js — global Express error handler.
// Must be mounted LAST in the middleware chain (4-arg signature).

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Log full error internally
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[error] ${req.method} ${req.path} →`, err.stack || err.message)
  }

  // Map known pg error codes to HTTP status
  if (err.code === '23505') return res.status(409).json({ error: 'resource already exists' })
  if (err.code === '23503') return res.status(409).json({ error: 'referenced resource does not exist' })

  // Map custom status codes
  const status = err.status || 500
  const message = status < 500 ? err.message : 'internal server error'
  res.status(status).json({ error: message })
}
