// components/SiteFooter.tsx
// The deep-teal footer used on public pages (home, Browse, legal pages),
// with the site links and the Terms of Use / Privacy Policy.
import Link from 'next/link'

export function SiteFooter() {
  const link = 'hover:text-white transition'
  return (
    <footer className="bg-[#0E4D5C] text-white pt-12 pb-10 px-6 mt-16">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start gap-8">
        <div className="space-y-2">
          <span className="text-2xl font-extrabold text-[#F26B5B]">Blockparty</span>
          <p className="text-sm text-slate-200 max-w-xs">
            Built by neighbours, for neighbours. Bid, buy and sell safely in your neighbourhood.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-slate-200">
          <Link href="/listings" className={link}>
            Browse
          </Link>
          <Link href="/listings?type=auction" className={link}>
            Auctions
          </Link>
          <Link href="/charities" className={link}>
            Charities
          </Link>
          <Link href="/#how-it-works" className={link}>
            How It Works
          </Link>
          <Link href="/about" className={link}>
            About Us
          </Link>
          <Link href="/terms" className={link}>
            Terms of Use
          </Link>
          <Link href="/privacy" className={link}>
            Privacy Policy
          </Link>
        </nav>
      </div>
      <p className="max-w-6xl mx-auto mt-8 text-xs text-slate-300">© Blockparty</p>
    </footer>
  )
}
