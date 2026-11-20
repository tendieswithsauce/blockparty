// components/admin/TesterFeedback.tsx
// Admin page: feedback sent with the dev site's Feedback button
// (components/FeedbackWidget.tsx), newest first, open items before done ones.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bug, HelpCircle, Lightbulb, MessageSquarePlus, MoreHorizontal } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Functions']['admin_feedback']['Returns'][number]

const ICONS = { bug: Bug, idea: Lightbulb, question: HelpCircle, other: MoreHorizontal } as const
const LABELS = { bug: 'Bug', idea: 'Idea', question: 'Question', other: 'Other' } as const

export function TesterFeedback() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('admin_feedback')
    setRows(data ?? [])
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  const open = rows?.filter((r) => r.status === 'new') ?? []
  const done = rows?.filter((r) => r.status === 'done') ?? []
  const shown = showDone ? [...open, ...done] : open

  return (
    <section className="bg-white border rounded-2xl p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
        <MessageSquarePlus className="w-5 h-5 text-[#F4A261]" /> Tester feedback ({open.length} open)
      </h2>
      <p className="text-sm text-slate-500 mb-4">
        Sent with the Feedback button on the dev site. Also in Supabase, table <code>tester_feedback</code>.
      </p>
      {rows === null ? (
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing new.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <FeedbackItem key={r.id} r={r} onDone={load} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <button type="button" onClick={() => setShowDone((s) => !s)} className="mt-4 text-sm font-semibold text-[#0E4D5C] underline">
          {showDone ? 'Hide done' : `Show done (${done.length})`}
        </button>
      )}
    </section>
  )
}

function FeedbackItem({ r, onDone }: { r: Row; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const Icon = ICONS[r.category]
  const when = new Date(r.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  async function setStatus(status: 'new' | 'done') {
    setBusy(true)
    await createClient().rpc('admin_set_feedback_status', { p_id: r.id, p_status: status })
    setBusy(false)
    onDone()
  }

  return (
    <li className={`border rounded-xl p-4 text-sm space-y-2 ${r.status === 'done' ? 'opacity-60' : ''}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F4A261]/20 text-[#1E293B] text-xs font-bold">
          <Icon className="w-3.5 h-3.5" /> {LABELS[r.category]}
        </span>
        <span className="text-slate-500">
          {r.username ?? 'Signed out'} · {when}
          {r.page_path && (
            <>
              {' · '}
              <Link href={r.page_path} className="underline" target="_blank">
                {r.page_path}
              </Link>
            </>
          )}
        </span>
      </p>
      <p className="whitespace-pre-line text-slate-800">{r.message}</p>
      <p className="text-xs text-slate-400">
        {[r.viewport, r.environment, r.user_agent].filter(Boolean).join(' · ')}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => setStatus(r.status === 'done' ? 'new' : 'done')}
        className="px-3 py-1.5 rounded-full text-xs font-semibold border text-slate-600 disabled:opacity-60"
      >
        {r.status === 'done' ? 'Reopen' : 'Mark done'}
      </button>
    </li>
  )
}
