// app/profile/page.tsx
// Your account: photo, display name, private details (home address,
// emergency contact), alerts, payment method. On phones it's also the "Me"
// tab, so it carries the links that live in the desktop header.
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Camera, ChevronRight, HeartHandshake, Info, LayoutGrid, LogOut, ShieldAlert, Shield, Trash2, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AreaSelect } from '@/components/AreaSelect'
import { DisplayNameField, type NameStatus } from '@/components/DisplayNameField'
import { SiteHeader } from '@/components/SiteHeader'
import { Avatar } from '@/components/Avatar'
import { PROFILE_CHANGED_EVENT } from '@/components/AuthNav'
import { PaymentMethodSection } from '@/components/payments/PaymentMethodSection'
import { BlockedMembers } from '@/components/BlockedMembers'
import { signOut } from '@/app/auth/actions'
import { WHY, optionalDetailsProblem, phoneProblem } from '@/lib/profile-rules'

const input =
  'mt-1 w-full border border-slate-300 px-3 py-2.5 rounded-xl text-base focus:ring-2 focus:ring-[#0E4D5C] focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'

/** Details that show as plain text with an Edit button once they're filled in. */
type DetailKey = 'username' | 'fullName' | 'phone' | 'areaId' | 'homeAddress' | 'ecEmail'
type Saved = {
  fullName: string
  phone: string
  areaId: string
  areaName: string
  homeAddress: string
  ecName: string
  ecEmail: string
  emailAlerts: boolean
}
const EMPTY_SAVED: Saved = { fullName: '', phone: '', areaId: '', areaName: '', homeAddress: '', ecName: '', ecEmail: '', emailAlerts: true }

/** Square-crops and shrinks a photo to a 400px JPEG in the browser. */
async function toAvatarJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 400
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No canvas')
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 400, 400)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', 0.85),
  )
}

export default function ProfilePage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [savedUsername, setSavedUsername] = useState('')
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  // Set when the 30-day wait since the last name change hasn't passed yet.
  const [nameLockedUntil, setNameLockedUntil] = useState<string | null>(null)
  const [avatarPath, setAvatarPath] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [areaId, setAreaId] = useState<string>('')
  const [homeAddress, setHomeAddress] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecEmail, setEcEmail] = useState('')
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [saved, setSaved] = useState<Saved>(EMPTY_SAVED)
  const [editing, setEditing] = useState<Set<DetailKey>>(new Set())
  const [areaNames, setAreaNames] = useState<Map<string, string>>(new Map())
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.assign('/login?next=/profile')
        return
      }
      setUserId(user.id)
      // The profile row is created automatically on sign-up (DB trigger).
      const [{ data }, { data: admin }] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'username, username_changed_at, full_name, phone, area_id, email_alerts, avatar_path, home_address, emergency_contact_name, emergency_contact_email, area:areas(name, city)',
          )
          .eq('id', user.id)
          .single(),
        supabase.rpc('is_admin'),
      ])
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
        setAvatarPath(data.avatar_path)
        setHomeAddress(data.home_address || '')
        setEcName(data.emergency_contact_name || '')
        setEcEmail(data.emergency_contact_email || '')
        setSaved({
          fullName: data.full_name || '',
          phone: data.phone || '',
          areaId: data.area_id || '',
          areaName: data.area ? `${data.area.name}, ${data.area.city}` : '',
          homeAddress: data.home_address || '',
          ecName: data.emergency_contact_name || '',
          ecEmail: data.emergency_contact_email || '',
          emailAlerts: data.email_alerts,
        })
      }
      setIsAdmin(!!admin)
      setLoading(false)
    }
    loadProfile()
  }, [])

  async function changePhoto(file: File | undefined) {
    if (!file || !userId) return
    setPhotoError('')
    if (!file.type.startsWith('image/')) return setPhotoError('Choose a photo (JPG, PNG or WebP).')
    if (file.size > 15 * 1024 * 1024) return setPhotoError('That photo is too large.')
    setPhotoBusy(true)
    try {
      const supabase = createClient()
      const blob = await toAvatarJpeg(file)
      const path = `${userId}/avatar-${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId)
      if (dbErr) {
        await supabase.storage.from('avatars').remove([path])
        throw dbErr
      }
      if (avatarPath) await supabase.storage.from('avatars').remove([avatarPath])
      setAvatarPath(path)
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT))
    } catch {
      setPhotoError("We couldn't use that photo. Try a different one.")
    } finally {
      setPhotoBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function removePhoto() {
    if (!userId || !avatarPath) return
    setPhotoBusy(true)
    const supabase = createClient()
    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId)
    if (!error) {
      await supabase.storage.from('avatars').remove([avatarPath])
      setAvatarPath(null)
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT))
    }
    setPhotoBusy(false)
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus(null)
    const address = homeAddress.trim()
    const contactName = ecName.trim()
    const contactEmail = ecEmail.trim().toLowerCase()
    if (!areaId) return setStatus({ ok: false, text: 'Choose your area.' })
    const problem = phoneProblem(phone.trim()) ?? optionalDetailsProblem({ homeAddress: address, ecName: contactName, ecEmail: contactEmail })
    if (problem) return setStatus({ ok: false, text: problem })
    setSaving(true)
    const supabase = createClient()
    if (!userId) {
      setStatus({ ok: false, text: 'You must be signed in to update your profile.' })
      setSaving(false)
      return
    }

    if (username !== savedUsername) {
      const { error: nameError } = await supabase.rpc('set_username', { p_name: username })
      if (nameError) {
        setStatus({ ok: false, text: nameError.code === 'P0001' ? `${nameError.message}.` : 'Could not change your display name.' })
        setSaving(false)
        return
      }
      if (username.toLowerCase() !== savedUsername.toLowerCase()) {
        setNameLockedUntil(new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' }))
      }
      setSavedUsername(username)
      window.dispatchEvent(new Event(PROFILE_CHANGED_EVENT))
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        area_id: areaId || null,
        email_alerts: emailAlerts,
        home_address: address || null,
        emergency_contact_name: contactEmail ? contactName || null : null,
        emergency_contact_email: contactEmail || null,
      })
      .eq('id', userId)

    setSaving(false)
    if (error) return setStatus({ ok: false, text: 'Could not save your profile. Please try again.' })
    setStatus({ ok: true, text: 'Profile saved.' })
    const keptName = contactEmail ? contactName : ''
    setSaved({
      fullName: fullName.trim(),
      phone: phone.trim(),
      areaId,
      areaName: areaNames.get(areaId) ?? saved.areaName,
      homeAddress: address,
      ecName: keptName,
      ecEmail: contactEmail,
      emailAlerts,
    })
    setFullName(fullName.trim())
    setPhone(phone.trim())
    setHomeAddress(address)
    setEcName(keptName)
    setEcEmail(contactEmail)
    setEditing(new Set())
  }

  const savedValue: Record<DetailKey, string> = {
    username: savedUsername,
    fullName: saved.fullName,
    phone: saved.phone,
    areaId: saved.areaId,
    homeAddress: saved.homeAddress,
    ecEmail: saved.ecEmail,
  }
  const isStatic = (key: DetailKey) => Boolean(savedValue[key]) && !editing.has(key)
  function startEditing(key: DetailKey) {
    setStatus(null)
    setEditing((prev) => new Set(prev).add(key))
  }
  function cancelEditing() {
    setUsername(savedUsername)
    setFullName(saved.fullName)
    setPhone(saved.phone)
    setAreaId(saved.areaId)
    setHomeAddress(saved.homeAddress)
    setEcName(saved.ecName)
    setEcEmail(saved.ecEmail)
    setEmailAlerts(saved.emailAlerts)
    setEditing(new Set())
    setStatus(null)
  }
  const dirty =
    username !== savedUsername ||
    fullName.trim() !== saved.fullName ||
    phone.trim() !== saved.phone ||
    areaId !== saved.areaId ||
    homeAddress.trim() !== saved.homeAddress ||
    ecName.trim() !== saved.ecName ||
    ecEmail.trim().toLowerCase() !== saved.ecEmail ||
    emailAlerts !== saved.emailAlerts

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader />
      <main className="max-w-xl mx-auto px-4 pt-2 pb-10 md:py-10 space-y-6">
        {loading ? (
          <div className="h-96 rounded-2xl bg-slate-200 animate-pulse" />
        ) : (
          <>
            {/* Photo + name */}
            <section className="bg-white border rounded-2xl p-5 shadow-sm flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
                className="relative rounded-full disabled:opacity-60"
                aria-label={avatarPath ? 'Change your photo' : 'Add a photo'}
              >
                <Avatar path={avatarPath} name={savedUsername} size="lg" />
                <span className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#0E4D5C] text-white flex items-center justify-center ring-2 ring-white">
                  <Camera className="w-4 h-4" />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xl font-extrabold truncate">{savedUsername}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={photoBusy}
                    className="font-semibold text-[#0E4D5C] underline"
                  >
                    {photoBusy ? 'Saving…' : avatarPath ? 'Change photo' : 'Add a photo'}
                  </button>
                  {avatarPath && !photoBusy && (
                    <button type="button" onClick={removePhoto} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                  <Link href={`/u/${savedUsername}`} className="text-slate-500 underline">
                    See your public profile
                  </Link>
                </div>
                {photoError && <p className="text-sm text-red-600 mt-1">{photoError}</p>}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => changePhoto(e.target.files?.[0])}
              />
            </section>

            <form onSubmit={handleSaveProfile} className="bg-white border rounded-2xl p-5 md:p-8 shadow-sm space-y-5">
              <h1 className="text-xl font-bold">Your details</h1>

              {isStatic('username') ? (
                <DetailRow
                  label="Display name"
                  value={savedUsername}
                  note={nameLockedUntil ? `You can change it again on ${nameLockedUntil}.` : 'Shown to other members.'}
                  onEdit={nameLockedUntil ? undefined : () => startEditing('username')}
                />
              ) : (
                <div>
                  <DisplayNameField
                    value={username}
                    onChange={setUsername}
                    onStatus={setNameStatus}
                    original={savedUsername}
                    disabled={!!nameLockedUntil}
                    inputClassName={`${input} pr-9`}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {nameLockedUntil
                      ? `You can change your display name again on ${nameLockedUntil}.`
                      : 'Shown to other members. You can change it once every 30 days.'}
                  </p>
                </div>
              )}

              {isStatic('fullName') ? (
                <DetailRow label="Full name" value={saved.fullName} note="Private." onEdit={() => startEditing('fullName')} />
              ) : (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Full name <span className="font-normal text-slate-400">(private)</span>
                  </span>
                  <input type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
                </label>
              )}

              {isStatic('phone') ? (
                <DetailRow label="Phone number" value={saved.phone} note="Private." onEdit={() => startEditing('phone')} />
              ) : (
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
              )}

              {isStatic('areaId') ? (
                <DetailRow label="Your area" value={saved.areaName || 'Set'} onEdit={() => startEditing('areaId')} />
              ) : (
                <div>
                  <label htmlFor="profile-area" className="block text-sm font-medium text-slate-700">
                    Your area
                  </label>
                  <AreaSelect
                    id="profile-area"
                    required
                    value={areaId}
                    onChange={setAreaId}
                    onLoaded={(list) => setAreaNames(new Map(list.map((a) => [a.id, `${a.name}, ${a.city}`])))}
                    placeholder="Choose the part of the city you're in"
                    className={input}
                  />
                  <p className="mt-1 text-xs text-slate-500">{WHY.area}</p>
                </div>
              )}

              {isStatic('homeAddress') ? (
                <DetailRow
                  label="Home address"
                  value={saved.homeAddress}
                  note="Private. Shown only to the other person in a pickup or delivery order."
                  onEdit={() => startEditing('homeAddress')}
                />
              ) : (
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Home address <span className="font-normal text-slate-400">(optional, private)</span>
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
              )}

              {isStatic('ecEmail') ? (
                <DetailRow
                  label="Emergency contact"
                  value={saved.ecName ? `${saved.ecName} · ${saved.ecEmail}` : saved.ecEmail}
                  note="Emailed when you agree on a meetup, and when it's done or cancelled."
                  onEdit={() => startEditing('ecEmail')}
                />
              ) : (
                <fieldset className="space-y-3 rounded-xl bg-[#0E4D5C]/5 p-4">
                  <legend className="sr-only">Emergency contact</legend>
                  <p className="flex items-center gap-2 text-sm font-semibold text-[#0E4D5C]">
                    <ShieldAlert className="w-4 h-4" /> Emergency contact <span className="font-normal text-slate-500">(optional)</span>
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
              )}

              <fieldset>
                <legend className="block text-sm font-medium text-slate-700">Email</legend>
                <label className="mt-1 flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={emailAlerts}
                    onChange={(e) => setEmailAlerts(e.target.checked)}
                    className="mt-0.5 w-5 h-5"
                  />
                  <span>
                    Email me when I&apos;m outbid, about listings I&apos;m watching, and about new matches for my saved searches
                    <span className="block text-xs text-slate-500">
                      You&apos;ll always get emails about your own orders: wins, sales, meetups and payments.
                    </span>
                  </span>
                </label>
              </fieldset>

              {status && (
                <div className={`p-3 text-sm rounded-xl ${status.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                  {status.text}
                </div>
              )}

              {(dirty || editing.size > 0) && (
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={saving || nameStatus === 'checking' || nameStatus === 'bad'}
                    className="flex-1 bg-[#0E4D5C] disabled:opacity-60 text-white py-3 rounded-full font-bold hover:bg-[#0b3f4b] transition"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  {editing.size > 0 && (
                    <button
                      type="button"
                      onClick={cancelEditing}
                      className="px-5 py-3 rounded-full border-2 border-slate-300 font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </form>

            <PaymentMethodSection />

            <BlockedMembers />

            {/* Phone account menu: the desktop header has these links. */}
            <nav className="md:hidden bg-white border rounded-2xl shadow-sm divide-y overflow-hidden" aria-label="Account">
              {[
                { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
                { href: '/charities', label: 'Charities', icon: HeartHandshake },
                { href: '/#how-it-works', label: 'How it works', icon: Info },
                { href: '/about', label: 'About Blockparty', icon: Users },
                ...(isAdmin ? [{ href: '/admin', label: 'Admin', icon: Shield }] : []),
              ].map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} className="flex items-center gap-3 px-5 py-4 font-semibold active:bg-slate-50">
                  <Icon className="w-5 h-5 text-[#0E4D5C]" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </Link>
              ))}
              <form action={signOut}>
                <button type="submit" className="w-full flex items-center gap-3 px-5 py-4 font-semibold text-red-600 active:bg-slate-50">
                  <LogOut className="w-5 h-5" /> Sign out
                </button>
              </form>
            </nav>
          </>
        )}
        <p className="mt-8 text-center text-xs text-slate-500">
          <Link href="/terms" className="underline">
            Terms of Use
          </Link>
          {' · '}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
        </p>
      </main>
    </div>
  )
}

/** A saved detail shown as text, with an Edit button. */
function DetailRow({ label, value, note, onEdit }: { label: string; value: string; note?: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="font-semibold break-words whitespace-pre-line">{value}</p>
        {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 px-3 py-1.5 rounded-full border border-slate-300 text-sm font-semibold text-[#0E4D5C] hover:bg-slate-50"
        >
          Edit
        </button>
      )}
    </div>
  )
}
