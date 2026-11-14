// lib/auth/redirect.ts

/**
 * Only allow same-site relative paths as post-auth destinations, so a crafted
 * `?next=https://evil.example` link can't bounce users off-site.
 */
export function safeNextPath(next: unknown, fallback = '/dashboard'): string {
  if (typeof next !== 'string') return fallback
  // Must be a path on this site: "/x" but not "//host" or "/\host" (browsers
  // treat both of those as protocol-relative URLs to another host).
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
