// components/BlockedMembers.tsx
// Members you've blocked, with Unblock (profile page).
'use client'

import { useCallback, useEffect, useState } from 'react'
import { Ban } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/Avatar'
import type { Database } from '@/lib/supabase/database.types'

type Blocked = Database['public']['Functions']['my_blocks']['Returns'][number]

export function BlockedMembers() {
  const [items, setItems] = useState<Blocked[] | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('my_blocks')
    setItems(data ?? [])
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  if (!items?.length) return null

  return (
    <section className="bg-white border rounded-2xl p-5 md:p-8 shadow-sm">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Ban className="w-5 h-5 text-slate-500" /> Blocked members
      </h2>
      <p className="text-sm text-slate-500 mb-3">You don&apos;t see each other&apos;s listings and can&apos;t trade with each other.</p>
      <ul className="divide-y">
        {items.map((b) => (
          <li key={b.user_id} className="py-3 flex items-center gap-3">
            <Avatar path={b.avatar_path} name={b.username} size="sm" />
            <span className="flex-1 font-medium">{b.username}</span>
            <button
              type="button"
              onClick={async () => {
                await createClient().from('user_blocks').delete().eq('blocked_id', b.user_id)
                load()
              }}
              className="text-sm font-semibold text-[#0E4D5C] underline"
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
