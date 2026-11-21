// app/admin/actions.ts
// Admin steps that also touch storage. The database function checks
// is_admin() as the signed-in user; only then are the photos removed with
// the service role (members can only delete files in their own folder).
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

type Result = { ok: true; photosRemoved: number } | { ok: false; error: string }

// Same shape as profiles/listing photo paths: "<user uuid>/<file name>".
const PHOTO_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Supabase has no "forever"; 100 years will do.
const BAN_FOREVER = '876000h'

type SimpleResult = { ok: true; warning?: string } | { ok: false; error: string }

/**
 * Suspend a member: the database records it (admin-checked), which hides
 * their listings and blocks listing, bidding and buying straight away; then
 * their sign-in is banned, so they can't start a new session.
 */
export async function suspendUser(userId: string, reason: string): Promise<SimpleResult> {
  if (!UUID.test(userId)) return { ok: false, error: 'Unknown member.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_suspend_user', { p_user_id: userId, p_reason: reason })
  // Already suspended: carry on and re-apply the sign-in block (a retry after a failed ban).
  const retry = error?.code === 'P0001' && error.message.includes('already suspended')
  if (error && !retry) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not suspend them.' }

  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER })
  if (banError) {
    console.error('suspendUser: ban failed', userId, banError.message)
    return {
      ok: true,
      warning: "Suspended, but blocking their sign-in failed. They still can't list, bid or buy. Try suspending again later.",
    }
  }
  return { ok: true }
}

export async function unsuspendUser(userId: string): Promise<SimpleResult> {
  if (!UUID.test(userId)) return { ok: false, error: 'Unknown member.' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_unsuspend_user', { p_user_id: userId })
  if (error) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not unsuspend them.' }

  const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (banError) {
    console.error('unsuspendUser: unban failed', userId, banError.message)
    return { ok: true, warning: "Unsuspended, but lifting the sign-in block failed. Try again in a moment." }
  }
  return { ok: true }
}

export async function deleteListing(listingId: number, reason: string): Promise<Result> {
  if (!Number.isSafeInteger(listingId) || listingId <= 0) return { ok: false, error: 'Unknown listing.' }
  const supabase = await createClient()
  const { data: orphaned, error } = await supabase.rpc('admin_delete_listing', {
    p_listing_id: listingId,
    p_reason: reason,
  })
  if (error) return { ok: false, error: error.code === 'P0001' ? `${error.message}.` : 'Could not delete it.' }

  const paths = (orphaned ?? []).filter((p) => PHOTO_PATH.test(p))
  if (paths.length > 0) {
    const { error: storageError } = await createAdminClient().storage.from('listing-photos').remove(paths)
    // The listing is gone either way; leftover files are only clutter.
    if (storageError) console.error('deleteListing: removing photos failed', listingId, storageError.message)
  }
  return { ok: true, photosRemoved: paths.length }
}
