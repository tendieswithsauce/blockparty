// components/FeedbackWidget.tsx
// Tester feedback: a "Feedback" button on every page of the dev site (and
// local development). Testers pick a type, write a note, and send it; the
// page, screen size and browser are attached. Saved to tester_feedback
// through submit_feedback(); admins read them on the admin page.
// Shows when: Vercel preview deployments (NEXT_PUBLIC_VERCEL_ENV=preview),
// `next dev`, or NEXT_PUBLIC_FEEDBACK_WIDGET=on (e.g. for alpha on the live site).
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bug, HelpCircle, Lightbulb, MessageSquarePlus, MoreHorizontal, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const ENV = process.env.NEXT_PUBLIC_VERCEL_ENV ?? (process.env.NODE_ENV === 'development' ? 'development' : 'production')
const ENABLED = process.env.NEXT_PUBLIC_FEEDBACK_WIDGET === 'on' || ENV === 'preview' || ENV === 'development'

type Category = 'bug' | 'idea' | 'question' | 'other'
const CATEGORIES: { value: Category; label: string; icon: typeof Bug }[] = [
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'idea', label: 'Idea', icon: Lightbulb },
  { value: 'question', label: 'Question', icon: HelpCircle },
  { value: 'other', label: 'Other', icon: MoreHorizontal },
]

export function FeedbackWidget() {
  const pathname = usePathname()
  // Not on the password wall (lib/site-gate.ts).
  if (!ENABLED || pathname === '/gate') return null
  return <Widget />
}

function Widget() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category>('bug')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) textRef.current?.focus()
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!message.trim()) return setError('Write a little about it.')
    setSending(true)
    const { error: rpcError } = await createClient().rpc('submit_feedback', {
      p_category: category,
      p_message: message,
      // Path only: query strings can carry one-time codes from email links.
      p_page_path: pathname,
      p_viewport: `${window.innerWidth}x${window.innerHeight}`,
      p_user_agent: navigator.userAgent.slice(0, 300),
      p_environment: ENV,
    })
    setSending(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    setMessage('')
    setSent(true)
  }

  function close() {
    setOpen(false)
    setSent(false)
    setError('')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="feedback-panel"
        className="fixed z-40 right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-5 md:right-5 inline-flex items-center gap-1.5 rounded-full bg-[#F4A261] text-[#1E293B] px-3.5 py-2 text-sm font-bold shadow-lg ring-2 ring-white"
      >
        <MessageSquarePlus className="w-4 h-4" aria-hidden /> Feedback
      </button>

      {open && (
        <div
          id="feedback-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Send feedback"
          className="fixed z-50 inset-x-3 bottom-[calc(8rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-5 md:bottom-20 md:w-96 bg-white border rounded-2xl shadow-2xl p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-bold text-[#0E4D5C]">Send feedback</p>
              <p className="text-xs text-slate-500">Testing notes go straight to the Blockparty team.</p>
            </div>
            <button type="button" onClick={close} aria-label="Close feedback" className="p-1 rounded-full text-slate-500 hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>
          </div>

          {sent ? (
            <div className="space-y-3 text-sm">
              <p className="rounded-xl bg-emerald-50 text-emerald-800 p-3">Thanks! Your feedback was sent.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSent(false)} className="flex-1 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold">
                  Send another
                </button>
                <button type="button" onClick={close} className="flex-1 py-2 rounded-full bg-[#0E4D5C] text-white font-bold">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-3">
              <fieldset>
                <legend className="sr-only">Type of feedback</legend>
                <div className="grid grid-cols-4 gap-1.5">
                  {CATEGORIES.map(({ value, label, icon: Icon }) => (
                    <label
                      key={value}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs font-semibold cursor-pointer ${
                        category === value ? 'border-[#0E4D5C] bg-[#0E4D5C]/5 text-[#0E4D5C]' : 'text-slate-600'
                      }`}
                    >
                      <input
                        type="radio"
                        name="feedback-category"
                        value={value}
                        checked={category === value}
                        onChange={() => setCategory(value)}
                        className="sr-only"
                      />
                      <Icon className="w-4 h-4" aria-hidden />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block">
                <span className="sr-only">Your feedback</span>
                <textarea
                  ref={textRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder={
                    category === 'bug'
                      ? 'What happened, and what did you expect?'
                      : category === 'idea'
                        ? 'What would make this better?'
                        : 'Tell us…'
                  }
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
                />
              </label>
              <p className="text-xs text-slate-500">
                We&apos;ll include this page ({pathname}), your screen size and browser.
              </p>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={sending}
                className="w-full py-2.5 rounded-full bg-[#0E4D5C] text-white font-bold disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send feedback'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  )
}
