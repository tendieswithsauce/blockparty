// app/listings/actions.ts
// Runs the automatic check on a listing the current user just created, so
// they find out right away whether it's live or being reviewed.
'use server'

import { getCurrentUser } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkListing, type ModerationResult } from '@/lib/moderation/check-listing'

export async function checkMyNewListing(listingId: number): Promise<ModerationResult> {
  const user = await getCurrentUser()
  if (!user || !Number.isSafeInteger(listingId)) return 'skipped'
  const { data } = await createAdminClient().from('listings').select('seller_id').eq('id', listingId).maybeSingle()
  if (data?.seller_id !== user.id) return 'skipped'
  return checkListing(listingId)
}
