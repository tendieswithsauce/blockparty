// components/dashboard/PayoutButton.tsx
// Buttons that send a seller to Stripe: payout onboarding, or their Express dashboard.
'use client'

import { useActionState } from 'react'
import { openPayoutDashboard, startPayoutOnboarding, type PayoutActionState } from '@/app/payouts/actions'

const initial: PayoutActionState = {}

export function SetUpPayoutsButton({ label = 'Set up payouts', className }: { label?: string; className?: string }) {
  const [state, action, pending] = useActionState(startPayoutOnboarding, initial)
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <button
        type="submit"
        disabled={pending}
        className={
          className ??
          'px-4 py-2 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold hover:bg-[#0b3f4b] disabled:opacity-60'
        }
      >
        {pending ? 'Opening Stripe…' : label}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  )
}

export function PayoutDashboardButton() {
  const [state, action, pending] = useActionState(openPayoutDashboard, initial)
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <button type="submit" disabled={pending} className="text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B] disabled:opacity-60">
        {pending ? 'Opening Stripe…' : 'View payouts →'}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  )
}
