// components/Avatar.tsx
// A round profile photo, or the first letter of the name when there isn't one.
import { avatarUrl } from '@/lib/avatar'

const SIZES = {
  xs: 'w-6 h-6 text-[11px]',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-20 h-20 text-3xl',
} as const

export function Avatar({
  path,
  name,
  size = 'sm',
  className = '',
}: {
  path: string | null | undefined
  name: string | null | undefined
  size?: keyof typeof SIZES
  className?: string
}) {
  const url = avatarUrl(path)
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  return (
    <span
      className={`${SIZES[size]} inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 bg-[#F4A261]/30 text-[#0E4D5C] font-bold ${className}`}
      aria-hidden={!url}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase public URL
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        initial
      )}
    </span>
  )
}
