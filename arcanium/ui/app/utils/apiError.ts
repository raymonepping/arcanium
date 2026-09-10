// utils/apiError.ts — Prompt 16.0
//
// The gateway (server/routes/gateway/[...path].ts) never forwards upstream error
// payloads. On failure it re-throws createError({ statusCode, statusMessage }),
// which Nitro serialises as:
//   { error: true, statusCode, statusMessage, message }
// So err.data.error is the BOOLEAN true — reading it into a message string renders
// the literal word "true". The human string is in statusMessage / message.
//
// apiErrorMessage() always returns a string, and only ever the gateway's already-
// sanitised text — never a boolean, an object, or an upstream payload.

export function apiErrorMessage(err: unknown, fallback = 'Something went wrong.'): string {
  const e = err as {
    data?: { statusMessage?: unknown; message?: unknown; error?: unknown }
    statusMessage?: unknown
    message?: unknown
  } | null | undefined

  const candidates = [
    e?.data?.statusMessage,
    e?.data?.message,
    typeof e?.data?.error === 'string' ? e?.data?.error : undefined,
    e?.statusMessage,
    e?.message,
  ]

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && c !== 'true' && c !== 'false') {
      return c.trim()
    }
  }
  return fallback
}

/** HTTP status behind a gateway/fetch error, or 0 if unknown. */
export function apiErrorStatus(err: unknown): number {
  const e = err as { statusCode?: unknown; data?: { statusCode?: unknown } } | null | undefined
  const s = e?.statusCode ?? e?.data?.statusCode
  return typeof s === 'number' ? s : 0
}
