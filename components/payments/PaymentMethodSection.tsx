// components/payments/PaymentMethodSection.tsx
// "Payment method" card on the profile page: shows the saved card and lets the
// user add or replace it with Stripe's Payment Element (no charge is made).
'use client'

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import {
  completeSetupIntent,
  createSetupIntent,
  getSavedCard,
  type SavedCard,
} from '@/app/profile/payment-actions'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
// Load Stripe.js once, outside render.
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

const BRAND_NAMES: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  jcb: 'JCB',
  diners: 'Diners Club',
  unionpay: 'UnionPay',
}

function CardLine({ card }: { card: SavedCard }) {
  const brand = BRAND_NAMES[card.brand] ?? card.brand
  const exp = `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <span className="font-medium">
        {brand} •••• {card.last4}
      </span>
      <span className="text-sm text-gray-500">Expires {exp}</span>
    </div>
  )
}

export function PaymentMethodSection() {
  const [card, setCard] = useState<SavedCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Returning from a bank redirect (rare for cards): finish saving.
      const params = new URLSearchParams(window.location.search)
      const returnedIntent = params.get('setup_intent')
      if (returnedIntent) {
        window.history.replaceState(null, '', window.location.pathname)
        const done = await completeSetupIntent(returnedIntent)
        if (cancelled) return
        if (done.ok) {
          setCard(done.data)
          setMessage('Card saved.')
        } else {
          setError(done.error)
        }
        setLoading(false)
        return
      }

      const res = await getSavedCard()
      if (cancelled) return
      if (res.ok) setCard(res.data)
      else setError(res.error)
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function startSetup() {
    setStarting(true)
    setError('')
    setMessage('')
    const res = await createSetupIntent()
    if (res.ok) setClientSecret(res.data.clientSecret)
    else setError(res.error)
    setStarting(false)
  }

  function onSaved(saved: SavedCard) {
    setCard(saved)
    setClientSecret(null)
    setMessage('Card saved.')
  }

  return (
    <div className="bg-white border rounded-xl p-8 shadow-sm mt-6">
      <h2 className="text-xl font-bold mb-1">Payment method</h2>
      <p className="text-sm text-gray-500 mb-5">
        Saved securely with Stripe. You&apos;re only charged when you win an auction or use Buy Now, and the
        money is held until you pick up your item.
      </p>

      {error && <div className="mb-4 p-3 text-sm rounded-lg bg-red-50 text-red-700">{error}</div>}
      {message && <div className="mb-4 p-3 text-sm rounded-lg bg-green-50 text-green-800">{message}</div>}

      {!stripePromise ? (
        <p className="text-sm text-gray-500">Card payments aren&apos;t available yet.</p>
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : clientSecret ? (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: 'stripe',
              variables: { colorPrimary: '#0E4D5C', borderRadius: '8px', fontFamily: 'inherit' },
            },
          }}
        >
          <SetupForm onSaved={onSaved} onCancel={() => setClientSecret(null)} onError={setError} />
        </Elements>
      ) : (
        <div className="space-y-4">
          {card ? <CardLine card={card} /> : <p className="text-sm text-gray-600">No card on file yet.</p>}
          <button
            type="button"
            onClick={startSetup}
            disabled={starting}
            className="w-full border-2 border-black py-3 rounded-lg font-medium hover:bg-gray-50 transition disabled:opacity-60"
          >
            {starting ? 'Loading…' : card ? 'Replace card' : 'Add a card'}
          </button>
        </div>
      )}
    </div>
  )
}

function SetupForm({
  onSaved,
  onCancel,
  onError,
}: {
  onSaved: (card: SavedCard) => void
  onCancel: () => void
  onError: (msg: string) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    onError('')

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/profile` },
    })

    if (error) {
      onError(error.message ?? 'Your card could not be saved.')
      setSubmitting(false)
      return
    }

    const done = await completeSetupIntent(setupIntent.id)
    if (done.ok) onSaved(done.data)
    else onError(done.error)
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 border py-3 rounded-lg font-medium hover:bg-gray-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="flex-1 bg-black text-white py-3 rounded-lg font-medium hover:bg-gray-800 transition disabled:opacity-60"
        >
          {submitting ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  )
}
