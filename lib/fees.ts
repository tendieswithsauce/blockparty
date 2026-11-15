// lib/fees.ts
// Blockparty's platform fee, taken from the seller's payout. The buyer pays the
// listed price; the seller receives the price minus this fee.
// Introductory rate: change PLATFORM_FEE_BPS to adjust (basis points, 500 = 5%).

export const PLATFORM_FEE_BPS = 500

export const PLATFORM_FEE_LABEL = `${PLATFORM_FEE_BPS / 100}%`

/** Fee in cents, rounded to the nearest cent (matches begin_purchase in SQL). */
export function platformFeeCents(amountCents: number) {
  return Math.floor((amountCents * PLATFORM_FEE_BPS + 5000) / 10000)
}

export function sellerPayoutCents(amountCents: number) {
  return amountCents - platformFeeCents(amountCents)
}
