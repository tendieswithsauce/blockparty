// components/legal/LegalPage.tsx
// Shared layout for the privacy policy and terms of use: header, a
// draft notice while the documents are under legal review, a table of
// contents, and readable long-form typography.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'

/** Set to false once the documents have been reviewed and the placeholders filled in. */
export const LEGAL_DRAFT = true

/** Shown on both documents; fill in before launch. */
export const LEGAL = {
  operator: '[OPERATOR LEGAL NAME]',
  address: '[MAILING ADDRESS]',
  privacyEmail: '[PRIVACY CONTACT EMAIL]',
  supportEmail: '[SUPPORT EMAIL]',
  province: '[PROVINCE]',
  effective: '[EFFECTIVE DATE]',
}

export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string
  intro: ReactNode
  sections: { id: string; title: string; body: ReactNode }[]
}) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B] flex flex-col">
      <SiteHeader />
      <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-8 md:py-12">
        {LEGAL_DRAFT && (
          <p className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Draft for legal review. Bracketed items are placeholders and this document is not yet in effect.
          </p>
        )}
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-[#0E4D5C]">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Effective {LEGAL.effective}</p>
        <div className="legal-prose mt-6">{intro}</div>

        <nav aria-label="Contents" className="mt-8 rounded-2xl border bg-white p-5">
          <p className="text-sm font-bold text-[#0E4D5C] mb-2">Contents</p>
          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm list-decimal list-inside">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-slate-700 hover:text-[#F26B5B] underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="legal-prose mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2>
                {i + 1}. {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </div>

        <p className="mt-12 text-sm text-slate-500">
          See also the <Link href="/terms" className="underline">Terms of Use</Link> and the{' '}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </main>
      <SiteFooter />
    </div>
  )
}
