// app/signup/SignupForm.tsx
'use client'

import { useActionState, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { signUp, type AuthFormState } from '@/app/auth/actions'
import { FormAlert } from '@/components/auth/FormAlert'
import { SubmitButton, TextField } from '@/components/auth/fields'
import { DisplayNameField, type NameStatus } from '@/components/DisplayNameField'
import { AreaSelect } from '@/components/AreaSelect'
import { WHY } from '@/lib/profile-rules'
import { SecuredByStripe } from '@/components/StripeBadge'

const initialState: AuthFormState = {}
const input =
  'mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState)
  const [username, setUsername] = useState('')
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  // Controlled, so a rejected submit doesn't wipe what was typed.
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [areaId, setAreaId] = useState('')
  const [phone, setPhone] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecEmail, setEcEmail] = useState('')

  // After a successful email sign-up, replace the form with the confirmation notice.
  if (state.message) {
    return <FormAlert message={state.message} />
  }

  return (
    <div className="space-y-6">
      <FormAlert error={state.error} />

      {/* Google sign-in is switched off for now (redirect issues on the dev site). */}

      <form action={formAction} className="space-y-4">
        <DisplayNameField value={username} onChange={setUsername} onStatus={setNameStatus} generateInitial />
        <div>
          <TextField
            id="full_name"
            name="full_name"
            label="Full name"
            autoComplete="name"
            required
            maxLength={100}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">Private. Only used for payments and payouts.</p>
        </div>
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email address"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
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

        <div>
          <label htmlFor="signup-area" className="block text-sm font-semibold text-slate-700">
            Your area
          </label>
          <AreaSelect
            id="signup-area"
            name="area_id"
            required
            value={areaId}
            onChange={setAreaId}
            placeholder="Choose the part of the city you're in"
            className={input}
          />
          <p className="text-xs text-slate-500 mt-1">{WHY.area}</p>
        </div>

        <div>
          <TextField
            id="phone"
            name="phone"
            type="tel"
            label="Phone number"
            autoComplete="tel"
            inputMode="tel"
            required
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-slate-500 mt-1">{WHY.phone}</p>
        </div>

        <div className="pt-2 border-t">
          <p className="text-sm font-semibold text-slate-700 pt-3">
            Optional <span className="font-normal text-slate-500">(you can add these later on your profile)</span>
          </p>
        </div>

        <label className="block">
          <span className="block text-sm font-semibold text-slate-700">Home address</span>
          <textarea
            name="home_address"
            rows={2}
            maxLength={200}
            autoComplete="street-address"
            value={homeAddress}
            onChange={(e) => setHomeAddress(e.target.value)}
            placeholder="123 Main St NW, Calgary AB T2N 1A1"
            className={input}
          />
          <span className="text-xs text-slate-500 mt-1 block">{WHY.address}</span>
        </label>

        <fieldset className="space-y-3 rounded-xl bg-[#0E4D5C]/5 p-4">
          <legend className="sr-only">Trusted contact</legend>
          <p className="flex items-center gap-2 text-sm font-semibold text-[#0E4D5C]">
            <ShieldAlert className="w-4 h-4" /> Trusted contact
          </p>
          <p className="text-xs text-slate-600">{WHY.emergency}</p>
          <TextField id="ec_name" name="ec_name" label="Their name" maxLength={100} value={ecName} onChange={(e) => setEcName(e.target.value)} />
          <TextField
            id="ec_email"
            name="ec_email"
            type="email"
            inputMode="email"
            label="Their email"
            maxLength={254}
            value={ecEmail}
            onChange={(e) => setEcEmail(e.target.value)}
          />
        </fieldset>

        <p className="text-xs text-slate-500">
          <strong className="text-slate-700">Payment method:</strong> you can add a card right after you confirm your email.{' '}
          {WHY.payment}
        </p>
        <SecuredByStripe text="Cards are saved securely with Stripe." />

        <SubmitButton pending={pending} disabled={nameStatus === 'checking' || nameStatus === 'bad'}>Create account</SubmitButton>
      </form>
    </div>
  )
}
