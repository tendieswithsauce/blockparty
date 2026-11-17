// components/Stars.tsx
// Read-only star rating ("4.5" -> four and a half stars).
import { Star } from 'lucide-react'

export function Stars({ rating, size = 'w-4 h-4' }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center" aria-label={`${rating} out of 5 stars`} role="img">
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - (i - 1)))
        return (
          <span key={i} className={`relative inline-block ${size}`}>
            <Star className={`absolute inset-0 ${size} text-slate-300`} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star className={`${size} text-[#F4A261] fill-[#F4A261]`} />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** "★ 4.8 (12 reviews)" or "No reviews yet". */
export function RatingSummary({ rating, count }: { rating: number | null; count: number }) {
  if (!count || rating === null) return <span className="text-slate-500">No reviews yet</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Stars rating={rating} />
      <span className="font-semibold">{rating.toFixed(1)}</span>
      <span className="text-slate-500">
        ({count} {count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  )
}
