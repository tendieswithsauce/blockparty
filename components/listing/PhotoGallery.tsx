// components/listing/PhotoGallery.tsx
// Listing photos: main photo with arrows and thumbnails. Tapping the photo
// opens a full-screen lightbox: swipe or use the arrows / arrow keys to move,
// pinch to zoom (phones), Escape or the X to close.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Expand, ImageOff, X } from 'lucide-react'

export function PhotoGallery({ photos, title }: { photos: string[]; title: string }) {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length), [photos.length])
  // Stable, so the lightbox's open/close effect runs once, not on every photo change.
  const close = useCallback(() => setOpen(false), [])

  if (photos.length === 0) {
    return (
      <div className="aspect-[4/3] rounded-2xl bg-slate-100 flex flex-col items-center justify-center text-slate-400">
        <ImageOff className="w-10 h-10 mb-2" /> No photos
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block w-full h-full cursor-zoom-in"
          aria-label={`Open photo ${index + 1} of ${photos.length} full screen`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
          <img src={photos[index]} alt={`${title}, photo ${index + 1} of ${photos.length}`} className="w-full h-full object-contain" />
        </button>
        <span className="pointer-events-none absolute top-3 right-3 bg-black/50 text-white rounded-full p-1.5" aria-hidden>
          <Expand className="w-4 h-4" />
        </span>
        {photos.length > 1 && (
          <>
            <button
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-2 shadow hover:bg-white"
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-2 shadow hover:bg-white"
              aria-label="Next photo"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <span className="pointer-events-none absolute bottom-3 right-3 text-xs font-semibold bg-black/60 text-white px-2 py-1 rounded-full">
              {index + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((src, i) => (
            <button
              key={src}
              onClick={() => setIndex(i)}
              className={`w-20 h-20 shrink-0 rounded-lg overflow-hidden border-2 ${
                i === index ? 'border-[#F26B5B]' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
              aria-label={`Show photo ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox photos={photos} title={title} index={index} onGo={go} onPick={setIndex} onClose={close} />}
    </div>
  )
}

function Lightbox({
  photos,
  title,
  index,
  onGo,
  onPick,
  onClose,
}: {
  photos: string[]
  title: string
  index: number
  onGo: (delta: number) => void
  onPick: (i: number) => void
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number; fingers: number } | null>(null)
  const many = photos.length > 1

  // Keyboard, focus, and no page scrolling underneath while it's open.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && many) onGo(-1)
      else if (e.key === 'ArrowRight' && many) onGo(1)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [many, onClose, onGo])

  // Preload the neighbours so swiping feels instant.
  useEffect(() => {
    if (!many) return
    for (const d of [-1, 1]) {
      const img = new Image()
      img.src = photos[(index + d + photos.length) % photos.length]
    }
  }, [index, many, photos])

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, fingers: e.touches.length }
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current
    touch.current = null
    // Two fingers is a pinch-zoom, not a swipe.
    if (!start || start.fingers > 1 || !many) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onGo(dx < 0 ? 1 : -1)
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose() // swipe down to close
  }

  const arrow = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-white/15 hover:bg-white/25 text-white p-3 backdrop-blur-sm'

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`${title} photos`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-white">
        <span className="text-sm font-semibold tabular-nums" aria-live="polite">
          {index + 1} / {photos.length}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/15 hover:bg-white/25 p-2"
          aria-label="Close photos"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div
        className="relative flex-1 min-h-0 flex items-center justify-center px-2"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
        <img
          key={photos[index]}
          src={photos[index]}
          alt={`${title}, photo ${index + 1} of ${photos.length}`}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />
        {many && (
          <>
            <button type="button" onClick={() => onGo(-1)} className={`${arrow} left-3`} aria-label="Previous photo">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button type="button" onClick={() => onGo(1)} className={`${arrow} right-3`} aria-label="Next photo">
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {many && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {photos.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => onPick(i)}
              className={`w-14 h-14 shrink-0 rounded-md overflow-hidden border-2 ${
                i === index ? 'border-white' : 'border-transparent opacity-50 hover:opacity-90'
              }`}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
