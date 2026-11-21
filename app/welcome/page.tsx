// app/welcome/page.tsx
// First stop after confirming an account (lib/auth/onboarding.ts): fill in the
// required details if they're missing (Google sign-ups skip the sign-up form),
// then optionally add a payment method.
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { safeNextPath } from '@/lib/auth/redirect'
import { WelcomeFlow } from './WelcomeFlow'

export const metadata: Metadata = { title: 'Finish setting up' }

export default function WelcomePage({ searchParams }: PageProps<'/welcome'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] px-4 py-10">
      <Suspense fallback={<div className="max-w-xl mx-auto h-96 rounded-2xl bg-slate-200 animate-pulse" />}>
        {searchParams.then((p) => (
          <WelcomeFlow next={safeNextPath(Array.isArray(p.next) ? p.next[0] : p.next)} />
        ))}
      </Suspense>
    </div>
  )
}
