// components/MadeInCanada.tsx
// Maple leaf and a "Made in Canada" badge (About page). The leaf is a simple
// hand-drawn shape, not the official flag artwork.

export function MapleLeaf({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden fill="currentColor">
      <polygon points="50,2 57,17 66,12 62,37 77,26 80,34 93,31 87,47 95,51 76,63 79,71 54,67 53,90 47,90 46,67 21,71 24,63 5,51 13,47 7,31 20,34 23,26 38,37 34,12 43,17" />
    </svg>
  )
}

export function MadeInCanadaBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-2 border-[#D52B1E] bg-white px-4 py-1.5 text-sm font-extrabold uppercase tracking-wider text-[#D52B1E] ${className}`}
    >
      <MapleLeaf className="w-5 h-5" /> Made in Canada
    </span>
  )
}
