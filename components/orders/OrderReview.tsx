// components/orders/OrderReview.tsx
// After the handoff: rate the other person (1-5 stars + optional comment)
// within 14 days. Their review of you shows once you've both reviewed, or
// after the 14 days (see public.review_published).
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Stars } from '@/components/Stars'

const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
const LABELS = ['', 'Poor', 'Not great', 'OK', 'Good', 'Great']

type Review = { reviewer_id: string; rating: number; comment: string | null }

export function OrderReview({
  orderId,
  userId,
  other,
  pickedUpAt,
  now,
}: {
  orderId: number
  userId: string
  other: string
  pickedUpAt: string | null
  now: number | null
}) {
  const [reviews, setReviews] = useState<Review[] | null>(null)
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('reviews')
      .select('reviewer_id, rating, comment')
      .eq('transaction_id', orderId)
    setReviews(data ?? [])
  }, [orderId])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  if (reviews === null) return null
  const mine = reviews.find((r) => r.reviewer_id === userId)
  const theirs = reviews.find((r) => r.reviewer_id !== userId)
  const open = pickedUpAt !== null && now !== null && now < new Date(pickedUpAt).getTime() + REVIEW_WINDOW_MS

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!rating) return setError('Choose 1 to 5 stars.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('leave_review', {
      p_transaction_id: orderId,
      p_rating: rating,
      p_comment: comment.trim() || null,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : "Couldn't save your review. Try again.")
    load()
  }

  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
      {!mine && open ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="font-bold">How did it go with {other}?</p>
          <p className="text-sm text-slate-600">
            Your review shows on {other}&apos;s profile once you&apos;ve both reviewed each other (or after 14 days), so neither
            of you sees the other&apos;s first.
          </p>
          <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setRating(i)}
                onMouseEnter={() => setHover(i)}
                aria-label={`${i} ${i === 1 ? 'star' : 'stars'}`}
                aria-pressed={rating === i}
                className="p-0.5"
              >
                <Star
                  className={`w-8 h-8 ${i <= (hover || rating) ? 'text-[#F4A261] fill-[#F4A261]' : 'text-slate-300'}`}
                />
              </button>
            ))}
            <span className="ml-2 text-sm font-semibold text-slate-600">{LABELS[hover || rating]}</span>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Optional: was the item as described? Did they show up on time?"
            className="w-full border px-3 py-2 rounded-lg text-sm"
          />
          {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Post review'}
          </button>
        </form>
      ) : mine ? (
        <div className="space-y-1">
          <p className="font-bold">Your review of {other}</p>
          <p className="flex items-center gap-2 text-sm">
            <Stars rating={mine.rating} /> {mine.comment && <span className="text-slate-700">{mine.comment}</span>}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Reviews for this sale have closed.</p>
      )}

      {theirs ? (
        <div className="space-y-1 border-t pt-4">
          <p className="font-bold">{other}&apos;s review of you</p>
          <p className="flex items-center gap-2 text-sm">
            <Stars rating={theirs.rating} /> {theirs.comment && <span className="text-slate-700">{theirs.comment}</span>}
          </p>
        </div>
      ) : mine && open ? (
        <p className="text-sm text-slate-500 border-t pt-4">
          Thanks! {other}&apos;s review of you will show here once they&apos;ve left one, or after 14 days.
        </p>
      ) : null}
    </div>
  )
}
