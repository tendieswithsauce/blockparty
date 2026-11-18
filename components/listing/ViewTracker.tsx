// components/listing/ViewTracker.tsx
// Logs that this listing was opened (see lib/track.ts). Renders nothing.
'use client'

import { useEffect } from 'react'
import { previousSection, trackListingView } from '@/lib/track'

export function ViewTracker({ listingId }: { listingId: number }) {
  useEffect(() => {
    // Where they came from on our site, e.g. "listings" (Browse), "charities", "dashboard".
    let source = previousSection(window.location.pathname)
    if (!source) {
      try {
        const ref = document.referrer ? new URL(document.referrer) : null
        if (ref && ref.origin === window.location.origin) source = ref.pathname.split('/')[1] || 'home'
        else if (ref) source = 'external'
      } catch {}
    }
    trackListingView(listingId, source)
  }, [listingId])
  return null
}
