// components/auth/fields.tsx
import type { InputHTMLAttributes } from 'react'

export function TextField({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <input
        id={id}
        className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]"
        {...props}
      />
    </div>
  )
}

export function SubmitButton({ pending, disabled, children }: { pending: boolean; disabled?: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full py-3 rounded-full bg-[#0E4D5C] text-white font-bold shadow-sm hover:bg-[#093641] transition disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {pending ? 'Please wait…' : children}
    </button>
  )
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4" aria-hidden>
      <div className="flex-grow border-t border-slate-200" />
      <span className="text-xs uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex-grow border-t border-slate-200" />
    </div>
  )
}
