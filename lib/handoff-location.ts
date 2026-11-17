// lib/handoff-location.ts
// Records where the buyer and seller are when the handoff code is shown and
// entered (browser-only). Only Blockparty admins can see it, and it's deleted
// after 90 days. If the person says no, or there's no fix within a few
// seconds, the handoff goes ahead without it.
import { createClient } from '@/lib/supabase/client'

function currentPosition(timeoutMs: number): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        resolve(pos)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** Returns whether a location was recorded. Never throws. */
export async function recordHandoffLocation(transactionId: number, timeoutMs = 6000): Promise<boolean> {
  try {
    const pos = await currentPosition(timeoutMs)
    if (!pos) return false
    const { error } = await createClient().rpc('record_handoff_location', {
      p_transaction_id: transactionId,
      p_lat: pos.coords.latitude,
      p_lng: pos.coords.longitude,
      p_accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
    })
    return !error
  } catch {
    return false
  }
}
