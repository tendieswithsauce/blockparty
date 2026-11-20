// app/global-error.tsx
// Last-resort fallback when the root layout itself fails. It replaces the
// whole document, so it brings its own <html>/<body> and inline styles.
'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-error'

export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined

  useEffect(() => {
    reportClientError('global-error', error, { digest })
  }, [error, digest])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Arial, Helvetica, sans-serif', background: '#FAF8F5', color: '#1E293B' }}>
        <title>Something went wrong · Blockparty</title>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, margin: '0 0 12px', color: '#0E4D5C' }}>Something went wrong</h1>
            <p style={{ margin: '0 0 20px', color: '#475569', lineHeight: 1.5 }}>
              Sorry, Blockparty hit a problem. We&apos;ve been told about it. Please try again.
            </p>
            <button
              type="button"
              onClick={() => retry()}
              style={{ padding: '10px 20px', borderRadius: 999, border: 0, background: '#0E4D5C', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
            >
              Try again
            </button>
            {digest && <p style={{ marginTop: 16, fontSize: 12, color: '#94A3B8' }}>Reference: {digest}</p>}
          </div>
        </main>
      </body>
    </html>
  )
}
