// app/forgot-password/ForgotPasswordForm.tsx
'use client'

import { useActionState } from 'react'
import { requestPasswordReset, type AuthFormState } from '@/app/auth/actions'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton, TextField } from '@/components/auth/fields'

const initialState: AuthFormState = {}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState)

  if (state.message) return <FormAlert message={state.message} />

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert error={state.error} />
      <TextField id="email" name="email" type="email" label="Email address" autoComplete="email" required />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  )
}
