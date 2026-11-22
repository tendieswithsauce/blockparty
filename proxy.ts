// proxy.ts (Next.js 16: replaces middleware.ts)
import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { GATE_COOKIE, GATE_PATH, gateEnabled, hasGatePass } from '@/lib/site-gate'

/** Reachable without the site password: the wall itself, the cron and Stripe's webhook (each has its own secret). */
const GATE_EXEMPT = [GATE_PATH, '/api/cron/', '/api/stripe/webhook', '/manifest.webmanifest', '/robots.txt']

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (
    gateEnabled() &&
    !GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(p)) &&
    !hasGatePass(request.cookies.get(GATE_COOKIE)?.value)
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not available yet' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = GATE_PATH
    url.search = ''
    url.searchParams.set('next', pathname + search)
    const res = NextResponse.redirect(url)
    res.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return res
  }

  const response = await updateSession(request)
  if (gateEnabled()) response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export const config = {
  matcher: [
    // Everything except static assets, image optimization and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
