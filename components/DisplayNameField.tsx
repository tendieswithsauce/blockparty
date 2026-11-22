// components/DisplayNameField.tsx
// Display name input with a "random name" button and a live availability
// check (check_username in the database: format, reserved words, taken).
'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Dices, Loader2, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export type NameStatus = 'idle' | 'checking' | 'ok' | 'bad'

export function DisplayNameField({
  id = 'display_name',
  // Not called "username": browsers treat a field with that name as the login
  // username and autofill an email address into it.
  name = 'display_name',
  value,
  onChange,
  onStatus,
  generateInitial = false,
  original,
  disabled,
  inputClassName,
}: {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  onStatus?: (status: NameStatus) => void
  /** Fill in a random name on mount (sign-up). */
  generateInitial?: boolean
  /** The user's current name: shown as fine without a check. */
  original?: string
  disabled?: boolean
  inputClassName?: string
}) {
  const [status, setStatus] = useState<NameStatus>('idle')
  const [message, setMessage] = useState('')
  const [rolling, setRolling] = useState(false)
  const latest = useRef(value)

  async function roll() {
    setRolling(true)
    const { data } = await createClient().rpc('generate_username')
    setRolling(false)
    if (data) onChange(data)
  }

  useEffect(() => {
    if (!generateInitial) return
    let cancelled = false
    createClient()
      .rpc('generate_username')
      .then(({ data }) => {
        if (!cancelled && data) onChange(data)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  // Debounced availability check.
  useEffect(() => {
    latest.current = value
    const report = (s: NameStatus, m = '') => {
      setStatus(s)
      setMessage(m)
      onStatus?.(s)
    }
    if (!value || value === original) {
      const t = setTimeout(() => report('idle'), 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(async () => {
      report('checking')
      const { data, error } = await createClient().rpc('check_username', { p_name: value })
      if (latest.current !== value) return
      if (error) report('bad', 'Could not check that name. Try again.')
      else if (data) report('bad', data)
      else report('ok', 'Available')
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStatus is a callback prop
  }, [value, original])

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        Display name
      </label>
      <div className="mt-1 flex gap-2">
        <div className="relative flex-1">
          <input
            id={id}
            name={name}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            // A public nickname, never a login: keep password managers and autofill out.
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            autoCapitalize="off"
            spellCheck={false}
            disabled={disabled}
            aria-describedby={`${id}-hint`}
            aria-invalid={status === 'bad'}
            className={
              inputClassName ??
              'w-full px-3 py-2.5 pr-9 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'
            }
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden>
            {status === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
            {status === 'ok' && <Check className="w-4 h-4 text-emerald-600" />}
            {status === 'bad' && <X className="w-4 h-4 text-red-600" />}
          </span>
        </div>
        <button
          type="button"
          onClick={roll}
          disabled={disabled || rolling}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 rounded-xl border border-slate-300 text-sm font-semibold text-[#0E4D5C] hover:bg-slate-50 disabled:opacity-60"
          title="Suggest a random name"
        >
          <Dices className="w-4 h-4" /> Random
        </button>
      </div>
      <p id={`${id}-hint`} aria-live="polite" className={`mt-1 text-xs ${status === 'bad' ? 'text-red-600' : status === 'ok' ? 'text-emerald-700' : 'text-slate-500'}`}>
        {status === 'bad' || status === 'ok'
          ? message
          : 'Shown publicly instead of your real name. 3–20 letters, numbers or underscores.'}
      </p>
    </div>
  )
}
