// lib/safety-buddy.ts
// Shared by the trusted contact page (/buddy/[token]) and its action.

/** Tokens in trusted contact links are UUIDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
