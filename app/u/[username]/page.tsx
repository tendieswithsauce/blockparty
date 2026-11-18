// app/u/[username]/page.tsx
// Public profile: display name, rating, completed trades, published reviews.
// Only public facts: no real name, email or area.
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { SiteHeader } from '@/components/SiteHeader'
import { RatingSummary, Stars } from '@/components/Stars'
import { Avatar } from '@/components/Avatar'
import { SafetyMenu } from '@/components/SafetyMenu'
import { createAdminClient } from '@/lib/supabase/admin'

export default function ProfilePage({ params }: PageProps<'/u/[username]'>) {
  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#1E293B]">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 md:px-6 pb-16">
        <Suspense fallback={<div className="h-64 rounded-2xl bg-slate-200 animate-pulse" />}>
          {params.then(({ username }) => (
            <ProfileContent username={decodeURIComponent(username)} />
          ))}
        </Suspense>
      </main>
    </div>
  )
}

async function ProfileContent({ username }: { username: string }) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) notFound()
  await connection()
  const supabase = await createClient()
  const [{ data: profiles }, { data: reviews }] = await Promise.all([
    supabase.rpc('public_profile', { p_username: username }),
    supabase.rpc('profile_reviews', { p_username: username, p_limit: 20 }),
  ])
  const profile = profiles?.[0]
  if (!profile) notFound()

  // Profiles are private; only the id is needed, for report / block.
  const { data: owner } = await createAdminClient().from('profiles').select('id').eq('username', profile.username).maybeSingle()

  const since = new Date(profile.member_since).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      <section className="bg-white border rounded-2xl p-6 shadow-sm flex flex-wrap items-center gap-5">
        <Avatar path={profile.avatar_path} name={profile.username} size="lg" />
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-extrabold">{profile.username}</h1>
            {owner && <SafetyMenu userId={owner.id} username={profile.username} loginNext={`/u/${profile.username}`} />}
          </div>
          <p className="text-sm text-slate-500">Member since {since}</p>
          <p className="text-sm mt-1">
            <RatingSummary rating={profile.rating} count={profile.review_count} />
          </p>
        </div>
        <dl className="flex gap-6 text-center">
          <div>
            <dt className="text-xs text-slate-500">Sold</dt>
            <dd className="text-2xl font-extrabold text-[#0E4D5C]">{profile.sales}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Bought</dt>
            <dd className="text-2xl font-extrabold text-[#0E4D5C]">{profile.purchases}</dd>
          </div>
        </dl>
      </section>

      <section className="bg-white border rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold mb-4">Reviews</h2>
        {!reviews?.length ? (
          <p className="text-sm text-slate-500">
            No reviews yet. Reviews appear after a completed handoff, once both people have rated each other.
          </p>
        ) : (
          <ul className="divide-y">
            {reviews.map((r, i) => (
              <li key={i} className="py-4 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Stars rating={r.rating} />
                  <span className="font-semibold">{r.reviewer_name}</span>
                  <span className="text-slate-500">
                    {r.reviewer_role === 'buyer' ? 'bought' : 'sold'} {r.item_title} ·{' '}
                    {new Date(r.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {r.comment && <p className="text-slate-700 text-sm">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
