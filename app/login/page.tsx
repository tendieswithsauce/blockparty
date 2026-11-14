// app/login/page.tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to bid, buy and sell in your neighborhood"
      footer={
        <>
          New to Blockparty?{' '}
          <Link href="/signup" className="font-bold text-[#0E4D5C] hover:text-[#F26B5B]">
            Create an account
          </Link>
        </>
      }
    >
      {/* LoginForm reads ?next= and ?error=, which are request-time values. */}
      <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl bg-slate-100" />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  )
}
