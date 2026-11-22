// lib/payments/close-auction.ts
// Closes an ended auction: the top eligible bidder becomes the winner and has
// 24 hours to confirm and pay on the order page (app/purchases/actions.ts,
// confirmAuctionWin). Nothing is charged here. Also used when a winner backs
// out or lets the 24 hours run out (the listing is set back to active), so
// the item goes straight to the next bidder. Called by the cron route,
// cancelOrder and declineAuctionWin.
import { createAdminClient } from '@/lib/supabase/admin'
import { MIN_PLATFORM_FEE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'

export type CloseAuctionOutcome =
  | { listingId: number; result: 'awaiting_confirmation'; transactionId: number }
  | { listingId: number; result: 'no_winner' | 'already_closed' }
  | { listingId: number; result: 'error'; message: string }

export async function closeAuction(listingId: number): Promise<CloseAuctionOutcome> {
  const { data: txn, error } = await createAdminClient().rpc('close_auction', {
    p_listing_id: listingId,
    p_fee_bps: PLATFORM_FEE_BPS,
    p_min_fee_cents: MIN_PLATFORM_FEE_CENTS,
  })
  if (error) return { listingId, result: 'error', message: error.message }
  if (!txn?.id) return { listingId, result: 'no_winner' }
  if (txn.status !== 'pending') return { listingId, result: 'already_closed' }
  return { listingId, result: 'awaiting_confirmation', transactionId: txn.id }
}
