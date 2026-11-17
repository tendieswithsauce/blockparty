// components/orders/OrderChat.tsx
// Messages between buyer and seller on an open order, live over Realtime.
// Around the meetup time it adds one-tap "I'm here" / "Running late".
// Sending goes through send_order_message(), which also notifies the other
// side and refuses the buyer's handoff code.
'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPinCheck, MessageCircle, Send, Timer } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Message = {
  id: number
  sender_id: string
  kind: string
  body: string
  created_at: string
}

// Show the quick buttons from 2 hours before the meetup to 2 hours after.
const QUICK_WINDOW_MS = 2 * 60 * 60 * 1000

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function OrderChat({
  orderId,
  userId,
  other,
  meetupAt,
  now,
}: {
  orderId: number
  userId: string
  other: string
  meetupAt: string | null
  now: number | null
}) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    supabase
      .from('order_messages')
      .select('id, sender_id, kind, body, created_at')
      .eq('transaction_id', orderId)
      .order('created_at')
      .limit(200)
      .then(({ data }) => {
        if (!cancelled) setMessages(data ?? [])
      })
    const channel = supabase
      .channel(`order-messages-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `transaction_id=eq.${orderId}` },
        (payload) => {
          const m = payload.new as Message
          setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev))
        },
      )
      .subscribe()
    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [orderId])

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages?.length])

  async function send(body: string, kind: 'text' | 'here' | 'late' = 'text') {
    setError('')
    if (!body.trim()) return
    setSending(true)
    const { data, error: rpcError } = await createClient().rpc('send_order_message', {
      p_transaction_id: orderId,
      p_body: body,
      p_kind: kind,
    })
    setSending(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : "Couldn't send. Try again.")
    if (kind === 'text') setDraft('')
    if (data) setMessages((prev) => (prev && !prev.some((x) => x.id === data.id) ? [...prev, data] : prev))
  }

  const meetupMs = meetupAt ? new Date(meetupAt).getTime() : null
  const showQuick = meetupMs !== null && now !== null && Math.abs(now - meetupMs) <= QUICK_WINDOW_MS

  return (
    <section className="bg-white border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-3">
        <p className="flex items-center gap-2 font-bold">
          <MessageCircle className="w-5 h-5 text-[#0E4D5C]" /> Messages with {other}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Keep payment on Blockparty. Don&apos;t share your handoff code here; show it in person after checking the item.
        </p>
      </div>

      <div ref={listRef} className="px-6 max-h-80 overflow-y-auto space-y-2 pb-3">
        {messages === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-400">No messages yet. Say hi, or ask a question about the item or the meetup.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === userId
            const quick = m.kind === 'here' || m.kind === 'late'
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    quick
                      ? 'bg-[#F4A261]/20 text-[#1E293B] font-semibold'
                      : mine
                        ? 'bg-[#0E4D5C] text-white'
                        : 'bg-slate-100 text-[#1E293B]'
                  }`}
                >
                  <p className="whitespace-pre-line break-words">
                    {m.kind === 'here' && <MapPinCheck className="inline w-4 h-4 mr-1 -mt-0.5" />}
                    {m.kind === 'late' && <Timer className="inline w-4 h-4 mr-1 -mt-0.5" />}
                    {quick && !mine ? `${other}: ` : ''}
                    {m.body}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${mine && !quick ? 'text-white/70' : 'text-slate-500'}`}>{timeLabel(m.created_at)}</p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {showQuick && (
        <div className="px-6 pb-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={() => send("I'm here", 'here')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0E4D5C] text-white text-sm font-semibold disabled:opacity-60"
          >
            <MapPinCheck className="w-4 h-4" /> I&apos;m here
          </button>
          {[5, 15].map((min) => (
            <button
              key={min}
              type="button"
              disabled={sending}
              onClick={() => send(`Running about ${min} minutes late`, 'late')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold disabled:opacity-60"
            >
              <Timer className="w-4 h-4" /> {min} min late
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
        className="border-t flex items-end gap-2 p-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(draft)
            }
          }}
          maxLength={1000}
          rows={1}
          placeholder={`Message ${other}`}
          aria-label={`Message ${other}`}
          className="flex-1 resize-none border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="p-2.5 rounded-full bg-[#F26B5B] text-white disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
      {error && <p className="px-6 pb-3 text-sm text-red-600">{error}</p>}
    </section>
  )
}
