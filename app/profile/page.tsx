// app/profile/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AreaSelect } from '@/components/AreaSelect'
import { SiteHeader } from '@/components/SiteHeader'
import { PaymentMethodSection } from '@/components/payments/PaymentMethodSection'

export default function ProfilePage() {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [areaId, setAreaId] = useState<string>('')
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
          .select('full_name, phone, area_id')
          .eq('id', user.id)
          .single()
        if (data) {
          setFullName(data.full_name || '')
          setPhone(data.phone || '')
          setAreaId(data.area_id || '')
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

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName || null,
        phone: phone || null,
        area_id: areaId || null,
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
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
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

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-black text-white py-3 rounded-lg font-medium hover:bg-gray-800 transition mt-4"
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