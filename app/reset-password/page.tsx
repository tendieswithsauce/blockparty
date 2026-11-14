// app/reset-password/page.tsx
// Reached from the password-reset email (signed in via /auth/callback).
// proxy.ts sends signed-out visitors to /login.
import type { Metadata } from 'next'
import { AuthShell } from '@/components/auth/AuthShell'
import { ResetPasswordForm } from './ResetPasswordForm'

export const metadata: Metadata = { title: 'Set a new password' }

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Set a new password" subtitle="Choose a password you haven't used here before">
      <ResetPasswordForm />
    </AuthShell>
  )
}
