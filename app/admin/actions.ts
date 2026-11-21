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
