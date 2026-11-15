// components/listing/PhotoGallery.tsx
'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'

export function PhotoGallery({ photos, title }: { photos: string[]; title: string }) {
  const [index, setIndex] = useState(0)

  if (photos.length === 0) {
    return (
      <div className="aspect-[4/3] rounded-2xl bg-slate-100 flex flex-col items-center justify-center text-slate-400">
        <ImageOff className="w-10 h-10 mb-2" /> No photos
      </div>
    )
  }

  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length)

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 border">
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL */}
        <img src={photos[index]} alt={`${title}, photo ${index + 1} of ${photos.length}`} className="w-full h-full object-contain" />
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
            <span className="absolute bottom-3 right-3 text-xs font-semibold bg-black/60 text-white px-2 py-1 rounded-full">
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
    </div>
  )
}
