// components/listing/ShareButton.tsx
// Share a listing: WhatsApp, Messenger, text message, email, Facebook, copy
// link, or the phone's own share sheet.
'use client'

import { useState } from 'react'
import { Check, Copy, Mail, MessageCircle, MessageSquareText, Share2, X } from 'lucide-react'

type Target = { label: string; href: string; icon: React.ReactNode; className: string }

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
      <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4C2.7 15.6 2.2 13.8 2.2 12 2.2 6.6 6.6 2.2 12 2.2c2.6 0 5.1 1 6.9 2.9 1.8 1.8 2.9 4.3 2.9 6.9 0 5.4-4.4 9.8-9.8 9.8zM20.5 3.5C18.2 1.2 15.2 0 12 0 5.4 0 0 5.4 0 12c0 2.1.6 4.2 1.6 6L0 24l6.2-1.6c1.8 1 3.8 1.5 5.8 1.5 6.6 0 12-5.4 12-12 0-3.2-1.2-6.2-3.5-8.4z" />
    </svg>
  )
}

export function ShareButton({ listingId, title }: { listingId: number; title: string }) {
  const [targets, setTargets] = useState<Target[] | null>(null)
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  function open() {
    const link = `${window.location.origin}/listings/${listingId}`
    const text = `Check out "${title}" on Blockparty`
    const msg = encodeURIComponent(`${text}: ${link}`)
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    setUrl(link)
    setCopied(false)
    setTargets([
      {
        label: 'WhatsApp',
        href: `https://wa.me/?text=${msg}`,
        icon: <WhatsAppIcon />,
        className: 'bg-[#25D366] text-white',
      },
      ...(phone
        ? [
            {
              label: 'Messenger',
              href: `fb-messenger://share/?link=${encodeURIComponent(link)}`,
              icon: <MessageCircle className="w-5 h-5" />,
              className: 'bg-[#0084FF] text-white',
            },
            {
              label: 'Text',
              href: `sms:?&body=${msg}`,
              icon: <MessageSquareText className="w-5 h-5" />,
              className: 'bg-[#34C759] text-white',
            },
          ]
        : [
            {
              label: 'Facebook',
              href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
              icon: <span className="font-black text-lg leading-none">f</span>,
              className: 'bg-[#1877F2] text-white',
            },
          ]),
      {
        label: 'Email',
        href: `mailto:?subject=${encodeURIComponent(text)}&body=${msg}`,
        icon: <Mail className="w-5 h-5" />,
        className: 'bg-slate-600 text-white',
      },
    ])
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url })
      setTargets(null)
    } catch {
      // Cancelled: keep the sheet open.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-semibold text-[#0E4D5C] hover:bg-[#0E4D5C]/5"
      >
        <Share2 className="w-4 h-4" /> Share
      </button>

      {targets && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setTargets(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share this listing"
            className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="font-bold">Share this listing</p>
              <button type="button" onClick={() => setTargets(null)} className="p-1 rounded-full hover:bg-slate-100" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {targets.map((t) => (
                <a
                  key={t.label}
                  href={t.href}
                  target={t.href.startsWith('http') ? '_blank' : undefined}
                  rel="noreferrer noopener"
                  onClick={() => setTimeout(() => setTargets(null), 300)}
                  className="flex flex-col items-center gap-1.5 text-xs font-semibold text-slate-700"
                >
                  <span className={`w-12 h-12 rounded-full flex items-center justify-center ${t.className}`}>{t.icon}</span>
                  {t.label}
                </a>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copy}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full border-2 border-[#0E4D5C] text-[#0E4D5C] font-semibold"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={nativeShare}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-full bg-[#0E4D5C] text-white font-semibold"
                >
                  <Share2 className="w-4 h-4" /> More
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
