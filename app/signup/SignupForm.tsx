// app/signup/SignupForm.tsx
'use client'

import { useActionState } from 'react'
import { signUp, type AuthFormState } from '@/app/auth/actions'
import { FormAlert } from '@/components/auth/FormAlert'
import { GoogleButton } from '@/components/auth/GoogleButton'
import { SubmitButton, TextField } from '@/components/auth/fields'

const initialState: AuthFormState = {}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState)

  // After a successful email sign-up, replace the form with the confirmation notice.
  if (state.message) {
    return <FormAlert message={state.message} />
  }

  return (
    <div className="space-y-6">
      <FormAlert error={state.error} />

      <GoogleButton next="/profile" />

      <form action={formAction} className="space-y-4">
        <TextField id="full_name" name="full_name" label="Full name" autoComplete="name" required maxLength={100} />
        <TextField id="email" name="email" type="email" label="Email address" autoComplete="email" required />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <p className="text-xs text-slate-500 -mt-2">At least 8 characters.</p>
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </div>
  )
}
