'use client'
// Agree / No thanks, then Stop or change your mind.
import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { answerSafetyBuddy } from './actions'

type Status = 'pending' | 'agreed' | 'declined'

export function BuddyAnswerButtons({ token, name, initial }: { token: string; name: string; initial: Status }) {
  const [status, setStatus] = useState<Status>(initial)
  const [busy, setBusy] = useState<boolean | null>(null)
  const [error, setError] = useState('')

  async function answer(agree: boolean) {
    setError('')
    setBusy(agree)
    const result = await answerSafetyBuddy(token, agree).catch(() => ({
      ok: false as const,
      error: 'Something went wrong. Please try again.',
    }))
    setBusy(null)
    if (!result.ok) return setError(result.error)
    setStatus(result.status)
  }

  const primary =
    'w-full rounded-full bg-[#F26B5B] px-5 py-3 font-bold text-white hover:bg-[#e05a4a] disabled:opacity-60'
  const secondary =
    'w-full rounded-full border-2 border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60'

  return (
    <div className="space-y-3">
      {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {status === 'pending' && (
        <>
          <button type="button" disabled={busy !== null} onClick={() => answer(true)} className={primary}>
            {busy === true ? 'Saving…' : `I agree to be ${name}’s trusted contact`}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => answer(false)} className={secondary}>
            {busy === false ? 'Saving…' : 'No thanks'}
          </button>
          <p className="text-center text-xs text-slate-500">Don&apos;t know {name}? Tap No thanks and you won&apos;t hear about their meetups.</p>
        </>
      )}
      {status === 'agreed' && (
        <>
          <p className="flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> You&apos;re {name}&apos;s trusted contact. We&apos;ve let them know.
          </p>
          <button type="button" disabled={busy !== null} onClick={() => answer(false)} className={secondary}>
            {busy === false ? 'Saving…' : 'Stop getting these emails'}
          </button>
        </>
      )}
      {status === 'declined' && (
        <>
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            You won&apos;t get emails about {name}&apos;s meetups. We&apos;ve let them know.
          </p>
          <button type="button" disabled={busy !== null} onClick={() => answer(true)} className={secondary}>
            {busy === true ? 'Saving…' : `Changed your mind? Be ${name}’s trusted contact`}
          </button>
        </>
      )}
    </div>
  )
}
