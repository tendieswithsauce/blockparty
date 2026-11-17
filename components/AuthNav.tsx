// components/AuthNav.tsx
// Account controls for the header. Client-side so the header can stay in the
// static shell of every page; it checks the session in the browser and
// updates on sign-in/out. Renders three pieces:
//   - desktop (md and up): bell, Dashboard, Admin, avatar (profile), Sign Out
//   - mobile top bar: bell (or Sign in)
//   - mobile bottom tab bar: Browse, Auctions, Sell, Dashboard, Me
'use client'

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Gavel, LayoutGrid, LogIn, PlusCircle, Search, HeartHandshake } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/app/auth/actions'
import { NotificationBell } from '@/components/NotificationBell'
import { Avatar } from '@/components/Avatar'

export type NavSection = 'browse' | 'auctions' | 'charities' | 'how' | null

type Me = { userId: string; username: string | null; avatarPath: string | null }
type AuthState = 'loading' | 'signed-out' | Me

/** Fired by the profile page after the photo or name changes. */
export const PROFILE_CHANGED_EVENT = 'blockparty:profile-changed'
/** Fired by the Sell tab when the dashboard is already open. */
export const SELL_EVENT = 'blockparty:sell'

export function AuthNav({ active = null }: { active?: NavSection }) {
  const [state, setState] = useState<AuthState>('loading')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    async function loadMe(uid: string | null) {
      if (!uid) return setState('signed-out')
      const { data } = await supabase.from('profiles').select('username, avatar_path').eq('id', uid).maybeSingle()
      if (!cancelled) setState({ userId: uid, username: data?.username ?? null, avatarPath: data?.avatar_path ?? null })
    }
    supabase.auth.getUser().then(({ data }) => loadMe(data.user?.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null
      setState((prev) => {
        if (!uid) return 'signed-out'
        if (typeof prev === 'object' && prev.userId === uid) return prev
        loadMe(uid)
        return prev
      })
    })
    const onProfileChanged = () => {
      supabase.auth.getUser().then(({ data }) => loadMe(data.user?.id ?? null))
    }
    window.addEventListener(PROFILE_CHANGED_EVENT, onProfileChanged)
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      window.removeEventListener(PROFILE_CHANGED_EVENT, onProfileChanged)
    }
  }, [])

  const userId = typeof state === 'object' ? state.userId : null
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    createClient()
      .rpc('is_admin')
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(!!data)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  return (
    <>
      <div className="hidden md:flex items-center text-sm font-semibold text-[#1E293B]">
        <DesktopAccount state={state} isAdmin={isAdmin} />
      </div>
      <div className="md:hidden flex items-center gap-2 text-sm font-semibold text-[#1E293B]">
        {state === 'loading' ? (
          <span className="inline-block w-9 h-9 rounded-full bg-slate-200/70 animate-pulse" aria-hidden />
        ) : state === 'signed-out' ? (
          <Link href="/signup" className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C]">
            Join
          </Link>
        ) : (
          <NotificationBell userId={state.userId} />
        )}
      </div>
      {/* The current path is only known at request time; the fallback is the same bar with nothing highlighted. */}
      <Suspense fallback={<TabBar state={state} active={active} pathname="" search="" />}>
        <MobileTabBar state={state} active={active} />
      </Suspense>
    </>
  )
}

function DesktopAccount({ state, isAdmin }: { state: AuthState; isAdmin: boolean }) {
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
      {isAdmin && (
        <Link href="/admin" className="hover:text-[#F26B5B] transition">
          Admin
        </Link>
      )}
      <Link
        href="/profile"
        title="Your profile"
        aria-label="Your profile"
        className="rounded-full ring-2 ring-transparent hover:ring-[#F26B5B] transition"
      >
        <Avatar path={state.avatarPath} name={state.username} size="md" />
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

/** Thumb-reachable navigation on phones. */
function MobileTabBar({ state, active }: { state: AuthState; active: NavSection }) {
  const pathname = usePathname()
  // Re-read on every render (route changes re-render this), and on back/forward.
  const search = useSyncExternalStore(
    (onChange) => {
      window.addEventListener('popstate', onChange)
      return () => window.removeEventListener('popstate', onChange)
    },
    () => window.location.search,
    () => '',
  )
  return <TabBar state={state} active={active} pathname={pathname} search={search} />
}

function TabBar({ state, active, pathname, search }: { state: AuthState; active: NavSection; pathname: string; search: string }) {
  const signedIn = typeof state === 'object'
  const onAuctions = pathname === '/listings' && new URLSearchParams(search).get('type') === 'auction'

  const tab = (on: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-semibold ${
      on ? 'text-[#F26B5B]' : 'text-slate-500 active:text-[#0E4D5C]'
    }`

  return (
    <nav
      id="mobile-tabbar"
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex max-w-lg mx-auto">
        <Link href="/listings" className={tab(pathname.startsWith('/listings') && !onAuctions)}>
          <Search className="w-6 h-6" />
          Browse
        </Link>
        <Link href="/listings?type=auction" className={tab(onAuctions)}>
          <Gavel className="w-6 h-6" />
          Auctions
        </Link>
        {state === 'loading' ? (
          // Don't flash "Sign in" while the session is being checked.
          <span className="flex-[3]" aria-hidden />
        ) : signedIn ? (
          <>
            <Link
              href="/dashboard?sell=1"
              onClick={(e) => {
                if (pathname === '/dashboard') {
                  e.preventDefault()
                  window.dispatchEvent(new Event(SELL_EVENT))
                }
              }}
              className={tab(false)}
            >
              <span className="w-11 h-11 -mt-5 rounded-full bg-[#F26B5B] text-white flex items-center justify-center shadow-md ring-4 ring-white">
                <PlusCircle className="w-6 h-6" />
              </span>
              Sell
            </Link>
            <Link href="/dashboard" className={tab(pathname === '/dashboard')}>
              <LayoutGrid className="w-6 h-6" />
              Dashboard
            </Link>
            <Link href="/profile" className={tab(pathname === '/profile')}>
              <Avatar
                path={state.avatarPath}
                name={state.username}
                size="xs"
                className={pathname === '/profile' ? 'ring-2 ring-[#F26B5B]' : ''}
              />
              Me
            </Link>
          </>
        ) : (
          <>
            <Link href="/charities" className={tab(active === 'charities')}>
              <HeartHandshake className="w-6 h-6" />
              Charities
            </Link>
            <Link href="/login" className={tab(pathname === '/login')}>
              <LogIn className="w-6 h-6" />
              Sign in
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
