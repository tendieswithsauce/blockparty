// lib/site-gate.ts
// Password wall for the whole site (used on the live domain until beta).
//
// On by default for Vercel Production deployments. SITE_GATE=on turns it on
// anywhere (e.g. the dev site, if Vercel's own login wall is switched off);
// SITE_GATE=off turns it off. The password is SITE_GATE_PASSWORD; if it is
// missing, nobody can get in, so the wall fails closed.
import { createHash, timingSafeEqual } from 'node:crypto'

export const GATE_COOKIE = 'bp_site_gate'
export const GATE_PATH = '/gate'

export function gateEnabled() {
  const mode = process.env.SITE_GATE
  if (mode === 'off') return false
  return mode === 'on' || process.env.VERCEL_ENV === 'production'
}

function password() {
  return process.env.SITE_GATE_PASSWORD || ''
}

/** The cookie holds a hash, never the password; changing the password signs everyone out. */
function tokenFor(pw: string) {
  return createHash('sha256').update(`blockparty-site-gate:${pw}`).digest('hex')
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function hasGatePass(cookieValue: string | undefined) {
  const pw = password()
  return Boolean(pw && cookieValue && safeEqual(cookieValue, tokenFor(pw)))
}

/** Returns the cookie value to set if the password is right, otherwise null. */
export function checkGatePassword(attempt: string) {
  const pw = password()
  if (!pw || !safeEqual(tokenFor(attempt), tokenFor(pw))) return null
  return tokenFor(pw)
}

/** Only same-site paths, so the wall can't be used as an open redirect. */
export function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
