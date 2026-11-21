// components/StripeBadge.tsx
// Stripe's official "Powered by Stripe" badge (unaltered artwork in
// public/stripe/), linking to stripe.com. Shown wherever we talk about
// payments, cards or payouts, so people can see who handles their money.
// Blurple on light backgrounds, white on the dark teal footer.

const SRC = {
  blurple: '/stripe/powered-by-stripe-blurple.svg',
  black: '/stripe/powered-by-stripe-black.svg',
  white: '/stripe/powered-by-stripe-white.svg',
} as const

export function StripeBadge({
  variant = 'blurple',
  className = '',
  size = 'md',
}: {
  variant?: keyof typeof SRC
  className?: string
  /** sm = 24px tall, md = 30px. */
  size?: 'sm' | 'md'
}) {
  const height = size === 'sm' ? 24 : 30
  return (
    <a
      href="https://stripe.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Powered by Stripe (opens stripe.com)"
      className={`inline-block shrink-0 hover:opacity-80 transition-opacity ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG badge, no optimisation needed */}
      <img src={SRC[variant]} alt="Powered by Stripe" width={Math.round((height * 150) / 34)} height={height} />
    </a>
  )
}

/** A short line plus the badge, for under payment forms and money-related notes. */
export function SecuredByStripe({ text = 'Payments are processed securely by Stripe.', className = '' }: { text?: string; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500 ${className}`}>
      <StripeBadge size="sm" />
      <span>{text}</span>
    </div>
  )
}
