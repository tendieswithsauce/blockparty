// app/profile/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AreaSelect } from '@/components/AreaSelect'
import { DisplayNameField, type NameStatus } from '@/components/DisplayNameField'
import { SiteHeader } from '@/components/SiteHeader'
import { PaymentMethodSection } from '@/components/payments/PaymentMethodSection'

export default function ProfilePage() {
  const [username, setUsername] = useState('')
  const [savedUsername, setSavedUsername] = useState('')
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  // Set when the 30-day wait since the last name change hasn't passed yet.
  const [nameLockedUntil, setNameLockedUntil] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [areaId, setAreaId] = useState<string>('')
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // The profile row is created automatically on sign-up (DB trigger).
        const { data } = await supabase
          .from('profiles')
          .select('username, username_changed_at, full_name, phone, area_id, email_alerts')
          .eq('id', user.id)
          .single()
        if (data) {
          setUsername(data.username)
          setSavedUsername(data.username)
          const unlock = data.username_changed_at ? new Date(data.username_changed_at).getTime() + 30 * 86_400_000 : 0
          setNameLockedUntil(
            unlock > Date.now() ? new Date(unlock).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' }) : null,
          )
          setFullName(data.full_name || '')
          setPhone(data.phone || '')
          setAreaId(data.area_id || '')
          setEmailAlerts(data.email_alerts)
        }
      }
      setLoading(false)
    }
    loadProfile()
  }, [])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setStatusMsg('')

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setStatusMsg('You must be signed in to update your profile.')
      setSaving(false)
      return
    }

    if (username !== savedUsername) {
      const { error: nameError } = await supabase.rpc('set_username', { p_name: username })
      if (nameError) {
        setStatusMsg(nameError.code === 'P0001' ? `${nameError.message}.` : 'Could not change your display name.')
        setSaving(false)
        return
      }
      if (username.toLowerCase() !== savedUsername.toLowerCase()) {
        setNameLockedUntil(new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' }))
      }
      setSavedUsername(username)
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName || null,
        phone: phone || null,
        area_id: areaId || null,
        email_alerts: emailAlerts,
      })
      .eq('id', user.id)

    if (error) {
      setStatusMsg('Error updating profile: ' + error.message)
    } else {
      setStatusMsg('Profile updated successfully!')
    }
    setSaving(false)
  }

  if (loading) return <div className="p-8 text-center">Loading profile...</div>

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
    <SiteHeader />
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="bg-white border rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-bold mb-6">Profile Settings</h1>

        {statusMsg && (
          <div className="mb-4 p-3 text-sm bg-gray-100 rounded-lg text-gray-800">
            {statusMsg}
          </div>
        )}

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <DisplayNameField
              value={username}
              onChange={setUsername}
              onStatus={setNameStatus}
              original={savedUsername}
              disabled={!!nameLockedUntil}
              inputClassName="w-full border px-3 py-2 pr-9 rounded-lg focus:ring-2 focus:ring-black focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              {nameLockedUntil
                ? `You can change your display name again on ${nameLockedUntil}.`
                : 'You can change it once every 30 days.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Full name <span className="font-normal text-gray-400">(private)</span></label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full border px-3 py-2 rounded-lg focus:ring-2 focus:ring-black focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full border px-3 py-2 rounded-lg focus:ring-2 focus:ring-black focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="profile-area" className="block text-sm font-medium text-gray-700">Your area</label>
            <AreaSelect
              id="profile-area"
              value={areaId}
              onChange={setAreaId}
              placeholder="Choose the part of the city you're in"
              className="mt-1 w-full border px-3 py-2 rounded-lg focus:ring-2 focus:ring-black focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              Used to suggest meetup spots that are fair to you and the other person. Your exact address is never shared.
            </p>
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-gray-700">Email</legend>
            <label className="mt-1 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span>
                Email me when I&apos;m outbid and about listings I&apos;m watching
                <span className="block text-xs text-gray-500">
                  You&apos;ll always get emails about your own orders: wins, sales, meetups and payments.
                </span>
              </span>
            </label>
          </fieldset>

          <button
            type="submit"
            disabled={saving || nameStatus === 'checking' || nameStatus === 'bad'}
            className="w-full bg-black disabled:opacity-60 text-white py-3 rounded-lg font-medium hover:bg-gray-800 transition mt-4"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>

      <PaymentMethodSection />
    </div>
    </div>
  )
}