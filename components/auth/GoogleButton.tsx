// components/auth/GoogleButton.tsx
// Hidden unless NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true, so the button only appears
// once the Google provider is configured in Supabase (Auth > Providers).
import Link from 'next/link'
import { signInWithGoogle } from '@/app/auth/actions'
import { Divider } from '@/components/auth/fields'

export const googleAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true'

/**
 * showTerms: Google creates the account on first use, so wherever the sign-up
 * page's own consent line isn't shown (e.g. the sign-in page), show it here.
 */
export function GoogleButton({ next, showTerms = true }: { next?: string; showTerms?: boolean }) {
  if (!googleAuthEnabled) return null

  return (
    <>
      <form action={signInWithGoogle}>
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-full border-2 border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
          </svg>
          Continue with Google
        </button>
      </form>
      {showTerms && (
        <p className="text-xs text-slate-500 text-center -mt-2">
          New here? Continuing with Google creates your account, and confirms you&apos;re 18 or older and agree to the{' '}
          <Link href="/terms" className="underline">
            Terms of Use
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      )}
      <Divider label="Or with email" />
    </>
  )
}
