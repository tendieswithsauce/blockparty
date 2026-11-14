// components/SiteHeader.tsx
import Link from 'next/link'
import { BrandLogo } from '@/components/BrandLogo'
import { AuthNav } from '@/components/AuthNav'

type Section = 'browse' | 'auctions' | 'how' | null

export function SiteHeader({ active = null }: { active?: Section }) {
  const link = (section: Section) =>
    active === section ? 'text-[#F26B5B] transition' : 'hover:text-[#F26B5B] transition'

  return (
    <header className="w-full max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
      <BrandLogo />
      <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#1E293B]">
        <Link href="/listings" className={link('browse')}>
          Browse Local
        </Link>
        <Link href="/listings?type=auction" className={link('auctions')}>
          Active Auctions
        </Link>
        <Link href="/#how-it-works" className={link('how')}>
          How It Works
        </Link>
        <AuthNav />
      </nav>
      {/* Small screens: keep account access reachable */}
      <div className="md:hidden text-sm font-semibold text-[#1E293B]">
        <AuthNav />
      </div>
    </header>
  )
}
