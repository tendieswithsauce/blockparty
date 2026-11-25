'use server'
// The trusted contact's answer (no sign-in: the token from their email is the key).
import { createClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/safety-buddy'

export type BuddyAnswer = { ok: true; status: 'agreed' | 'declined' } | { ok: false; error: string }

export async function answerSafetyBuddy(token: string, agree: boolean): Promise<BuddyAnswer> {
  if (!UUID_RE.test(token)) return { ok: false, error: 'This link doesn’t work any more.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('answer_safety_buddy', { p_token: token, p_agree: agree })
  if (error) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Something went wrong. Please try again.' }
  return { ok: true, status: data === 'agreed' ? 'agreed' : 'declined' }
}
