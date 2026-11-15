// app/orders/[id]/page.tsx
// One order, for its buyer and seller: arrange the meetup, then hand over.
import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SiteHeader } from '@/components/SiteHeader'
import { OrderView } from '@/components/orders/OrderView'

export default function OrderPage({ params }: PageProps<'/orders/[id]'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-6 pb-16">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-[#0E4D5C] hover:text-[#F26B5B] mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
        <Suspense fallback={<div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />}>
          {params.then(({ id }) => (
            <OrderView id={Number(id)} />
          ))}
        </Suspense>
      </main>
    </div>
  )
}
