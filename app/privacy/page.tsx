// app/privacy/page.tsx
// Privacy Policy. DRAFT for legal review: written against what the app
// actually collects (see docs/function-schema.md and the migrations), with
// placeholders in components/legal/LegalPage.tsx (LEGAL) for the operator's
// details. Keep it in step with the app when data handling changes.
import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LegalPage } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Blockparty collects, uses and protects your personal information.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <>
          <p>
            Blockparty is a local marketplace where neighbours buy, sell and bid on items and hand them over in person. This
            policy explains what personal information we collect, why, who we share it with, how long we keep it, and the
            choices and rights you have. Blockparty is operated by {LEGAL.operator} (&ldquo;Blockparty&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;).
          </p>
          <p>
            We handle personal information in line with Canada&apos;s <em>Personal Information Protection and Electronic
            Documents Act</em> (PIPEDA) and, where they apply, provincial privacy laws such as Alberta&apos;s and British
            Columbia&apos;s <em>Personal Information Protection Act</em> and Quebec&apos;s <em>Law 25</em>. By using
            Blockparty you agree to this policy and to our <Link href="/terms">Terms of Use</Link>.
          </p>
        </>
      }
      sections={[
        {
          id: 'collect',
          title: 'Information we collect',
          body: (
            <>
              <h3>Information you give us</h3>
              <ul>
                <li>
                  <strong>Account details:</strong> email address, password (stored only as a secure hash by our
                  authentication provider), username, full name, phone number (so we can reach you about an order or a
                  safety concern), and optionally a profile photo. If you sign in with Google, we receive your name and email
                  address from Google.
                </li>
                <li>
                  <strong>Location and addresses:</strong> your neighbourhood (area), and if you choose to offer home pickup
                  or delivery, your home address.
                </li>
                <li>
                  <strong>Emergency contact:</strong> if you add one, their name and email address. See &ldquo;Safety
                  features&rdquo; below.
                </li>
                <li>
                  <strong>Listings:</strong> titles, descriptions, photos, prices, condition, category, and how you&apos;ll
                  hand the item over.
                </li>
                <li>
                  <strong>Activity on the marketplace:</strong> bids, purchases, questions and answers on listings, messages
                  with the other party to an order, meetup proposals, reviews, reports and blocks, saved searches, and items
                  you watch.
                </li>
                <li>
                  <strong>Charity applications:</strong> the charity&apos;s registration number, name, description and
                  website, and the contact person&apos;s name, role, phone and email.
                </li>
                <li>
                  <strong>Feedback:</strong> comments you send us, including notes left with the feedback tool on test
                  versions of the site.
                </li>
              </ul>

              <h3>Payment and payout information</h3>
              <p>
                Payments are processed by <strong>Stripe</strong>. Your card number is entered directly into Stripe&apos;s
                secure form and never reaches our servers. We keep only the identifiers Stripe gives us (for example, a
                customer ID and a saved payment method ID) and the amounts and status of your orders. Sellers set up payouts
                through Stripe, which collects the identity and bank details it needs to verify you and pay you; we see only
                whether your payout account is ready.
              </p>

              <h3>Information collected automatically</h3>
              <ul>
                <li>
                  <strong>Usage information:</strong> the listings you view and the searches and filters you use on Browse,
                  with the time and the page you came from. If you aren&apos;t signed in, this is linked to a random
                  identifier stored in your browser; when you sign in, it&apos;s linked to your account.
                </li>
                <li>
                  <strong>Handoff location:</strong> when a seller enters the buyer&apos;s handoff code to complete a sale,
                  we may record the device&apos;s approximate GPS location at that moment, if your browser allows it. See
                  &ldquo;Safety features&rdquo;.
                </li>
                <li>
                  <strong>Technical information:</strong> IP address, browser and device type, and error reports, collected
                  by our hosting provider to keep the service running and secure.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'use',
          title: 'How we use your information',
          body: (
            <ul>
              <li>To create and secure your account, and to let you sign in.</li>
              <li>
                To run the marketplace: show listings, run auctions, place card holds, charge buyers at the handoff, pay
                sellers, and arrange meetups, pickups and deliveries.
              </li>
              <li>
                To send you messages about your activity: order updates, outbid alerts, saved-search matches, watchlist
                changes, review requests and account notices. You can turn off the optional emails on your profile.
              </li>
              <li>
                To keep people safe and the marketplace fair: check listings before they go live (including with automated
                tools), handle reports, enforce blocks and no-show strikes, and investigate fraud or misuse.
              </li>
              <li>
                To improve Blockparty: understand which features are used, fix problems, and, in the future, suggest
                listings you may be interested in based on what you view, search for and buy.
              </li>
              <li>To meet legal, tax and accounting obligations, and to establish or defend legal claims.</li>
            </ul>
          ),
        },
        {
          id: 'public',
          title: 'What other people can see',
          body: (
            <>
              <ul>
                <li>
                  <strong>Anyone</strong> can see your username, profile photo, the month you joined, your rating and
                  reviews, your number of sales and purchases, your active listings, and questions and answers on listings.
                </li>
                <li>
                  <strong>Bids</strong> are shown anonymously (&ldquo;Bidder 1&rdquo;, &ldquo;Bidder 2&rdquo;); bids in
                  charity silent auctions are hidden from other bidders.
                </li>
                <li>
                  <strong>The other party to an order</strong> sees your username, your messages, and the meetup details.
                  For home pickup or delivery, the address is shown only to the two of you, and only once the buyer&apos;s
                  card hold has gone through.
                </li>
              </ul>
              <p>
                We never show your email address, phone number, full name or emergency contact to other members.
              </p>
            </>
          ),
        },
        {
          id: 'safety',
          title: 'Safety features',
          body: (
            <>
              <p>
                <strong>Emergency contact.</strong> If you add an emergency contact, we email them when you agree a meetup
                time (with the time and place), and again when the handoff is completed or cancelled. Please tell your
                contact before adding them. They can ignore or stop these emails at any time by asking you to remove them,
                or by contacting us.
              </p>
              <p>
                <strong>Handoff location.</strong> The location recorded at a handoff is visible only to Blockparty
                administrators, is used only to look into a reported problem with that handoff, and is deleted
                automatically after 90 days.
              </p>
            </>
          ),
        },
        {
          id: 'share',
          title: 'Who we share information with',
          body: (
            <>
              <p>We don&apos;t sell your personal information. We share it only as follows:</p>
              <ul>
                <li>
                  <strong>Other members</strong>, as described in &ldquo;What other people can see&rdquo;.
                </li>
                <li>
                  <strong>Service providers</strong> who process information on our behalf and under contract:
                  <ul>
                    <li>Supabase: database, authentication and file storage.</li>
                    <li>Vercel: website hosting and error logs.</li>
                    <li>Stripe: card payments, seller identity verification and payouts.</li>
                    <li>Resend: sending email.</li>
                    <li>Anthropic: automated review of listing text and photos before they go live.</li>
                    <li>Google: sign-in, if you choose &ldquo;Continue with Google&rdquo;.</li>
                  </ul>
                </li>
                <li>
                  <strong>Legal and safety:</strong> law enforcement or other authorities when required by law, or when we
                  believe in good faith that it&apos;s necessary to prevent harm, fraud or illegal activity.
                </li>
                <li>
                  <strong>Business transfers:</strong> a buyer or successor if Blockparty is reorganized, merged or sold,
                  subject to this policy.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'transfers',
          title: 'Where your information is stored',
          body: (
            <p>
              Our service providers store and process information in the United States and possibly other countries.
              Information stored outside Canada is subject to the laws of those countries and may be accessible to their
              courts, law enforcement and national security authorities. We choose providers with strong security and
              contractual protections.
            </p>
          ),
        },
        {
          id: 'retention',
          title: 'How long we keep information',
          body: (
            <ul>
              <li>
                <strong>Account information:</strong> while your account is open. After you close it, we delete or
                anonymize it within a reasonable time, except as below.
              </li>
              <li>
                <strong>Orders, payments and payouts:</strong> as long as tax and accounting laws require (generally 6
                years in Canada).
              </li>
              <li>
                <strong>Viewing and search history:</strong> up to 400 days, then deleted automatically.
              </li>
              <li>
                <strong>Handoff location:</strong> 90 days, then deleted automatically.
              </li>
              <li>
                <strong>No-show strikes:</strong> active for 90 days; kept afterwards as a record.
              </li>
              <li>
                <strong>Reports, blocks and safety records:</strong> as long as needed to keep the marketplace safe and to
                handle disputes.
              </li>
            </ul>
          ),
        },
        {
          id: 'cookies',
          title: 'Cookies and similar technologies',
          body: (
            <p>
              We use cookies that are needed to keep you signed in, and your browser&apos;s local storage to remember things
              like a random identifier for your browsing history and where you came from within the site. We don&apos;t use
              advertising cookies or third-party ad trackers. Stripe sets its own cookies on its payment forms to prevent
              fraud. Blocking cookies may stop you from signing in.
            </p>
          ),
        },
        {
          id: 'security',
          title: 'How we protect information',
          body: (
            <p>
              We use encryption in transit, access controls that limit each person to their own data, secure password
              hashing, and payment processing that keeps card details off our servers. No system is perfectly secure; if a
              breach creates a real risk of significant harm, we&apos;ll notify you and the Privacy Commissioner of Canada as
              the law requires.
            </p>
          ),
        },
        {
          id: 'rights',
          title: 'Your choices and rights',
          body: (
            <>
              <p>You can:</p>
              <ul>
                <li>See and update most of your information on your profile.</li>
                <li>Turn off optional emails (outbid, watchlist and saved-search alerts) on your profile.</li>
                <li>Remove your emergency contact, home address or profile photo at any time.</li>
                <li>Block a member, or report a listing, question or member.</li>
                <li>
                  Ask us for a copy of the personal information we hold about you, to correct it, or to delete your
                  account, by emailing {LEGAL.privacyEmail}. We&apos;ll respond within 30 days.
                </li>
                <li>Withdraw consent to optional uses, subject to legal and contractual limits.</li>
              </ul>
              <p>
                If you&apos;re not satisfied with our response, you can complain to the Office of the Privacy Commissioner of
                Canada or your provincial privacy commissioner.
              </p>
            </>
          ),
        },
        {
          id: 'age',
          title: 'Age',
          body: <p>Blockparty is for adults. You must be at least 18 to use it, and we don&apos;t knowingly collect information from anyone younger.</p>,
        },
        {
          id: 'changes',
          title: 'Changes to this policy',
          body: (
            <p>
              We&apos;ll update this policy as Blockparty changes. If we make a significant change, we&apos;ll let you know by
              email or on the site before it takes effect. The effective date at the top shows the latest version.
            </p>
          ),
        },
        {
          id: 'contact',
          title: 'Contact us',
          body: (
            <p>
              Our privacy officer can be reached at {LEGAL.privacyEmail}, or by mail at {LEGAL.operator}, {LEGAL.address}.
            </p>
          ),
        },
      ]}
    />
  )
}
