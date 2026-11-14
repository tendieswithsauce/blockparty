// app/reset-password/ResetPasswordForm.tsx
'use client'

import { useActionState } from 'react'
import { updatePassword, type AuthFormState } from '@/app/auth/actions'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton, TextField } from '@/components/auth/fields'

const initialState: AuthFormState = {}

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState)

  return (
    <form action={formAction} className="space-y-4">
      <FormAlert error={state.error} />
      <TextField
        id="password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <TextField
        id="confirm_password"
        name="confirm_password"
        type="password"
        label="Confirm new password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <SubmitButton pending={pending}>Update password</SubmitButton>
    </form>
  )
}
