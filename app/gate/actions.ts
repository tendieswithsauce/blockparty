'use server'
// app/gate/actions.ts
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { checkGatePassword, GATE_COOKIE, safeNext } from '@/lib/site-gate'

export async function enterSite(formData: FormData) {
  const next = safeNext(String(formData.get('next') ?? '/'))
  const token = checkGatePassword(String(formData.get('password') ?? ''))

  if (!token) {
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 800))
    redirect(`/gate?error=1&next=${encodeURIComponent(next)}`)
  }

  ;(await cookies()).set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  redirect(next)
}
