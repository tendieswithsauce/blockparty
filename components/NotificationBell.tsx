// components/NotificationBell.tsx
// Header bell: unread count, a dropdown of recent notifications, live
// updates over Supabase Realtime. Notifications are created by the database
// (see 20261117010000_notifications_watchlist.sql).
'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Notification = {
  id: number
  kind: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

const COLUMNS = 'id, kind, title, body, link, read_at, created_at'
const LIMIT = 20

function timeAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function NotificationBell({ userId }: { userId: string }) {
  const router = useRouter()
  const channelId = useId()
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = items.filter((n) => !n.read_at).length

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    supabase
      .from('notifications')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(LIMIT)
      .then(({ data }) => {
        if (!cancelled && data) setItems(data)
      })

    // Inserts are new notifications; updates are bumped "outbid"/"new bid"
    // notices or reads from another tab.
    const upsert = (row: Notification) =>
      setItems((prev) =>
        [row, ...prev.filter((n) => n.id !== row.id)]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, LIMIT),
      )
    const channel = supabase
      .channel(`notifications-${userId}-${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => upsert(payload.new as Notification),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => upsert(payload.new as Notification),
      )
      .subscribe()
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [userId, channelId])

  // "5m ago" labels: refresh the clock while the panel is open.
  useEffect(() => {
    if (!open) return
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [open])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const markRead = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return
    const readAt = new Date().toISOString()
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? readAt } : n)))
    await createClient().from('notifications').update({ read_at: readAt }).in('id', ids).is('read_at', null)
  }, [])

  const openItem = (n: Notification) => {
    if (!n.read_at) void markRead([n.id])
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-full text-[#0E4D5C] hover:bg-[#0E4D5C]/10 transition"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#F26B5B] text-white text-[11px] font-bold leading-[18px] text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="font-bold text-[#1E293B]">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead(items.filter((n) => !n.read_at).map((n) => n.id))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0E4D5C] hover:text-[#F26B5B]"
              >
                <CheckCheck className="w-4 h-4" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-500 text-center">
              Nothing yet. We&apos;ll let you know about bids, sales and meetups here.
            </p>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto divide-y divide-slate-100">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition flex gap-3 ${n.read_at ? '' : 'bg-[#F26B5B]/5'}`}
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-[#F26B5B]'}`}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#1E293B]">{n.title}</span>
                      {n.body && <span className="block text-sm text-slate-600 mt-0.5">{n.body}</span>}
                      <span className="block text-xs text-slate-400 mt-1">{now ? timeAgo(n.created_at, now) : ' '}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
