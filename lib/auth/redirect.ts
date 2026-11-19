// lib/auth/redirect.ts

const BASE = 'https://blockparty.invalid'

/**
 * Only allow same-site relative paths as post-auth destinations, so a crafted
 * `?next=https://evil.example` link can't bounce users off-site.
 */
export function safeNextPath(next: unknown, fallback = '/dashboard'): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return fallback
  // Browsers drop tabs and newlines inside URLs ("/\t/evil.com" becomes
  // "//evil.com"), and treat "//host" and "/\host" as other sites: refuse
  // control characters, whitespace and backslashes outright.
  if (/[\u0000-\u001F\u007F\s\\]/.test(next)) return fallback
  // Then let the URL parser decide: it must stay on our own origin.
  let url: URL
  try {
    url = new URL(next, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback
  return url.pathname + url.search + url.hash
}
