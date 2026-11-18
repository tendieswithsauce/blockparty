// components/listing/ListingQuestions.tsx
// Public Q&A on a listing. Anyone can read answered questions; signed-in
// buyers ask, and the seller answers publicly. Askers and the seller also
// see questions still waiting for an answer.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageCircleQuestion } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ReportDialog, type ReportTarget } from '@/components/ReportDialog'
import type { Database } from '@/lib/supabase/database.types'

type Question = Database['public']['Functions']['listing_questions_for']['Returns'][number]

function when(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

export function ListingQuestions({ listingId, sellerId, open }: { listingId: number; sellerId: string; open: boolean }) {
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ReportTarget | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: auth }, { data }] = await Promise.all([
      supabase.auth.getUser().catch(() => ({ data: { user: null } })),
      supabase.rpc('listing_questions_for', { p_listing_id: listingId }),
    ])
    setUserId(auth.user?.id ?? null)
    setQuestions(data ?? [])
  }, [listingId])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  const isSeller = !!userId && userId === sellerId

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (draft.trim().length < 5) return setError('Write a little more.')
    setBusy(true)
    const { error: rpcError } = await createClient().rpc('ask_question', { p_listing_id: listingId, p_question: draft })
    setBusy(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    setDraft('')
    load()
  }

  const answered = questions?.filter((q) => q.answer) ?? []
  const waiting = questions?.filter((q) => !q.answer) ?? []

  return (
    <section id="questions" className="scroll-mt-24 space-y-4">
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
      <h2 className="font-bold flex items-center gap-2">
        <MessageCircleQuestion className="w-5 h-5 text-[#0E4D5C]" /> Questions{answered.length > 0 && ` (${answered.length})`}
      </h2>

      {questions === null ? (
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
      ) : (
        <>
          {isSeller && waiting.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-amber-800">
                {waiting.length} {waiting.length === 1 ? 'question needs' : 'questions need'} your answer. Answers are public.
              </p>
              {waiting.map((q) => (
                <AnswerForm key={q.id} question={q} onDone={load} />
              ))}
            </div>
          )}

          {!isSeller &&
            waiting.map((q) => (
              <div key={q.id} className="rounded-xl border border-dashed p-3 text-sm">
                <p className="font-medium">{q.question}</p>
                <p className="text-slate-500 mt-1 flex items-center justify-between gap-2">
                  <span>Waiting for the seller to answer. Only you can see this for now.</span>
                  <RemoveButton id={q.id} label="Withdraw" onDone={load} />
                </p>
              </div>
            ))}

          {answered.length === 0 && waiting.length === 0 && (
            <p className="text-sm text-slate-500">No questions yet.</p>
          )}

          <ul className="space-y-3">
            {answered.map((q) => (
              <li key={q.id} className="rounded-xl bg-white border p-4 text-sm space-y-2">
                <p>
                  <span className="font-bold text-[#0E4D5C]">Q </span>
                  <span className="font-medium">{q.question}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">
                    {q.mine ? 'You' : q.asker_name} · {when(q.created_at)}
                  </span>
                </p>
                <p className="pl-4 border-l-2 border-[#F4A261]">
                  <span className="font-bold text-[#F26B5B]">A </span>
                  <span className="whitespace-pre-line">{q.answer}</span>
                </p>
                {(isSeller || (userId && !q.mine)) && (
                  <div className="flex gap-4 text-xs">
                    {isSeller && <RemoveButton id={q.id} label="Remove" onDone={load} />}
                    {!q.mine && (
                      <button
                        type="button"
                        onClick={() => setReport({ type: 'question', questionId: q.id, label: 'this question' })}
                        className="text-slate-500 hover:text-red-600 underline"
                      >
                        Report
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {open && !isSeller && userId !== undefined && (
            userId === null ? (
              <p className="text-sm">
                <Link href={`/login?next=${encodeURIComponent(`/listings/${listingId}#questions`)}`} className="font-semibold text-[#0E4D5C] underline">
                  Sign in
                </Link>{' '}
                to ask the seller a question.
              </p>
            ) : (
              <form onSubmit={ask} className="space-y-2">
                <label htmlFor="ask-question" className="text-sm font-semibold">
                  Ask the seller
                </label>
                <textarea
                  id="ask-question"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="e.g. Does it come with the charger?"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
                />
                <p className="text-xs text-slate-500">
                  The question and answer are public. Don&apos;t share contact details: arrange everything through Blockparty.
                </p>
                {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2.5 rounded-full bg-[#0E4D5C] text-white text-sm font-bold disabled:opacity-60"
                >
                  {busy ? 'Sending…' : 'Ask question'}
                </button>
              </form>
            )
          )}
        </>
      )}
    </section>
  )
}

function AnswerForm({ question, onDone }: { question: Question; onDone: () => void }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!answer.trim()) return setError('Write an answer.')
    setBusy(true)
    const { error: rpcError } = await createClient().rpc('answer_question', { p_question_id: question.id, p_answer: answer })
    setBusy(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong.')
    onDone()
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2 text-sm">
      <p>
        <span className="font-medium">{question.question}</span>
        <span className="block text-xs text-slate-500">
          {question.asker_name} · {when(question.created_at)}
        </span>
      </p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder="Your answer (everyone will see it)"
        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
      />
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex items-center gap-4">
        <button type="submit" disabled={busy} className="px-4 py-2 rounded-full bg-[#0E4D5C] text-white font-bold disabled:opacity-60">
          {busy ? 'Posting…' : 'Post answer'}
        </button>
        <RemoveButton id={question.id} label="Delete question" onDone={onDone} />
      </div>
    </form>
  )
}

function RemoveButton({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await createClient().rpc('remove_question', { p_question_id: id })
        setBusy(false)
        onDone()
      }}
      className="text-slate-500 hover:text-red-600 underline shrink-0"
    >
      {busy ? '…' : label}
    </button>
  )
}
