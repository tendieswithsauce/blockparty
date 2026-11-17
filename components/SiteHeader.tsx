// components/SiteHeader.tsx
import Link from 'next/link'
import { BrandLogo } from '@/components/BrandLogo'
import { AuthNav, type NavSection } from '@/components/AuthNav'

export function SiteHeader({ active = null }: { active?: NavSection }) {
  const link = (section: NavSection) =>
    active === section ? 'text-[#F26B5B] transition' : 'hover:text-[#F26B5B] transition'

  return (
    <header className="w-full max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-6 flex items-center justify-between gap-4">
      <BrandLogo />
      <nav className="hidden md:flex items-center gap-8 ml-auto mr-8 text-sm font-semibold text-[#1E293B]">
        <Link href="/listings" className={link('browse')}>
          Browse Local
        </Link>
        <Link href="/listings?type=auction" className={link('auctions')}>
          Active Auctions
        </Link>
        <Link href="/charities" className={link('charities')}>
          Charities
        </Link>
        <Link href="/#how-it-works" className={link('how')}>
          How It Works
        </Link>
      </nav>
      {/* Desktop account controls, the phone top-right controls and the phone bottom tab bar. */}
      <AuthNav active={active} />
    </header>
  )
}
