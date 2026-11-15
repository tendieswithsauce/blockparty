// lib/purchase-rules.ts
// How long a buyer can undo a Buy Now purchase after it goes through.
// The seller is only told about the sale once this window has passed.
export const BUY_NOW_CANCEL_WINDOW_SECONDS = 5 * 60

// Extra time the server allows past the countdown shown to the buyer, so a
// click right at 0:01 on a slow connection still counts.
export const CANCEL_GRACE_SECONDS = 30
