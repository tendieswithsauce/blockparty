// components/auth/AuthShell.tsx
import type { ReactNode } from 'react'
import { BrandLogo } from '@/components/BrandLogo'

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] flex flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <BrandLogo size="lg" />
      </div>
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="mt-6 text-sm text-slate-600 text-center">{footer}</div>}
    </div>
  )
}
