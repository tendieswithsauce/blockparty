// app/charities/apply/page.tsx
// A registered charity applies to sell on Blockparty, or sees where its
// application stands and how much of its fee-free allowance is left.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Clock, HeartHandshake, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatCents } from '@/lib/money'
import { SiteHeader } from '@/components/SiteHeader'
import type { Database } from '@/lib/supabase/database.types'

type MyCharity = Database['public']['Functions']['my_charity']['Returns'][number]

const input = 'mt-1 w-full border border-slate-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

export default function ApplyCharityPage() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'ready'>('loading')
  const [charity, setCharity] = useState<MyCharity | null>(null)
  const [capCents, setCapCents] = useState<number | null>(null)
  const [form, setForm] = useState({ bn: '', name: '', description: '', website: '', contactName: '', contactRole: '' })
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: auth }, { data: settings }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('marketplace_settings').select('charity_fee_free_cap_cents').maybeSingle(),
    ])
    setCapCents(settings?.charity_fee_free_cap_cents ?? null)
    if (!auth.user) return setState('signed-out')
    const { data } = await supabase.rpc('my_charity')
    setCharity(data?.[0] ?? null)
    setState('ready')
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!agreed) return setError('Confirm that you can act for this charity.')
    setSaving(true)
    const { error: rpcError } = await createClient().rpc('apply_charity', {
      p_bn: form.bn,
      p_name: form.name,
      p_description: form.description || null,
      p_website: form.website || null,
      p_contact_name: form.contactName,
      p_contact_role: form.contactRole,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    load()
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader active="charities" />
      <main className="max-w-2xl mx-auto px-6 pb-16 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold text-[#0E4D5C] flex items-center gap-2">
            <HeartHandshake className="w-7 h-7 text-[#F26B5B]" /> Sell for your charity
          </h1>
          <p className="text-slate-600 mt-1">
            Registered Canadian charities can sell donated items on Blockparty.
            {capCents !== null && capCents > 0 && <> The first {formatCents(capCents)} of sales each year have no Blockparty fee.</>}{' '}
            Your auctions are silent: bidders can&apos;t see each other&apos;s bids.
          </p>
        </div>

        {state === 'loading' ? (
          <div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />
        ) : state === 'signed-out' ? (
          <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-3">
            <p>Create an account for your charity first. Everything that account lists will raise money for the charity.</p>
            <div className="flex gap-3">
              <Link href="/signup" className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-semibold">
                Create an account
              </Link>
              <Link href="/login?next=/charities/apply" className="px-5 py-2.5 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold">
                Sign in
              </Link>
            </div>
          </div>
        ) : charity && charity.status !== 'rejected' ? (
          <Status charity={charity} />
        ) : (
          <form onSubmit={submit} className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
            {charity?.status === 'rejected' && (
              <div className="p-3 rounded-xl bg-red-50 text-red-800 text-sm">
                Your last application wasn&apos;t approved{charity.review_note ? `: ${charity.review_note}` : '.'} You can apply again.
              </div>
            )}
            <p className="text-sm text-slate-600">
              Use an account just for the charity: once approved, everything it lists raises money for the charity. You&apos;ll
              also need to set up payouts so sales go to the charity&apos;s bank account.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">CRA registration number</span>
              <input value={form.bn} onChange={set('bn')} placeholder="123456789RR0001" required className={input} />
              <span className="text-xs text-slate-500">
                From the CRA list of charities. We check it against the list; if it&apos;s not there, we check it by hand.
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Charity name</span>
              <input value={form.name} onChange={set('name')} maxLength={80} required className={input} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                About the charity <span className="font-normal text-slate-500">(shown publicly)</span>
              </span>
              <textarea value={form.description} onChange={set('description')} maxLength={1000} rows={3} className={input} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">
                Website <span className="font-normal text-slate-500">(optional)</span>
              </span>
              <input value={form.website} onChange={set('website')} placeholder="https://" maxLength={200} className={input} />
            </label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Your name</span>
                <input value={form.contactName} onChange={set('contactName')} maxLength={100} required className={input} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Your role</span>
                <input value={form.contactRole} onChange={set('contactRole')} placeholder="e.g. Treasurer" maxLength={100} required className={input} />
              </label>
            </div>
            <p className="text-xs text-slate-500 -mt-2">Your name and role are only shown to Blockparty staff.</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
              I&apos;m authorized to act for this charity, and items sold here raise money for it.
            </label>
            {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-full bg-[#F26B5B] text-white font-bold hover:bg-[#e05a4a] disabled:opacity-60"
            >
              {saving ? 'Sending…' : 'Apply'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

function Status({ charity }: { charity: MyCharity }) {
  if (charity.status === 'pending') {
    return (
      <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
        <p className="font-bold flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-600" /> Application received
        </p>
        <p className="text-sm text-slate-600">
          We&apos;re reviewing {charity.name} ({charity.bn}) and will let you know, usually within a couple of days.
        </p>
      </div>
    )
  }
  if (charity.status === 'suspended') {
    return (
      <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-2">
        <p className="font-bold flex items-center gap-2">
          <XCircle className="w-5 h-5 text-red-600" /> {charity.name} is paused
        </p>
        <p className="text-sm text-slate-600">New listings from this account aren&apos;t charity listings right now.</p>
      </div>
    )
  }
  const left = Math.max(0, charity.fee_free_cap_cents - charity.fee_free_used_cents)
  return (
    <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-3">
      <p className="font-bold flex items-center gap-2">
        <CheckCircle2 className="w-5 h-5 text-green-700" /> {charity.name} is approved
      </p>
      <p className="text-sm text-slate-600">
        Everything you list from this account raises money for {charity.name}, and your auctions are silent.
      </p>
      {charity.fee_free_cap_cents > 0 && (
        <div>
          <div className="flex justify-between text-sm">
            <span>Fee-free sales this year</span>
            <span className="font-semibold">
              {formatCents(charity.fee_free_used_cents)} of {formatCents(charity.fee_free_cap_cents)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
            <div
              className="h-full bg-[#0E4D5C]"
              style={{ width: `${Math.min(100, (charity.fee_free_used_cents / charity.fee_free_cap_cents) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {left > 0
              ? `A sale has no fee if it fits in the ${formatCents(left)} left; after that the normal fee applies.`
              : 'The normal Blockparty fee applies for the rest of the year.'}
          </p>
        </div>
      )}
      <div className="flex gap-3">
        <Link href="/dashboard" className="px-4 py-2 rounded-full bg-[#F26B5B] text-white text-sm font-semibold">
          List an item
        </Link>
        <Link href={`/charities/${charity.slug}`} className="px-4 py-2 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] text-sm font-semibold">
          See your charity page
        </Link>
      </div>
    </div>
  )
}
