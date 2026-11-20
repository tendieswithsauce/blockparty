// app/api/client-errors/route.ts
// Receives browser errors from lib/report-error.ts and writes them to the
// server log as one JSON line ("blockparty-error"), so they appear in Vercel's
// logs and Observability alongside server errors. Stores nothing.
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

const Report = z.object({
  kind: z.enum(['window-error', 'unhandled-rejection', 'error-boundary', 'global-error']),
  message: z.string().max(500),
  name: z.string().max(100).optional(),
  stack: z.string().max(2000).optional(),
  digest: z.string().max(100).optional(),
  path: z.string().max(300),
})

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => '')
  if (text.length > 4000) return new NextResponse(null, { status: 413 })
  let parsed: z.infer<typeof Report>
  try {
    parsed = Report.parse(JSON.parse(text))
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  console.error(
    JSON.stringify({
      tag: 'blockparty-error',
      source: 'client',
      ...parsed,
      userAgent: req.headers.get('user-agent')?.slice(0, 200),
    }),
  )
  return new NextResponse(null, { status: 204 })
}
