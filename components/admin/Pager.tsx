// components/admin/Pager.tsx
// "Showing 26–50 of 132" with previous / next and a few page numbers.
'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  /** 0-based. */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)

  // First, last, and two either side of the current page.
  const shown = [...new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b)

  const btn = 'min-w-9 h-9 px-2 rounded-full text-sm font-semibold border disabled:opacity-40'
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        Showing {from}–{to} of {total}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={page === 0}
            className={`${btn} border-slate-300 text-slate-600`}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4 mx-auto" />
          </button>
          {shown.map((p, i) => (
            <span key={p} className="flex items-center gap-1">
              {i > 0 && p - shown[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
              <button
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`${btn} ${p === page ? 'bg-[#0E4D5C] text-white border-[#0E4D5C]' : 'border-slate-300 text-slate-600'}`}
              >
                {p + 1}
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={page >= pages - 1}
            className={`${btn} border-slate-300 text-slate-600`}
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4 mx-auto" />
          </button>
        </div>
      )}
    </nav>
  )
}
