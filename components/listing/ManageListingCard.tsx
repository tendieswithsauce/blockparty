// components/listing/ManageListingCard.tsx
// The seller's "Manage your listing" card on their own listing page.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ManageListing, type ManagedListing } from '@/components/listing/ManageListing'

export function ManageListingCard({ listing }: { listing: ManagedListing }) {
  const router = useRouter()
  const [notice, setNotice] = useState('')

  return (
    <div className="space-y-2">
      {notice && <p className="p-3 text-sm rounded-xl bg-green-50 text-green-800">{notice}</p>}
      <ManageListing
        listing={listing}
        variant="card"
        onDone={(result, message) => {
          if (result === 'deleted') {
            router.push('/dashboard')
            return
          }
          setNotice(message)
          router.refresh()
        }}
      />
    </div>
  )
}
