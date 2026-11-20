// components/listing/ConvertToAuctionButton.tsx
// On the seller's own set-price listing: switch it to an auction right from
// the listing page (the same dialog as on the dashboard). Once per listing.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Gavel } from 'lucide-react'
import { ConvertToAuctionModal } from '@/components/dashboard/ConvertToAuctionModal'

export function ConvertToAuctionButton({
  listing,
}: {
  listing: { id: number; title: string; priceCents: number; watchCount: number }
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <div className="bg-white border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 text-sm">
        <p className="font-bold text-[#0E4D5C] flex items-center gap-2">
          <Gavel className="w-4 h-4 text-[#F26B5B]" /> Not selling at this price?
        </p>
        <p className="text-slate-600 mt-0.5">Switch it to an auction and let buyers bid. You can do this once per listing.</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white text-sm font-bold hover:bg-[#e05848] shrink-0"
      >
        Switch to auction
      </button>
      {open && (
        <ConvertToAuctionModal
          listing={listing}
          onClose={() => setOpen(false)}
          onConverted={() => {
            setOpen(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
