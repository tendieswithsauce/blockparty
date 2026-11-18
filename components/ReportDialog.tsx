// components/ReportDialog.tsx
// Report a listing, a member or a Q&A question to Blockparty staff.
'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export type ReportTarget =
  | { type: 'listing'; listingId: number; label: string }
  | { type: 'user'; userId: string; label: string }
  | { type: 'question'; questionId: number; label: string }

const REASONS: Record<ReportTarget['type'], [string, string][]> = {
  listing: [
    ['prohibited', 'Prohibited or illegal item'],
    ['scam', 'Scam or fraud'],
    ['misleading', 'Misleading or fake listing'],
    ['offensive', 'Offensive content'],
    ['off_platform', 'Asks to pay or talk outside Blockparty'],
    ['spam', 'Spam'],
    ['other', 'Something else'],
  ],
  user: [
    ['harassment', 'Harassment or threats'],
    ['scam', 'Scam or fraud'],
    ['no_show', "Didn't show up / unreliable"],
    ['off_platform', 'Asked to pay or talk outside Blockparty'],
    ['offensive', 'Offensive behaviour'],
    ['other', 'Something else'],
  ],
  question: [
    ['harassment', 'Harassment or threats'],
    ['offensive', 'Offensive content'],
    ['off_platform', 'Asks to pay or talk outside Blockparty'],
    ['spam', 'Spam'],
    ['other', 'Something else'],
  ],
}

export function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit() {
    setError('')
    if (!reason) return setError('Choose a reason.')
    if (reason === 'other' && !details.trim()) return setError("Tell us what's wrong.")
    setBusy(true)
    const { error: rpcError } = await createClient().rpc('report_content', {
      p_target_type: target.type,
      p_reason: reason,
      p_details: details.trim() || null,
      p_listing_id: target.type === 'listing' ? target.listingId : null,
      p_user_id: target.type === 'user' ? target.userId : null,
      p_question_id: target.type === 'question' ? target.questionId : null,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    setSent(true)
  }

  if (sent) {
    return (
      <ConfirmDialog title="Thanks for letting us know" confirmLabel="Done" onConfirm={onClose} onCancel={onClose} hideCancel>
        <p>
          Blockparty staff will look into it. We&apos;ll let you know when it&apos;s been dealt with. The person you reported
          won&apos;t find out who reported them.
        </p>
        <p>If you don&apos;t want to deal with them again, you can also block them.</p>
      </ConfirmDialog>
    )
  }

  return (
    <ConfirmDialog
      title={`Report ${target.label}`}
      confirmLabel="Send report"
      busyLabel="Sending…"
      busy={busy}
      error={error}
      onConfirm={submit}
      onCancel={onClose}
    >
      <fieldset className="space-y-1.5">
        <legend className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
          <Flag className="w-4 h-4 text-red-600" /> What&apos;s wrong?
        </legend>
        {REASONS[target.type].map(([value, label]) => (
          <label key={value} className="flex items-center gap-3 py-1.5 cursor-pointer">
            <input type="radio" name="reason" className="w-4 h-4" checked={reason === value} onChange={() => setReason(value)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="font-semibold text-slate-700">
          Details <span className="font-normal text-slate-500">({reason === 'other' ? 'required' : 'optional'})</span>
        </span>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1 w-full border border-slate-300 rounded-xl px-3 py-2 text-base"
        />
      </label>
      <p className="text-xs text-slate-500">If someone is in danger, call 911 first.</p>
    </ConfirmDialog>
  )
}
