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
import { claimAnonymousHistory, rememberPath } from '@/lib/track'
import { useSellSheet } from '@/components/SellSheet'

export type NavSection = 'browse' | 'auctions' | 'charities' | 'how' | null

type Me = { userId: string; username: string | null; avatarPath: string | null }
type AuthState = 'loading' | 'signed-out' | Me

/** Fired by the profile page after the photo or name changes. */
export const PROFILE_CHANGED_EVENT = 'blockparty:profile-changed'

export function AuthNav({ active = null }: { active?: NavSection }) {
  const [state, setState] = useState<AuthState>('loading')
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    async function loadMe(uid: string | null) {
      if (!uid) return setState('signed-out')
      claimAnonymousHistory()
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
  useEffect(() => rememberPath(pathname), [pathname])
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
  const sell = useSellSheet({ onDashboard: pathname === '/dashboard' })

  // Coral bar, white labels; the current page gets a blue pill behind its icon.
  const tab = (on: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] font-semibold text-white transition active:scale-95 ${
      on ? 'font-bold' : 'text-white/85'
    }`
  const icon = (on: boolean) =>
    `flex items-center justify-center h-7 px-3 rounded-full transition ${on ? 'bg-[#0E4D5C] shadow-sm' : ''}`

  return (
    <nav
      id="mobile-tabbar"
      aria-label="Main"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#F26B5B] shadow-[0_-2px_12px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
    >
      {sell.sheet}
      <div className="flex max-w-lg mx-auto">
        <Link href="/listings" className={tab(pathname.startsWith('/listings') && !onAuctions)}>
          <span className={icon(pathname.startsWith('/listings') && !onAuctions)}>
            <Search className="w-5 h-5" />
          </span>
          Browse
        </Link>
        <Link href="/listings?type=auction" className={tab(onAuctions)}>
          <span className={icon(onAuctions)}>
            <Gavel className="w-5 h-5" />
          </span>
          Auctions
        </Link>
        {state === 'loading' ? (
          // Don't flash "Sign in" while the session is being checked.
          <span className="flex-[3]" aria-hidden />
        ) : signedIn ? (
          <>
            {/* Opens the new-listing sheet (or the payout prompt) right here, on any page. */}
            <button type="button" onClick={sell.open} className={tab(false)}>
              <span className="w-12 h-12 -mt-6 rounded-full bg-[#0E4D5C] text-white flex items-center justify-center shadow-lg ring-4 ring-[#F26B5B] transition active:scale-90 active:shadow-md">
                <PlusCircle className="w-6 h-6" />
              </span>
              Sell
            </button>
            <Link href="/dashboard" className={tab(pathname === '/dashboard')}>
              <span className={icon(pathname === '/dashboard')}>
                <LayoutGrid className="w-5 h-5" />
              </span>
              Dashboard
            </Link>
            <Link href="/profile" className={tab(pathname === '/profile')}>
              <span className={icon(pathname === '/profile')}>
                <Avatar
                  path={state.avatarPath}
                  name={state.username}
                  size="xs"
                  className={pathname === '/profile' ? 'ring-2 ring-white' : 'ring-1 ring-white/70'}
                />
              </span>
              Me
            </Link>
          </>
        ) : (
          <>
            <Link href="/charities" className={tab(active === 'charities')}>
              <span className={icon(active === 'charities')}>
                <HeartHandshake className="w-5 h-5" />
              </span>
              Charities
            </Link>
            <Link href="/login" className={tab(pathname === '/login')}>
              <span className={icon(pathname === '/login')}>
                <LogIn className="w-5 h-5" />
              </span>
              Sign in
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
