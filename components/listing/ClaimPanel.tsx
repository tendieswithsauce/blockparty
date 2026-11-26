// components/listing/ClaimPanel.tsx
// "Claim it" for free listings. No card, no fees: the claim becomes an order
// like any other (agree a meetup or pickup time, handoff code, reviews), so
// the safety features still apply. First come, first served.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Gift } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HandoffChoice, HandoffDeadlineNote } from '@/components/listing/HandoffChoice'
import { type HandoffMethod, type HandoffOptions, availableMethods, handoffDeadline, methodTitle } from '@/lib/handoff'

type ListingInfo = { id: number; title: string; sellerId: string; status: string; handoff: HandoffOptions }

export function ClaimPanel({ listing }: { listing: ListingInfo }) {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [hasHomeAddress, setHasHomeAddress] = useState(false)
  const [claimId, setClaimId] = useState<number | null>(null)
  const [method, setMethod] = useState<HandoffMethod>(
    () => availableMethods(listing.handoff).find((m) => m !== 'delivery') ?? 'meetup',
  )
  const [confirming, setConfirming] = useState(false)
  const [openedAt, setOpenedAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    async function load() {
      const { data: auth } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }))
      if (cancelled) return
      const uid = auth.user?.id ?? null
      if (!uid) return setUserId(null)
      const [{ data: profile }, { data: txn }] = await Promise.all([
        supabase.from('profiles').select('home_address').eq('id', uid).single(),
        supabase
          .from('transactions')
          .select('id')
          .eq('listing_id', listing.id)
          .eq('buyer_id', uid)
          .in('status', ['authorized', 'completed'])
          .maybeSingle(),
      ])
      if (cancelled) return
      setHasHomeAddress(Boolean(profile?.home_address))
      if (txn) setClaimId(txn.id)
      setUserId(uid)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [listing.id])

  async function claim() {
    setError('')
    setBusy(true)
    const { data, error: rpcError } = await createClient().rpc('claim_free_item', {
      p_listing_id: listing.id,
      p_handoff: method,
    })
    setBusy(false)
    if (rpcError || !data) {
      return setError(rpcError?.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    }
    setClaimId(data)
    setConfirming(false)
    router.push(`/orders/${data}`)
  }

  const handoff = { ...listing.handoff, deliveryFeeCents: null }

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
      <p className="text-4xl font-extrabold text-[#2E8B57]">Free</p>
      <p className="text-sm text-slate-500 -mt-2">No card and no fees. First to claim it gets it.</p>

      {claimId ? (
        <div className="space-y-3">
          <div className="flex items-start gap-2 p-4 rounded-xl bg-green-50 text-green-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p>
              <span className="font-semibold">You claimed it!</span> Agree on a time with the seller on the order page.
            </p>
          </div>
          <Link
            href={`/orders/${claimId}`}
            className="block text-center w-full py-3 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold hover:bg-[#0E4D5C]/5"
          >
            View order &amp; meetup
          </Link>
        </div>
      ) : userId === undefined ? (
        <div className="h-12 rounded-full bg-slate-100 animate-pulse" />
      ) : listing.status !== 'active' ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">Someone has already claimed this.</p>
      ) : userId === null ? (
        <Link
          href={`/login?next=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className="block text-center w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
        >
          Sign in to claim it
        </Link>
      ) : userId === listing.sellerId ? (
        <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3">This is your listing.</p>
      ) : (
        <div className="space-y-3">
          {error && !confirming && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
          <button
            onClick={() => {
              setError('')
              setOpenedAt(Date.now())
              setConfirming(true)
            }}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a]"
          >
            <Gift className="w-4 h-4" /> Claim it
          </button>
          <p className="text-xs text-slate-500">You&apos;ll choose how to get it before anything happens.</p>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Claim ${listing.title}?`}
          confirmLabel="Claim it"
          busyLabel="Claiming…"
          busy={busy}
          error={error}
          onConfirm={claim}
          onCancel={() => {
            setConfirming(false)
            setError('')
          }}
        >
          <HandoffChoice options={handoff} value={method} onChange={setMethod} hasHomeAddress={hasHomeAddress} listingId={listing.id} />
          <p>
            It&apos;s free. You and the seller agree on a time on the order page ({methodTitle(method).toLowerCase()}). When you
            get it, show the seller your handoff code so you both get credit for the handoff.
          </p>
          <HandoffDeadlineNote deadline={handoffDeadline(openedAt)} auction={false} free />
          <p>
            Only claim it if you&apos;ll pick it up. If you can&apos;t make it, cancel on the order page so someone else can have
            it: not showing up gets a strike, and cancellations count toward the limit.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
