// lib/supabase/proxy.ts
// Refreshes the Supabase session cookie on every request and gates routes.
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

/** Pages that require a signed-in user. */
const PROTECTED_PREFIXES = ['/dashboard', '/profile', '/reset-password']

/** Pages a signed-in user has no reason to see. */
const SIGNED_OUT_ONLY = ['/login', '/signup', '/forgot-password']

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not put code between createServerClient and getClaims(): this call is
  // what refreshes an expiring session and writes the new cookies.
  const { data } = await supabase.auth.getClaims()
  const isSignedIn = Boolean(data?.claims?.sub)

  const { pathname, search } = request.nextUrl

  if (!isSignedIn && matches(pathname, PROTECTED_PREFIXES)) {
    return redirectPreservingCookies(request, response, '/login', {
      next: pathname + search,
    })
  }

  if (isSignedIn && matches(pathname, SIGNED_OUT_ONLY)) {
    return redirectPreservingCookies(request, response, '/dashboard')
  }

  return response
}

function redirectPreservingCookies(
  request: NextRequest,
  from: NextResponse,
  pathname: string,
  params: Record<string, string> = {}
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const redirect = NextResponse.redirect(url)
  // Carry over any refreshed session cookies so the user isn't logged out.
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
  return redirect
}
