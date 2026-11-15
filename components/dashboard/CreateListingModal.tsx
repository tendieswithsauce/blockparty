// components/dashboard/CreateListingModal.tsx
// "New listing" form with photo upload. Photos go to the public
// listing-photos bucket under <user id>/..., then the listing row stores their paths.
'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_HUB, HUBS } from '@/lib/hubs'
import { MAX_PRICE_CENTS, dollarsToCents, formatCents } from '@/lib/money'

const AUCTION_DURATIONS_DAYS = [1, 3, 5, 7] as const
const MAX_PHOTOS = 8
const MAX_PHOTO_BYTES = 5 * 1024 * 1024
// Matches the bucket's allowed types. HEIC is left out: most browsers can't display it.
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type Photo = { file: File; preview: string }

function extensionFor(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName
  return file.type.split('/')[1] ?? 'jpg'
}

export function CreateListingModal({
  defaultHub,
  onClose,
  onCreated,
}: {
  defaultHub?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [listingType, setListingType] = useState<'fixed' | 'auction'>('fixed')
  const [durationDays, setDurationDays] = useState<number>(3)
  const [locationHub, setLocationHub] = useState<string>(defaultHub ?? DEFAULT_HUB)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const photosRef = useRef<Photo[]>([])
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  // Free the preview object URLs when the modal closes.
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), [])

  function addFiles(files: FileList | null) {
    if (!files) return
    setError('')
    const next: Photo[] = []
    for (const file of Array.from(files)) {
      if (!PHOTO_TYPES.includes(file.type)) {
        setError(`${file.name} isn't a supported image. Use JPG, PNG or WebP.`)
        continue
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError(`${file.name} is over 5 MB.`)
        continue
      }
      next.push({ file, preview: URL.createObjectURL(file) })
    }
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length
      if (next.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`)
      next.slice(room).forEach((p) => URL.revokeObjectURL(p.preview))
      return [...current, ...next.slice(0, room)]
    })
    if (fileInput.current) fileInput.current.value = ''
  }

  function removePhoto(index: number) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].preview)
      return current.filter((_, i) => i !== index)
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const priceCents = dollarsToCents(price)
    if (priceCents === null) {
      setError('Enter a valid price greater than $0.')
      return
    }
    if (priceCents > MAX_PRICE_CENTS) {
      setError(`Blockparty is for items up to ${formatCents(MAX_PRICE_CENTS)}. Lower the price to list it.`)
      return
    }
    if (photos.length === 0) {
      setError('Add at least one photo so buyers can see the item.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Your session expired. Please sign in again.')
      setSaving(false)
      return
    }

    // 1. Upload photos into the seller's folder.
    const uploaded: string[] = []
    for (const [i, photo] of photos.entries()) {
      setStatus(`Uploading photo ${i + 1} of ${photos.length}…`)
      const path = `${user.id}/${crypto.randomUUID()}.${extensionFor(photo.file)}`
      const { error: uploadError } = await supabase.storage
        .from('listing-photos')
        .upload(path, photo.file, { contentType: photo.file.type, cacheControl: '31536000' })
      if (uploadError) {
        if (uploaded.length) await supabase.storage.from('listing-photos').remove(uploaded)
        setError(`Could not upload ${photo.file.name}: ${uploadError.message}`)
        setStatus('')
        setSaving(false)
        return
      }
      uploaded.push(path)
    }

    // 2. Create the listing. Fixed price needs buy_now_price_cents; auctions
    // need a starting price and an end time (DB check constraint).
    setStatus('Publishing…')
    const pricing =
      listingType === 'fixed'
        ? { buy_now_price_cents: priceCents }
        : {
            starting_price_cents: priceCents,
            ends_at: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString(),
          }

    const { error: insertError } = await supabase.from('listings').insert({
      seller_id: user.id,
      title: title.trim(),
      description: description.trim() || null,
      listing_type: listingType,
      location_hub: locationHub,
      image_paths: uploaded,
      ...pricing,
    })

    if (insertError) {
      await supabase.storage.from('listing-photos').remove(uploaded)
      setError(
        insertError.code === '42501'
          ? 'Finish setting up payouts before listing an item.'
          : `Could not publish your listing: ${insertError.message}`,
      )
      setStatus('')
      setSaving(false)
      return
    }

    setSaving(false)
    onCreated()
  }

  const inputClass =
    'mt-1 w-full border border-slate-300 px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
      <div className="bg-white max-w-lg w-full rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-xl font-bold text-[#0E4D5C]">New listing</h2>
          <button type="button" onClick={onClose} disabled={saving} className="p-1 rounded-full hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && <div className="p-3 text-sm rounded-lg bg-red-50 text-red-700">{error}</div>}

          {/* Photos */}
          <div>
            <span className="block text-sm font-medium text-gray-700">
              Photos <span className="text-gray-400 font-normal">({photos.length}/{MAX_PHOTOS}, first one is the cover)</span>
            </span>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {photos.map((photo, i) => (
                <div key={photo.preview} className="relative aspect-square rounded-lg overflow-hidden border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                  <img src={photo.preview} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  {i === 0 && (
                    <span className="absolute bottom-1 left-1 text-[10px] font-bold uppercase bg-[#0E4D5C] text-white px-1.5 py-0.5 rounded">
                      Cover
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    disabled={saving}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={saving}
                  className="aspect-square rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-500 hover:border-[#0E4D5C] hover:text-[#0E4D5C] transition"
                >
                  <ImagePlus className="w-6 h-6" />
                  <span className="text-xs font-medium">Add photos</span>
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={PHOTO_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <p className="mt-1 text-xs text-gray-500">JPG, PNG or WebP, up to 5 MB each.</p>
          </div>

          <div>
            <label htmlFor="listing-title" className="block text-sm font-medium text-gray-700">Title</label>
            <input
              id="listing-title"
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="listing-price" className="block text-sm font-medium text-gray-700">
                {listingType === 'auction' ? 'Starting price ($)' : 'Price ($)'}
              </label>
              <input
                id="listing-price"
                type="number"
                step="0.01"
                min="0.01"
                max={MAX_PRICE_CENTS / 100}
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">Up to {formatCents(MAX_PRICE_CENTS)}{listingType === 'auction' ? ', including bids' : ''}.</p>
            </div>
            <div>
              <label htmlFor="listing-format" className="block text-sm font-medium text-gray-700">Format</label>
              <select
                id="listing-format"
                value={listingType}
                onChange={(e) => setListingType(e.target.value as 'fixed' | 'auction')}
                className={inputClass}
              >
                <option value="fixed">Fixed price</option>
                <option value="auction">Auction</option>
              </select>
            </div>
          </div>

          {listingType === 'auction' && (
            <div>
              <label htmlFor="listing-duration" className="block text-sm font-medium text-gray-700">Auction length</label>
              <select
                id="listing-duration"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className={inputClass}
              >
                {AUCTION_DURATIONS_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="listing-hub" className="block text-sm font-medium text-gray-700">Exchange hub</label>
            <select id="listing-hub" value={locationHub} onChange={(e) => setLocationHub(e.target.value)} className={inputClass}>
              {HUBS.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="listing-description" className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              id="listing-description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            {status && <span className="text-sm text-gray-500 mr-auto">{status}</span>}
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-[#F26B5B] text-white font-semibold rounded-full hover:bg-[#e05a4a] disabled:opacity-60"
            >
              {saving ? 'Publishing…' : 'Publish listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
