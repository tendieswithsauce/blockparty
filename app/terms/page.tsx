// app/terms/page.tsx
// Terms of Use. DRAFT for legal review: the marketplace rules here mirror
// what the app enforces (lib/fees.ts, lib/purchase-rules.ts, lib/handoff.ts,
// the strike and review rules in the database). Keep them in step when those
// rules change. Placeholders live in components/legal/LegalPage.tsx (LEGAL).
import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LegalPage } from '@/components/legal/LegalPage'
import { MIN_PLATFORM_FEE_CENTS, MIN_PRICE_CENTS, PLATFORM_FEE_BPS } from '@/lib/fees'
import { MAX_PRICE_CENTS, formatCents } from '@/lib/money'
import { BUY_NOW_CANCEL_WINDOW_SECONDS } from '@/lib/purchase-rules'
import { HANDOFF_WINDOW_DAYS } from '@/lib/handoff'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The rules for buying, selling and bidding on Blockparty.',
}

const FEE = `${PLATFORM_FEE_BPS / 100}% of the item price (minimum ${formatCents(MIN_PLATFORM_FEE_CENTS)})`
const UNDO_MINUTES = BUY_NOW_CANCEL_WINDOW_SECONDS / 60

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={
        <>
          <p>
            These terms are an agreement between you and {LEGAL.operator} (&ldquo;Blockparty&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;) and govern your use of the Blockparty website and services. By creating an account or using
            Blockparty, you agree to them and to our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree,
            please don&apos;t use Blockparty.
          </p>
        </>
      }
      sections={[
        {
          id: 'what',
          title: 'What Blockparty is',
          body: (
            <>
              <p>
                Blockparty is a local marketplace that connects people who want to buy, sell and bid on items and hand them
                over in person. We provide the platform, the payment flow and safety tools.
              </p>
              <p>
                <strong>We are not a party to the sale.</strong> The contract for each item is between the buyer and the
                seller. We don&apos;t own, inspect, store or ship items, and we don&apos;t guarantee their quality, safety,
                legality or that they match the listing. Sellers are responsible for what they list; buyers are responsible
                for checking an item before completing the handoff.
              </p>
            </>
          ),
        },
        {
          id: 'eligibility',
          title: 'Who can use Blockparty',
          body: (
            <ul>
              <li>You must be at least 18 and able to enter into a binding contract.</li>
              <li>You must live in an area Blockparty serves.</li>
              <li>
                You may have only one account, must keep your information accurate, and are responsible for everything done
                with it. Keep your password secure and tell us if you think someone else has used your account.
              </li>
              <li>You may not use Blockparty if we&apos;ve previously suspended or closed your account.</li>
            </ul>
          ),
        },
        {
          id: 'listing',
          title: 'Listing items',
          body: (
            <>
              <ul>
                <li>
                  To sell, you must first set up payouts with Stripe, our payment provider, and agree to Stripe&apos;s
                  Connected Account Agreement.
                </li>
                <li>
                  You may list only items you own and have the right to sell, located in your area, priced from{' '}
                  {formatCents(MIN_PRICE_CENTS)} to {formatCents(MAX_PRICE_CENTS)}.
                </li>
                <li>
                  Listings must be accurate and honest: describe the condition and any defects, and use your own photos of
                  the actual item.
                </li>
                <li>
                  Listings are checked before they go live, which may include automated review, and may be held for a
                  person to look at. We may decline or remove any listing.
                </li>
                <li>
                  Once anyone has bid on your auction, it can no longer be changed or taken down, so be sure before you
                  list.
                </li>
              </ul>
              <h3>Items you can&apos;t list</h3>
              <ul>
                <li>
                  Weapons, ammunition, replica or airsoft guns, knives sold as weapons, explosives, fireworks, pepper spray
                  and tasers.
                </li>
                <li>Drugs, cannabis, paraphernalia, prescription or controlled medication.</li>
                <li>Alcohol, tobacco, vapes and nicotine products.</li>
                <li>Live animals.</li>
                <li>Counterfeit, replica-branded, stolen or recalled goods; used car seats and cribs.</li>
                <li>Adult or sexual products or content.</li>
                <li>Hazardous materials.</li>
                <li>Gift cards, tickets, digital accounts, subscriptions, currency or cryptocurrency.</li>
                <li>Services, jobs, rentals or real estate.</li>
                <li>Anything illegal, or anything that promotes hate, violence or harassment.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'buying',
          title: 'Buying',
          body: (
            <>
              <ul>
                <li>
                  You need a saved payment card to buy or bid. When you buy an item, we place a <strong>hold</strong> on
                  your card for the price plus any delivery fee. <strong>You aren&apos;t charged until the handoff.</strong>
                </li>
                <li>
                  After a Buy Now purchase, you have {UNDO_MINUTES} minutes to undo it, and the hold is released. After that,
                  the purchase is confirmed and the seller is told.
                </li>
                <li>
                  At the handoff, inspect the item. If it&apos;s as described, show the seller your handoff code. When the
                  seller enters it, your card is charged and the sale is complete.{' '}
                  <strong>Don&apos;t share your code until you&apos;re satisfied</strong>; once it&apos;s used, the sale is
                  final between you and the seller.
                </li>
                <li>
                  If the item isn&apos;t as described, don&apos;t share your code: cancel the order instead, and the hold is
                  released.
                </li>
                <li>
                  The handoff must happen within {HANDOFF_WINDOW_DAYS} days of the hold. If it doesn&apos;t, the order is
                  cancelled automatically and the hold is released.
                </li>
                <li>Buyers pay no Blockparty fees. Delivery, if chosen, costs the fee the seller set, and goes to the seller.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'auctions',
          title: 'Auctions',
          body: (
            <ul>
              <li>
                <strong>Bids are binding.</strong> If you win, you&apos;re committed to buy at your bid, and we&apos;ll place
                a hold on your saved card when the auction ends.
              </li>
              <li>A bid placed in the last 2 minutes extends the auction by 2 minutes, so everyone has a fair chance to respond.</li>
              <li>If an auction has a reserve price and the reserve isn&apos;t met, there&apos;s no sale.</li>
              <li>
                If the winning bidder&apos;s card can&apos;t be held, or they back out of the order, the item may go to the
                next-highest bidder who met the reserve, at their bid. Your bid stays binding until the auction is settled.
              </li>
              <li>In charity silent auctions, bids are hidden; the highest bid wins.</li>
              <li>
                Don&apos;t bid on your own items, ask others to, or otherwise manipulate an auction (&ldquo;shill
                bidding&rdquo;).
              </li>
            </ul>
          ),
        },
        {
          id: 'fees',
          title: 'Fees and payouts',
          body: (
            <ul>
              <li>
                Sellers pay a fee of {FEE}, deducted from the payout. The fee doesn&apos;t apply to delivery fees.
              </li>
              <li>
                Approved registered charities may sell without the fee up to a yearly allowance that we set. Beyond it, the
                standard fee applies.
              </li>
              <li>
                After a completed handoff, the seller&apos;s share is sent to their Stripe account and paid out to their bank
                on Stripe&apos;s schedule. We may hold or reverse a payout to deal with fraud, a chargeback or a breach of
                these terms.
              </li>
              <li>
                Payments are processed by Stripe and are subject to Stripe&apos;s terms. You&apos;re responsible for any taxes
                that apply to your sales.
              </li>
              <li>We may change our fees with notice. Changes don&apos;t affect sales already made.</li>
            </ul>
          ),
        },
        {
          id: 'handoffs',
          title: 'Meetups, pickups and deliveries',
          body: (
            <>
              <ul>
                <li>
                  Buyers and sellers arrange the handoff through Blockparty: a public meetup spot, pickup at the seller&apos;s
                  home, or delivery, as the listing allows.
                </li>
                <li>
                  Keep communication and payment on Blockparty. Never pay or take payment outside the platform; we can&apos;t
                  help with deals done off it.
                </li>
                <li>
                  Use common sense for your safety: meet in public places where you can, bring someone or tell someone where
                  you&apos;re going, and leave if you feel unsafe. You&apos;re responsible for your own safety and property at
                  a handoff.
                </li>
              </ul>
              <h3>Cancellations and no-shows</h3>
              <ul>
                <li>Either party can cancel an order before the handoff; the buyer&apos;s hold is released.</li>
                <li>
                  If you&apos;re reported for not showing up to an agreed meetup, you may receive a no-show strike. Strikes
                  stay active for 90 days. With 3 active strikes, buying, bidding and selling are paused until one expires.
                  If you think a strike was a mistake, contact us.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: 'reviews',
          title: 'Reviews',
          body: (
            <p>
              After a completed handoff, buyer and seller can review each other within 14 days. Reviews appear once both
              have reviewed, or after 14 days. Reviews must be honest, based on the actual transaction, and free of personal
              information, threats or abuse. We may remove reviews that break these terms.
            </p>
          ),
        },
        {
          id: 'conduct',
          title: 'Rules of conduct',
          body: (
            <>
              <p>You agree not to:</p>
              <ul>
                <li>Break the law, or list, buy or sell anything illegal.</li>
                <li>Mislead, defraud or scam anyone, or misrepresent an item or yourself.</li>
                <li>Harass, threaten, discriminate against or abuse other members.</li>
                <li>Share contact details to take a deal off the platform.</li>
                <li>Post someone else&apos;s personal information or content you don&apos;t have the rights to.</li>
                <li>Create multiple or fake accounts, or use someone else&apos;s.</li>
                <li>
                  Interfere with Blockparty: scrape it, overload it, get around its security or limits, or use automated
                  tools to access it.
                </li>
              </ul>
              <p>
                You can report listings, questions and members, and block members. We review reports, and may remove content,
                issue warnings or strikes, or suspend or close accounts.
              </p>
            </>
          ),
        },
        {
          id: 'content',
          title: 'Your content',
          body: (
            <p>
              You keep ownership of the photos, text and other content you post. You give us a non-exclusive, worldwide,
              royalty-free licence to host, display, adapt (for example, resize) and share it to operate and promote
              Blockparty, for as long as it&apos;s on Blockparty and for a reasonable time after for backups and records. You
              confirm you have the rights to everything you post.
            </p>
          ),
        },
        {
          id: 'termination',
          title: 'Suspension and closing your account',
          body: (
            <p>
              You can close your account at any time by contacting us, once any open orders are finished. We may suspend or
              close your account, or limit what you can do, if you break these terms, if we&apos;re required to by law, or to
              protect members or Blockparty. Sections that by their nature should survive (such as fees owed, your content
              licence, disclaimers and limits of liability) continue after your account is closed.
            </p>
          ),
        },
        {
          id: 'disclaimers',
          title: 'Disclaimers',
          body: (
            <p>
              Blockparty is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law allows, we make
              no warranties about the service, the items listed, or the members you deal with, and we don&apos;t guarantee
              that Blockparty will be uninterrupted or error-free. Nothing in these terms limits rights you have under consumer
              protection laws that can&apos;t be waived.
            </p>
          ),
        },
        {
          id: 'liability',
          title: 'Limits of liability',
          body: (
            <>
              <p>
                To the extent the law allows, Blockparty isn&apos;t liable for indirect, incidental, special or consequential
                losses, lost profits or lost data, or for anything arising from items bought or sold, handoffs, or the
                conduct of other members.
              </p>
              <p>
                Our total liability to you for any claim relating to Blockparty is limited to the greater of the fees you paid
                us in the 12 months before the claim and $100.
              </p>
              <p>
                You agree to cover our reasonable losses arising from your breach of these terms or the law, or from items you
                list or sell.
              </p>
            </>
          ),
        },
        {
          id: 'disputes',
          title: 'Disputes between members',
          body: (
            <p>
              Try to resolve problems with the other member first, using the order&apos;s messages. If you can&apos;t, contact
              us and we&apos;ll look into it, but disputes over an item are between buyer and seller, and our decisions about
              the platform (such as strikes or removing content) are final within Blockparty.
            </p>
          ),
        },
        {
          id: 'law',
          title: 'Governing law',
          body: (
            <p>
              These terms are governed by the laws of {LEGAL.province} and the federal laws of Canada that apply there. You and
              we agree to the jurisdiction of the courts of {LEGAL.province}, unless the law where you live gives you the
              right to bring a claim there.
            </p>
          ),
        },
        {
          id: 'changes',
          title: 'Changes to these terms',
          body: (
            <p>
              We may update these terms. If a change is significant, we&apos;ll tell you by email or on the site before it
              takes effect. If you keep using Blockparty after that, you accept the new terms. If you don&apos;t, you can
              close your account.
            </p>
          ),
        },
        {
          id: 'contact',
          title: 'Contact us',
          body: (
            <p>
              Questions about these terms: {LEGAL.supportEmail}, or by mail at {LEGAL.operator}, {LEGAL.address}.
            </p>
          ),
        },
      ]}
    />
  )
}
