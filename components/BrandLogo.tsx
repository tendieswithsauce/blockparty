// components/BrandLogo.tsx
import Link from 'next/link'

export function BrandLogo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-3xl' : 'text-2xl'
  return (
    <Link href="/" className="inline-flex items-center gap-2">
      <span className="flex items-center -space-x-1" aria-hidden>
        <span className="w-4 h-4 rounded-t-full bg-[#F26B5B] inline-block" />
        <span className="w-4 h-4 rounded-t-full bg-[#0E4D5C] inline-block" />
        <span className="w-4 h-4 rounded-t-full bg-[#F4A261] inline-block" />
      </span>
      <span className={`${text} font-extrabold tracking-tight text-[#F26B5B]`}>
        Blockparty
        {/* Beta tag: remove at full launch. */}
        <sup className="ml-0.5 align-super text-[0.4em] font-bold uppercase tracking-wider text-[#0E4D5C]">beta</sup>
      </span>
    </Link>
  )
}
