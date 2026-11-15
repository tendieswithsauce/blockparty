'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/redirect'

export type AuthFormState = {
  error?: string
  message?: string
}

const MIN_PASSWORD_LENGTH = 8

/** Absolute site origin for links in auth emails and OAuth redirects. */
async function siteUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

// ---------------------------------------------------------------------------
// Email + password sign-in
// ---------------------------------------------------------------------------
export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = field(formData, 'email')
  const password = formData.get('password')
  const next = safeNextPath(formData.get('next'))

  if (!email || typeof password !== 'string' || !password) {
    return { error: 'Enter your email and password.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    if (error.code === 'email_not_confirmed') {
      return { error: 'Please confirm your email first. Check your inbox for the link.' }
    }
    return { error: 'Incorrect email or password.' }
  }

  redirect(next)
}

// ---------------------------------------------------------------------------
// Email + password sign-up
// ---------------------------------------------------------------------------
export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const fullName = field(formData, 'full_name')
  const email = field(formData, 'email')
  const password = formData.get('password')

  if (!fullName) return { error: 'Enter your name.' }
  if (!email) return { error: 'Enter your email.' }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Picked up by the handle_new_user() trigger into profiles.full_name.
      data: { full_name: fullName },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=/profile`,
    },
  })

  if (error) {
    if (error.code === 'weak_password') return { error: error.message }
    if (error.code === 'over_email_send_rate_limit') {
      return { error: 'Too many sign-up attempts. Please wait a few minutes and try again.' }
    }
    return { error: 'Could not create your account. Please try again.' }
  }

  // Email confirmation turned off in Supabase: the user is signed in already.
  if (data.session) redirect('/profile')

  // Supabase answers a sign-up for an email that already has an account with a
  // fake success (a user with no identities) and sends no email.
  if (data.user && data.user.identities?.length === 0) {
    return { error: 'An account with this email already exists. Sign in, or reset your password if you forgot it.' }
  }

  return {
    message: `Almost there! We sent a confirmation link to ${email}. Open it to activate your account.`,
  }
}

// ---------------------------------------------------------------------------
// Google OAuth (sign-in and sign-up are the same flow)
// ---------------------------------------------------------------------------
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get('next'))
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent('Google sign-in is unavailable right now.')}`)
  }

  redirect(data.url)
}

// ---------------------------------------------------------------------------
// Forgot password: email a reset link
// ---------------------------------------------------------------------------
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = field(formData, 'email')
  if (!email) return { error: 'Enter your email.' }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  })

  if (error?.code === 'over_email_send_rate_limit') {
    return { error: 'Too many requests. Please wait a few minutes and try again.' }
  }

  // Same message whether or not the account exists, so emails can't be probed.
  return { message: `If an account exists for ${email}, a reset link is on its way.` }
}

// ---------------------------------------------------------------------------
// Set a new password (user arrives signed in from the reset link)
// ---------------------------------------------------------------------------
export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const password = formData.get('password')
  const confirm = formData.get('confirm_password')

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (password !== confirm) return { error: 'Passwords do not match.' }

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) {
    redirect('/login?error=' + encodeURIComponent('Your reset link expired. Request a new one.'))
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') {
      return { error: 'Choose a password different from your current one.' }
    }
    if (error.code === 'weak_password') return { error: error.message }
    return { error: 'Could not update your password. Please try again.' }
  }

  redirect('/dashboard')
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
