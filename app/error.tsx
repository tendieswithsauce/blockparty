// app/error.tsx
// Friendly fallback when a page crashes, instead of a blank screen. The
// error is reported (lib/report-error.ts); "Try again" re-renders the page.
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { reportClientError } from '@/lib/report-error'

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined

  useEffect(() => {
    reportClientError('error-boundary', error, { digest })
  }, [error, digest])

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-6 py-16 bg-[#FAF8F5]">
      <div className="max-w-md w-full bg-white border rounded-2xl p-8 shadow-sm text-center space-y-4">
        <h1 className="text-2xl font-extrabold text-[#0E4D5C]">Something went wrong</h1>
        <p className="text-slate-600">
          Sorry, this page hit a problem. We&apos;ve been told about it. You can try again, or head back to Browse.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => retry()}
            className="px-5 py-2.5 rounded-full bg-[#0E4D5C] text-white font-bold"
          >
            Try again
          </button>
          <Link href="/listings" className="px-5 py-2.5 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-bold">
            Browse
          </Link>
        </div>
        {digest && <p className="text-xs text-slate-400">Reference: {digest}</p>}
      </div>
    </main>
  )
}
