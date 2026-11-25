// app/buddy/[token]/page.tsx
// Where a trusted contact agrees (or says no) from the request email, and later
// stops. No sign-in or site password: the link's token is the key. Opening the
// page changes nothing; only the buttons do (mail scanners open links).
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthShell } from '@/components/auth/AuthShell'
import { createClient } from '@/lib/supabase/server'
import { UUID_RE } from '@/lib/safety-buddy'
import { BuddyAnswerButtons } from './BuddyAnswerButtons'

export const metadata: Metadata = {
  title: 'Trusted contact',
  robots: { index: false, follow: false },
}

export default function SafetyBuddyPage({ params }: PageProps<'/buddy/[token]'>) {
  return (
    <Suspense
      fallback={
        <AuthShell title="Trusted contact">
          <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
        </AuthShell>
      }
    >
      {params.then(({ token }) => (
        <BuddyRequest token={token} />
      ))}
    </Suspense>
  )
}

async function BuddyRequest({ token }: { token: string }) {
  const request = UUID_RE.test(token)
    ? (await (await createClient()).rpc('safety_buddy_request', { p_token: token })).data?.[0]
    : undefined

  if (!request) {
    return (
      <AuthShell title="This link doesn’t work any more">
        <p className="text-sm text-slate-600 text-center">
          The member may have changed their trusted contact, so we won&apos;t email you about their meetups. Nothing else
          to do.
        </p>
      </AuthShell>
    )
  }

  const name = request.member_name ?? 'This member'
  return (
    <AuthShell title={`${name}’s trusted contact`}>
      <div className="space-y-3 text-sm text-slate-600">
        {request.contact_name && <p>Hi {request.contact_name},</p>}
        <p>
          {name} uses Blockparty, a local marketplace where neighbours meet to buy and sell, and named you as their trusted
          contact.
        </p>
        <p>
          As their trusted contact, whenever {name} arranges to meet someone we email you where and when, and again when
          it&apos;s done or cancelled, so someone knows where they are. If you can&apos;t reach them around that time,
          check in with them. That&apos;s all: no account, no other emails, and you can stop any time.
        </p>
      </div>
      <BuddyAnswerButtons token={token} name={name} initial={request.status === 'agreed' || request.status === 'declined' ? request.status : 'pending'} />
    </AuthShell>
  )
}
