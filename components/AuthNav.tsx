// components/AuthNav.tsx
// Client-side so the header can stay in the static shell of every page;
// it checks the session in the browser and updates on sign-in/out.
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/app/auth/actions'
import { NotificationBell } from '@/components/NotificationBell'

type AuthState = 'loading' | 'signed-out' | { userId: string }

export function AuthNav() {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setState(data.user ? { userId: data.user.id } : 'signed-out'))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((prev) =>
        !session ? 'signed-out' : typeof prev === 'object' && prev.userId === session.user.id ? prev : { userId: session.user.id },
      )
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (state === 'loading') {
    return <span className="inline-block w-32 h-9 rounded-full bg-slate-200/70 animate-pulse" aria-hidden />
  }

  if (state === 'signed-out') {
    return (
      <div className="flex items-center gap-3">
        <Link href="/login" className="hover:text-[#F26B5B] transition">
          Sign In
        </Link>
        <Link
          href="/signup"
          className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] hover:bg-[#0E4D5C] hover:text-white transition"
        >
          Join
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <NotificationBell userId={state.userId} />
      <Link href="/dashboard" className="hover:text-[#F26B5B] transition">
        Dashboard
      </Link>
      <Link href="/profile" className="hover:text-[#F26B5B] transition">
        Profile
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] hover:bg-[#0E4D5C] hover:text-white transition"
        >
          Sign Out
        </button>
      </form>
    </div>
  )
}
