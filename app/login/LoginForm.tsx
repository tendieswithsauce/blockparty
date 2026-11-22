// app/login/LoginForm.tsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { signIn, type AuthFormState } from '@/app/auth/actions'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton, TextField } from '@/components/auth/fields'

const initialState: AuthFormState = {}

export function LoginForm() {
  const searchParams = useSearchParams()
  const next = searchParams.get('next') ?? undefined
  const urlError = searchParams.get('error')
  const [state, formAction, pending] = useActionState(signIn, initialState)

  return (
    <div className="space-y-6">
      <FormAlert error={state.error ?? urlError} message={state.message} />

      {/* Google sign-in is switched off for now (redirect issues on the dev site). */}

      <form action={formAction} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <TextField id="email" name="email" type="email" label="Email address" autoComplete="email" required />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          required
        />
        <div className="text-right -mt-2">
          <Link href="/forgot-password" className="text-xs font-semibold text-[#0E4D5C] hover:text-[#F26B5B]">
            Forgot your password?
          </Link>
        </div>
        <SubmitButton pending={pending}>Sign in</SubmitButton>
      </form>
    </div>
  )
}
