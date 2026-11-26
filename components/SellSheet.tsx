// components/SellSheet.tsx
// What the phone tab bar's Sell button opens, on whatever page you're on:
// the new-listing sheet, or the "set up payouts first" prompt for sellers
// who can't receive money yet. The dashboard listens for LISTING_CREATED_EVENT
// to refresh its list; elsewhere a short confirmation shows the result.
'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { CheckCircle2, Clock, Landmark, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CreateListingModal } from '@/components/dashboard/CreateListingModal'
import { SetUpPayoutsButton } from '@/components/dashboard/PayoutButton'
import { getPayoutStatus } from '@/app/payouts/actions'
import type { ModerationResult } from '@/lib/moderation/check-listing'
import { SecuredByStripe } from '@/components/StripeBadge'

/** Fired after a listing is created from the Sell sheet (detail: the moderation result). */
export const LISTING_CREATED_EVENT = 'blockparty:listing-created'

type View =
  | { kind: 'closed' }
  | { kind: 'checking' }
  | { kind: 'payouts'; hasAccount: boolean; verifying: boolean; areaId?: string }
  | { kind: 'create'; areaId?: string; freeOnly?: boolean }
  | { kind: 'done'; result: ModerationResult }

export function useSellSheet({ onDashboard }: { onDashboard: boolean }) {
  const [view, setView] = useState<View>({ kind: 'closed' })

  async function open() {
    if (view.kind !== 'closed') return
    setView({ kind: 'checking' })
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return setView({ kind: 'closed' })
    const { data: profile } = await supabase
      .from('profiles')
      .select('area_id, stripe_account_id, stripe_payouts_enabled')
      .eq('id', auth.user.id)
      .maybeSingle()
    if (profile?.stripe_payouts_enabled) return setView({ kind: 'create', areaId: profile.area_id ?? undefined })
    // Not ready on our side: ask Stripe, in case they finished setup since we last checked.
    const status = await getPayoutStatus().catch(() => null)
    if (status?.ready) return setView({ kind: 'create', areaId: profile?.area_id ?? undefined })
    setView({
      kind: 'payouts',
      hasAccount: Boolean(status?.accountId ?? profile?.stripe_account_id),
      verifying: Boolean(status?.verifying),
      areaId: profile?.area_id ?? undefined,
    })
  }

  const close = () => setView({ kind: 'closed' })

  const sheet =
    view.kind === 'closed' ? null : view.kind === 'checking' ? (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" role="status" aria-live="polite">
        <span className="bg-white rounded-2xl px-5 py-4 shadow-xl flex items-center gap-3 text-sm font-semibold">
          <Loader2 className="w-5 h-5 animate-spin text-[#0E4D5C]" /> One moment…
        </span>
      </div>
    ) : view.kind === 'payouts' ? (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
        <div className="bg-white max-w-md w-full p-6 rounded-2xl space-y-4">
          <Landmark className="w-8 h-8 text-[#0E4D5C]" />
          <h2 className="text-xl font-bold">{view.verifying ? 'Stripe is verifying your details' : 'Set up payouts first'}</h2>
          <p className="text-slate-600 text-sm">
            {view.verifying
              ? "You've sent Stripe everything they need. Verification usually takes a minute or two; try again shortly."
              : 'To sell for money, connect a bank account with Stripe so we can send you the money once your buyer picks it up. It takes about 5 minutes.'}
          </p>
          <SecuredByStripe text="Your identity and bank details go straight to Stripe, not to Blockparty." />
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={close} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
              {view.verifying ? 'OK' : 'Not now'}
            </button>
            {!view.verifying && <SetUpPayoutsButton label={view.hasAccount ? 'Finish payout setup' : 'Set up payouts'} />}
          </div>
          <div className="border-t pt-4 text-sm">
            <p className="text-slate-600">Just giving something away? You don&apos;t need payouts for that.</p>
            <button
              type="button"
              onClick={() => setView({ kind: 'create', areaId: view.areaId, freeOnly: true })}
              className="mt-2 font-semibold text-[#2E8B57] underline"
            >
              List something for free
            </button>
          </div>
        </div>
      </div>
    ) : view.kind === 'create' ? (
      <CreateListingModal
        defaultArea={view.areaId}
        freeOnly={view.freeOnly}
        onClose={close}
        onCreated={(result) => {
          window.dispatchEvent(new CustomEvent(LISTING_CREATED_EVENT, { detail: result }))
          // The dashboard shows its own notice and refreshes; elsewhere, confirm here.
          setView(onDashboard ? { kind: 'closed' } : { kind: 'done', result })
        }}
      />
    ) : (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
        <div className="bg-white max-w-sm w-full p-6 rounded-2xl space-y-3 text-center">
          {view.result === 'approved' ? (
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-600" />
          ) : (
            <Clock className="w-10 h-10 mx-auto text-[#0E4D5C]" />
          )}
          <h2 className="text-lg font-bold">{view.result === 'approved' ? 'Your listing is live!' : 'Listing saved'}</h2>
          <p className="text-sm text-slate-600">
            {view.result === 'approved'
              ? 'Neighbours can find it on Browse now.'
              : view.result === 'held'
                ? "We're taking a closer look before it goes live. We'll let you know."
                : "It'll go live in a minute or two, once our automatic check finishes."}
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <button onClick={close} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-full font-semibold">
              Done
            </button>
            <Link
              href="/dashboard"
              onClick={close}
              className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white font-semibold"
            >
              My listings
            </Link>
          </div>
        </div>
      </div>
    )

  // Rendered into <body>, so nothing on the page (or the tab bar itself) can cover it.
  return { open, sheet: sheet ? createPortal(sheet, document.body) : null }
}
