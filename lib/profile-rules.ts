// lib/profile-rules.ts
// Checks and wording shared by sign-up, the welcome step and the profile page.

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** North American numbers: 10 digits, or 11 starting with 1. Formatting is kept as typed. */
export function phoneProblem(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return 'Enter your phone number.'
  if (phone.length > 30 || !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) {
    return 'Enter a 10-digit phone number, like 403-555-0123.'
  }
  return null
}

export type OptionalDetails = { homeAddress: string; ecName: string; ecEmail: string }

/** Problems with the optional fields (blank is always fine). */
export function optionalDetailsProblem({ homeAddress, ecName, ecEmail }: OptionalDetails): string | null {
  if (homeAddress && (homeAddress.length < 5 || homeAddress.length > 200)) {
    return 'Enter your full street address, or leave it blank.'
  }
  if (ecName.length > 100) return "Your trusted contact's name is too long."
  if (ecEmail && (ecEmail.length > 254 || !EMAIL_RE.test(ecEmail))) return "Check your trusted contact's email address."
  if (ecName && !ecEmail) return "Add your trusted contact's email address."
  return null
}

export const WHY = {
  area: 'Used to suggest meetup spots that are fair to you and the other person.',
  phone: 'Private. Only used by Blockparty to reach you about an order or a safety concern; never shown to other members.',
  address:
    "Needed only if you offer pickup at your home, or want items delivered to you. It's shown only to the other person in that order, once their payment is on hold, and hidden again when the order closes.",
  emergency:
    "Someone who'd like to know where you are. We'll email them to ask if they agree. Once they do, whenever you agree on a meetup time we email them where you're going and when, and again when it's done or cancelled.",
  payment:
    "Needed to bid or buy. Adding it now means you can bid the moment you find something. We only place a hold when you win or buy, and you're only charged after you meet the seller and accept the item.",
}
