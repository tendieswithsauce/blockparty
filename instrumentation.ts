// instrumentation.ts
// Server errors (pages, server actions, route handlers, proxy) are written to
// the log as one JSON line tagged "blockparty-error", so they're easy to find
// in Vercel's logs and Observability, and trigger Vercel's error alerts on
// plans that have them. Browser errors arrive the same way through
// /api/client-errors.
import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err instanceof Error ? err : null
  console.error(
    JSON.stringify({
      tag: 'blockparty-error',
      source: 'server',
      message: (error?.message ?? String(err)).slice(0, 500),
      name: error?.name,
      digest: typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined,
      stack: error?.stack?.slice(0, 2000),
      method: request.method,
      // Path only: query strings can carry one-time codes from email links.
      path: request.path.split('?')[0],
      route: context.routePath,
      routeType: context.routeType,
    }),
  )
}
