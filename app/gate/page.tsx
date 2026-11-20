// app/gate/page.tsx
// The password wall shown in front of the whole site (see lib/site-gate.ts).
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthShell } from '@/components/auth/AuthShell'
import { safeNext } from '@/lib/site-gate'
import { enterSite } from './actions'

export const metadata: Metadata = {
  title: 'Coming soon',
  robots: { index: false, follow: false },
}

export default function GatePage({ searchParams }: PageProps<'/gate'>) {
  return (
    <AuthShell title="Coming soon" subtitle="Blockparty is in private testing. Enter the password to continue.">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}>
        <GateForm searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  )
}

async function GateForm({ searchParams }: { searchParams: PageProps<'/gate'>['searchParams'] }) {
  const params = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const next = safeNext(one(params.next))
  const error = one(params.error) === '1'

  return (
    <form action={enterSite} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="text-sm font-bold text-slate-700">Password</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:border-[#0E4D5C] focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]/20"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-600">
          That password isn&apos;t right.
        </p>
      )}
      <button
        type="submit"
        className="w-full rounded-xl bg-[#F26B5B] px-4 py-3 font-bold text-white hover:bg-[#e05a4a]"
      >
        Enter
      </button>
    </form>
  )
}
