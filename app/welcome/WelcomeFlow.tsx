// app/welcome/WelcomeFlow.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BrandLogo } from '@/components/BrandLogo'
import { AreaSelect } from '@/components/AreaSelect'
import { PaymentMethodSection } from '@/components/payments/PaymentMethodSection'
import { WHY, optionalDetailsProblem, phoneProblem } from '@/lib/profile-rules'

const input =
  'mt-1 w-full border border-slate-300 px-3 py-2.5 rounded-xl text-base focus:ring-2 focus:ring-[#0E4D5C] focus:outline-none'

type Step = 'loading' | 'details' | 'payment'

export function WelcomeFlow({ next }: { next: string }) {
  const router = useRouter()
  const [step, setStep] = useState<Step>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [areaId, setAreaId] = useState('')
  const [phone, setPhone] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecEmail, setEcEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return router.replace(`/login?next=${encodeURIComponent('/welcome')}`)
      setUserId(user.id)
      const { data } = await supabase
        .from('profiles')
        .select('phone, area_id, home_address, emergency_contact_name, emergency_contact_email')
        .eq('id', user.id)
        .single()
      setAreaId(data?.area_id ?? '')
      setPhone(data?.phone ?? '')
      setHomeAddress(data?.home_address ?? '')
      setEcName(data?.emergency_contact_name ?? '')
      setEcEmail(data?.emergency_contact_email ?? '')
      setStep(data?.phone && data?.area_id ? 'payment' : 'details')
    }
    load()
  }, [router])

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const details = { homeAddress: homeAddress.trim(), ecName: ecName.trim(), ecEmail: ecEmail.trim().toLowerCase() }
    if (!areaId) return setError('Choose your area.')
    const problem = phoneProblem(phone.trim()) ?? optionalDetailsProblem(details)
    if (problem) return setError(problem)
    if (!userId) return
    setSaving(true)
    const { error: dbError } = await createClient()
      .from('profiles')
      .update({
        area_id: areaId,
        phone: phone.trim(),
        home_address: details.homeAddress || null,
        emergency_contact_name: details.ecEmail ? details.ecName || null : null,
        emergency_contact_email: details.ecEmail || null,
      })
      .eq('id', userId)
    setSaving(false)
    if (dbError) return setError('Could not save your details. Please try again.')
    setStep('payment')
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex justify-center">
        <BrandLogo size="lg" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">Welcome to Blockparty!</h1>
        <p className="mt-1 text-sm text-slate-500">
          {step === 'details' ? 'A couple of details before you start.' : 'One last, optional step.'}
        </p>
      </div>

      {step === 'loading' && <div className="h-80 rounded-2xl bg-slate-200 animate-pulse" />}

      {step === 'details' && (
        <form onSubmit={saveDetails} className="bg-white border rounded-2xl p-5 md:p-8 shadow-sm space-y-5">
          <div>
            <label htmlFor="welcome-area" className="block text-sm font-medium text-slate-700">
              Your area
            </label>
            <AreaSelect
              id="welcome-area"
              required
              value={areaId}
              onChange={setAreaId}
              placeholder="Choose the part of the city you're in"
              className={input}
            />
            <p className="mt-1 text-xs text-slate-500">{WHY.area}</p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Phone number</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={30}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={input}
            />
            <span className="mt-1 block text-xs text-slate-500">{WHY.phone}</span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">
              Home address <span className="font-normal text-slate-400">(optional)</span>
            </span>
            <textarea
              rows={2}
              maxLength={200}
              autoComplete="street-address"
              value={homeAddress}
              onChange={(e) => setHomeAddress(e.target.value)}
              placeholder="123 Main St NW, Calgary AB T2N 1A1"
              className={input}
            />
            <span className="mt-1 block text-xs text-slate-500">{WHY.address}</span>
          </label>

          <fieldset className="space-y-3 rounded-xl bg-[#0E4D5C]/5 p-4">
            <legend className="sr-only">Trusted contact</legend>
            <p className="flex items-center gap-2 text-sm font-semibold text-[#0E4D5C]">
              <ShieldAlert className="w-4 h-4" /> Trusted contact <span className="font-normal text-slate-500">(optional)</span>
            </p>
            <p className="text-xs text-slate-600">{WHY.emergency}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Their name</span>
                <input type="text" maxLength={100} value={ecName} onChange={(e) => setEcName(e.target.value)} className={input} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Their email</span>
                <input
                  type="email"
                  inputMode="email"
                  maxLength={254}
                  value={ecEmail}
                  onChange={(e) => setEcEmail(e.target.value)}
                  className={input}
                />
              </label>
            </div>
          </fieldset>

          {error && <p className="p-3 text-sm rounded-xl bg-red-50 text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#0E4D5C] disabled:opacity-60 text-white py-3 rounded-full font-bold hover:bg-[#0b3f4b] transition"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'payment' && (
        <>
          <div className="flex gap-3 rounded-2xl bg-[#0E4D5C]/5 p-4 text-sm text-slate-700">
            <CreditCard className="w-5 h-5 shrink-0 text-[#0E4D5C]" />
            <p>
              <strong>Add a payment method (optional).</strong> {WHY.payment}
            </p>
          </div>
          <PaymentMethodSection />
          <button
            type="button"
            onClick={() => router.push(next)}
            className="w-full bg-[#F26B5B] text-white py-3 rounded-full font-bold hover:bg-[#e05a4a] transition"
          >
            Continue to Blockparty
          </button>
          <p className="text-center text-xs text-slate-500">You can add or change your card any time on your profile.</p>
        </>
      )}
    </div>
  )
}
