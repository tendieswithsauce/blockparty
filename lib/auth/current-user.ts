// lib/auth/current-user.ts
// The signed-in user for server code (Server Actions, Route Handlers), read
// from the verified session JWT. Returns null when signed out.
import { createClient } from '@/lib/supabase/server'

export type CurrentUser = { id: string; email?: string }

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims?.sub) return null
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined }
}
