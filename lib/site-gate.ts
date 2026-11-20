// lib/site-gate.ts
// Password wall for the whole site (used on the live domain until beta).
//
// On by default for Vercel Production deployments. SITE_GATE=on turns it on
// anywhere (e.g. the dev site, if Vercel's own login wall is switched off);
// SITE_GATE=off turns it off. The password is SITE_GATE_PASSWORD; if it is
// missing, nobody can get in, so the wall fails closed.
import { scryptSync, timingSafeEqual } from 'node:crypto'

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

/**
 * The cookie holds a slow (scrypt) hash, never the password, so a copied
 * cookie can't easily be brute-forced back into the password. Changing the
 * password signs everyone out. The hash of the real password is computed once
 * per server instance, so page loads stay fast.
 */
function tokenFor(pw: string) {
  return scryptSync(pw, 'blockparty-site-gate', 32).toString('hex')
}

let cached: { pw: string; token: string } | null = null
function expectedToken(pw: string) {
  if (cached?.pw !== pw) cached = { pw, token: tokenFor(pw) }
  return cached.token
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function hasGatePass(cookieValue: string | undefined) {
  const pw = password()
  return Boolean(pw && cookieValue && safeEqual(cookieValue, expectedToken(pw)))
}

/** Returns the cookie value to set if the password is right, otherwise null. */
export function checkGatePassword(attempt: string) {
  const pw = password()
  if (!pw) return null
  const token = expectedToken(pw)
  return safeEqual(tokenFor(attempt), token) ? token : null
}

/** Only same-site paths, so the wall can't be used as an open redirect. */
export function safeNext(next: string | null | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
