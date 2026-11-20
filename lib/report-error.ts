// lib/report-error.ts
// Browser side: send an error to /api/client-errors, which writes it to the
// server log so it shows up in Vercel's logs and Observability next to the
// server errors (see instrumentation.ts). Fire-and-forget, deduplicated, and
// capped per page load so a broken loop can't flood the logs.
const MAX_PER_PAGE = 10
const seen = new Set<string>()

export type ClientErrorKind = 'window-error' | 'unhandled-rejection' | 'error-boundary' | 'global-error'

export function reportClientError(kind: ClientErrorKind, error: unknown, extra?: { digest?: string }) {
  try {
    if (typeof window === 'undefined' || seen.size >= MAX_PER_PAGE) return
    const err = error instanceof Error ? error : null
    const message = (err?.message ?? String(error ?? 'Unknown error')).slice(0, 500)
    const key = `${kind}:${message}`
    if (seen.has(key)) return
    seen.add(key)
    const body = JSON.stringify({
      kind,
      message,
      name: err?.name?.slice(0, 100),
      stack: err?.stack?.slice(0, 2000),
      digest: extra?.digest?.slice(0, 100),
      // Path only: query strings can carry one-time codes from email links.
      path: window.location.pathname.slice(0, 300),
    })
    const url = '/api/client-errors'
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) {
      fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
    }
  } catch {
    // Reporting must never break the page.
  }
}
