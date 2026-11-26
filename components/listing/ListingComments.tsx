// components/listing/ListingComments.tsx
// Public comments under a listing (separate from Q&A, which is questions to
// the seller). Anyone can read; signed-in members post and reply (one level);
// the seller's comments carry a "Seller" badge. No phone numbers, emails or
// links (checked in the database), so deals stay on Blockparty. Anyone can
// report a comment; authors can delete their own.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MessagesSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ReportDialog, type ReportTarget } from '@/components/ReportDialog'
import type { Database } from '@/lib/supabase/database.types'

type Comment = Database['public']['Functions']['listing_comments_for']['Returns'][number]

function when(iso: string) {
  return new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const textarea =
  'w-full border border-slate-300 rounded-xl px-3 py-2 text-base bg-white focus:outline-none focus:ring-2 focus:ring-[#0E4D5C]'

export function ListingComments({ listingId, open }: { listingId: number; open: boolean }) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [replyTo, setReplyTo] = useState<number | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: auth }, { data }] = await Promise.all([
      supabase.auth.getUser().catch(() => ({ data: { user: null } })),
      supabase.rpc('listing_comments_for', { p_listing_id: listingId }),
    ])
    setUserId(auth.user?.id ?? null)
    setComments(data ?? [])
  }, [listingId])

  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  const threads = useMemo(() => {
    const top = (comments ?? []).filter((c) => c.parent_id === null)
    return top.map((c) => ({ comment: c, replies: (comments ?? []).filter((r) => r.parent_id === c.id) }))
  }, [comments])

  const signedIn = !!userId
  const actions = (c: Comment) => (
    <div className="flex gap-4 text-xs">
      {open && signedIn && (
        <button type="button" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)} className="font-semibold text-[#0E4D5C] underline">
          Reply
        </button>
      )}
      {c.mine ? (
        <DeleteButton id={c.id} onDone={load} />
      ) : (
        signedIn && (
          <button
            type="button"
            onClick={() => setReport({ type: 'comment', commentId: c.id, label: 'this comment' })}
            className="text-slate-500 hover:text-red-600 underline"
          >
            Report
          </button>
        )
      )}
    </div>
  )

  return (
    <section id="comments" className="scroll-mt-24 space-y-4">
      {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
      <h2 className="font-bold flex items-center gap-2">
        <MessagesSquare className="w-5 h-5 text-[#0E4D5C]" /> Comments{comments && comments.length > 0 && ` (${comments.length})`}
      </h2>

      {comments === null ? (
        <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
      ) : (
        <>
          {threads.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
          <ul className="space-y-3">
            {threads.map(({ comment: c, replies }) => (
              <li key={c.id} className="rounded-xl bg-white border p-4 text-sm space-y-3">
                <CommentBody c={c} />
                {actions(c)}
                {replies.length > 0 && (
                  <ul className="space-y-3 pl-4 border-l-2 border-slate-200">
                    {replies.map((r) => (
                      <li key={r.id} className="space-y-1.5">
                        <CommentBody c={r} />
                        {actions(r)}
                      </li>
                    ))}
                  </ul>
                )}
                {replyTo === c.id && (
                  <CommentForm
                    listingId={listingId}
                    parentId={c.id}
                    placeholder={`Reply to ${c.mine ? 'this thread' : c.author_name}`}
                    onDone={() => {
                      setReplyTo(null)
                      load()
                    }}
                  />
                )}
              </li>
            ))}
          </ul>

          {open &&
            userId !== undefined &&
            (userId === null ? (
              <p className="text-sm">
                <Link
                  href={`/login?next=${encodeURIComponent(`/listings/${listingId}#comments`)}`}
                  className="font-semibold text-[#0E4D5C] underline"
                >
                  Sign in
                </Link>{' '}
                to comment.
              </p>
            ) : (
              <CommentForm listingId={listingId} parentId={null} placeholder="Add a comment" onDone={load} />
            ))}
        </>
      )}
    </section>
  )
}

function CommentBody({ c }: { c: Comment }) {
  return (
    <div>
      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <span className="font-semibold text-slate-700">{c.mine ? 'You' : c.author_name}</span>
        {c.is_seller && (
          <span className="px-1.5 py-0.5 rounded-full bg-[#0E4D5C] text-white text-[10px] font-bold uppercase tracking-wide">Seller</span>
        )}
        <span>· {when(c.created_at)}</span>
      </p>
      <p className="mt-1 whitespace-pre-line break-words">{c.body}</p>
    </div>
  )
}

function CommentForm({
  listingId,
  parentId,
  placeholder,
  onDone,
}: {
  listingId: number
  parentId: number | null
  placeholder: string
  onDone: () => void
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (draft.trim().length < 2) return setError('Write a little more.')
    setBusy(true)
    const { error: rpcError } = await createClient().rpc('post_listing_comment', {
      p_listing_id: listingId,
      p_body: draft,
      p_parent_id: parentId,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.code === 'P0001' ? `${rpcError.message}.` : 'Something went wrong. Please try again.')
    setDraft('')
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        aria-label={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder={placeholder}
        className={textarea}
      />
      {parentId === null && (
        <p className="text-xs text-slate-500">
          Comments are public. No phone numbers, emails or links: buy, pay and arrange the handoff through Blockparty.
        </p>
      )}
      {error && <div className="p-3 rounded-xl text-sm bg-red-50 text-red-700">{error}</div>}
      <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-full bg-[#0E4D5C] text-white text-sm font-bold disabled:opacity-60">
        {busy ? 'Posting…' : parentId === null ? 'Post comment' : 'Post reply'}
      </button>
    </form>
  )
}

function DeleteButton({ id, onDone }: { id: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await createClient().rpc('delete_listing_comment', { p_comment_id: id })
        setBusy(false)
        onDone()
      }}
      className="text-slate-500 hover:text-red-600 underline"
    >
      {busy ? '…' : 'Delete'}
    </button>
  )
}
