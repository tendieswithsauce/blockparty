// lib/supabase/admin.ts
// Service-role Supabase client: bypasses RLS and column grants. Server-only.
// Use it only for writes users are not allowed to make themselves (e.g. the
// Stripe IDs on profiles), and only after verifying who the user is.
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
