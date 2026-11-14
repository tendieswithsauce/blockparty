// app/signup/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import { SignupForm } from './SignupForm'

export const metadata: Metadata = { title: 'Create an account' }

export default function SignupPage() {
  return (
    <AuthShell
      title="Join Blockparty"
      subtitle="Your free account lets you bid, buy and list items"
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-bold text-[#0E4D5C] hover:text-[#F26B5B]">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  )
}
