# Blockparty database function schema

Generated from the live Supabase database (schema `public`) on 2026-11-18.

Trigger functions are not executable by `anon` or `authenticated` (they still fire normally).

**Callable by** shows who has EXECUTE:
- **anon** = signed-out visitors.
- **auth** = signed-in members.
- **service** = server code using the service-role key (never the browser).

**Security**: `definer` runs with the owner's rights (bypasses RLS, so it must check the caller itself). `invoker` runs with the caller's rights.

Functions are called from the app with `supabase.rpc('name', { p_arg: ... })`.

---

## Listings and search

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `create_listing` | title, description, listing_type, area_id, category_id, condition, image_paths[], price_cents, duration_days, reserve_cents, offers_meetup, offers_pickup, delivery_fee_cents, delivery_km | bigint (listing id) | auth, service | invoker | Create a listing (fixed, auction or silent). |
| `convert_to_auction` | listing_id, starting_price_cents, duration_days, reserve_cents | void | auth, service | definer | Turn an unsold fixed-price listing into an auction. |
| `search_listings` | query, category_id, area_ids[], listing_type, conditions[], min_cents, max_cents, sort, limit, offset | setof listings | anon, auth, service | invoker | Browse and search; hides blocked members' items. |
| `listing_photos_ok` | paths[] | boolean | anon, auth, service | invoker | Checks photo paths are valid. |
| `listing_offers` | listing, method | boolean | service | invoker | Does the listing offer meetup or pickup. |
| `default_handoff` | listing | text | service | invoker | The listing's default handoff method. |
| `listing_matches_search` | listing, saved_search | boolean | service | invoker | Does a listing match a saved search. |
| `distance_km` | lat1, lng1, lat2, lng2 | double | anon, auth, service | invoker | Distance between two points. |
| `charity_directory` | | table | anon, auth, service | definer | Public list of approved charities. |

## Buying, bidding and orders

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `begin_purchase` | listing_id, buyer_id, fee_bps, min_fee_cents, handoff | transactions | service | definer | Starts a Buy Now order. |
| `place_bid` | listing_id, amount_cents, handoff | bids | auth, service | definer | Places a bid; extends the auction 2 min if it lands in the last 2. |
| `close_auction` | listing_id, fee_bps, min_fee_cents | transactions | service | definer | Closes an ended auction and creates the order (skips blocked bidders). |
| `silent_bid_status` | listing_id | table | anon, auth, service | definer | The caller's own silent bid and whether it leads. |
| `cancel_authorized_purchase` | transaction_id, buyer_id, window_seconds | text | service | definer | Buyer's undo window for Buy Now. |
| `cancel_pending_purchase` | transaction_id | void | service | definer | Cancels a purchase that never completed payment. |
| `cancel_order` | transaction_id, user_id, reason | text | service | definer | Cancels an order with a reason. |
| `release_stale_purchases` | | table | service | definer | Finds stale pending purchases to release. |
| `expired_orders` | | setof bigint | service | definer | Orders past their handoff deadline. |
| `complete_order` | transaction_id, transfer_id | void | service | definer | Marks an order complete after payout. |
| `get_handoff_code` | transaction_id | text | auth, service | definer | The buyer's handoff code. |
| `check_handoff_code` | transaction_id, seller_id, code | boolean | service | definer | Verifies the code the seller enters. |
| `order_handoff_place` | transaction_id | table | auth, service | definer | Handoff method and address (address hidden until the hold goes through). |
| `order_party_names` | transaction_id | table | auth, service | definer | Buyer and seller usernames for an order. |
| `suggest_meetup_spots` | transaction_id, limit | table | auth, service | definer | Public meetup spots between both parties. |
| `propose_meetup` | transaction_id, spot_id, times[], note | void | auth, service | definer | Propose a spot and times (no spot for home handoffs). |
| `choose_meetup_time` | transaction_id, time | void | auth, service | definer | Other party picks a time. |
| `send_order_message` | transaction_id, body, kind | order_messages | auth, service | definer | Order chat message. |
| `record_handoff_location` | transaction_id, lat, lng, accuracy_m | void | auth, service | definer | Handoff GPS record (admin-only, purged after 90 days). |
| `platform_fee` | amount_cents, fee_bps, min_fee_cents | integer | anon, auth, service | invoker | Fee on the item price (10%, $5 minimum). |
| `charity_fee_free_used` | charity_id | integer | service | definer | Fee-free sales used by a charity. |
| `seller_can_receive_payouts` | | boolean | auth, service | definer | Has the caller finished Stripe onboarding. |

## Reviews, profiles and members

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `leave_review` | transaction_id, rating, comment | void | auth, service | definer | Leave a review after an order. |
| `review_published` | transaction_id | boolean | anon, auth, service | definer | Is the review visible yet. |
| `profile_reviews` | username, limit | table | anon, auth, service | definer | Reviews shown on a public profile. |
| `public_profile` | username | table | anon, auth, service | definer | Public profile stats and avatar. |
| `check_username` | name | text | anon, auth, service | definer | Username availability and validity. |
| `username_problem` | name | text | service | definer | Why a username is invalid. |
| `generate_username` | | text | anon, auth, service | definer | Random username. |
| `set_username` | name | text | auth, service | definer | Change own username. |
| `is_admin` | | boolean | anon, auth, service | definer | Is the caller an admin. |
| `active_strike_count` | user_id | integer | service | definer | Active strikes against a member. |
| `my_charity` | | table | anon, auth, service | definer | The caller's charity application and status. |
| `apply_charity` | bn, name, description, website, contact_name, contact_role, contact_phone, contact_email | void | auth, service | definer | Apply as a charity. |

## Q&A

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `ask_question` | listing_id, question | bigint | auth, service | definer | Ask the seller a question. |
| `answer_question` | question_id, answer | void | auth, service | definer | Seller answers publicly. |
| `remove_question` | question_id | void | auth, service | definer | Asker withdraws or seller removes. |
| `listing_questions_for` | listing_id | table | anon, auth, service | definer | Answered questions plus the caller's own pending ones. |

## Report and block

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `block_user` | user_id | void | auth, service | definer | Block a member. (Unblock is a delete on `user_blocks`.) |
| `my_blocks` | | table | auth, service | definer | Members the caller blocked. |
| `is_blocked_with` | other | table (blocked, by_me) | anon, auth, service | definer | Block status between caller and another member. |
| `blocked_with_me` | other | boolean | anon, auth, service | definer | Helper used by `search_listings` and similar. |
| `blocked_between` | a, b | boolean | service | definer | Internal block check. |
| `report_content` | target_type, reason, details, listing_id, user_id, question_id | void | auth, service | definer | File a report. |
| `report_reason_text` | reason | text | anon, auth, service | invoker | Human label for a report reason. |

## Saved searches, engagement and notifications

| Function | Args | Returns | Callable by | Security | Purpose |
|---|---|---|---|---|---|
| `save_search` | query, category_id, area_ids[], area_key, listing_type, conditions[], min_cents, max_cents, query_string | bigint | auth, service | definer | Save a search for alerts. |
| `log_listing_view` | listing_id, anon_id, source | void | anon, auth, service | definer | Log a listing view (deduped, rate limited). |
| `log_search` | anon_id, query, category_id, area_key, listing_type, conditions[], min_cents, max_cents, sort, result_count | void | anon, auth, service | definer | Log a Browse search. |
| `claim_anonymous_engagement` | anon_id | void | auth, service | definer | Attach signed-out history to the account at sign-in. |
| `engagement_over_limit` | user_id, anon_id | boolean | service | invoker | Rate-limit check for logging. |
| `notify` | user_id, kind, title, body, link, listing_id, transaction_id, email, dedupe_key | void | service | definer | Create an in-app notification (optionally emailed). |
| `notifications_sweep` | | void | service | definer | Scheduled sweep for time-based notices. |
| `claim_notification_emails` | limit | table | service | definer | Queue of emails to send. |
| `claim_safety_alerts` | limit | table | service | definer | Queue of emergency-contact emails. |
| `auction_work_pending` | | boolean | service | definer | True when the cron has work (auctions, holds, emails, moderation, payout retries); gates the pg_cron job. |

## Admin (all check `is_admin()` inside)

| Function | Args | Returns | Callable by | Purpose |
|---|---|---|---|---|
| `admin_overview` | | table | auth, service | Dashboard totals. |
| `admin_review_queue` | | table | auth, service | Listings awaiting review. |
| `admin_review_listing` | listing_id, approve, reason | void | auth, service | Approve or reject a listing. |
| `admin_charity_queue` | | table | auth, service | Pending charity applications. |
| `admin_review_charity` | charity_id, approve, note | void | auth, service | Approve or reject a charity. |
| `admin_set_charity_fee_cap` | cents | void | auth, service | Fee-free allowance for charities. |
| `admin_strikes` | | table | auth, service | Strikes list. |
| `admin_void_strike` | strike_id | void | auth, service | Void a strike. |
| `admin_reports` | | table | auth, service | Open reports. |
| `admin_resolve_report` | report_id, action, note | void | auth, service | dismiss / handled / remove_listing / remove_question. |
| `admin_handoff_locations` | transaction_id | table | auth, service | Handoff GPS for one order. |

## Formatting helpers

`fmt_cents(c)`, `fmt_meetup(t, tz)`, `cancel_reason_text(reason)` (all invoker, callable by anyone).

## Trigger functions (not callable as RPCs)

| Function | Fires on | Does |
|---|---|---|
| `handle_new_user`, `handle_user_email_change` | auth users | Create or sync the profile. |
| `lock_auction_with_bids` | listings | Once an auction has bids, the seller can't edit it or take it down. |
| `set_updated_at` | many tables | Maintains `updated_at`. |
| `listing_search_vector` | listings | Maintains the full-text search column. |
| `listing_handoff_check` | listings | Requires at least one handoff method; validates delivery fee and radius. |
| `listing_reserve_set`, `listing_reserve_recheck`, `listing_needs_recheck` | listings | Reserve price and re-moderation handling. |
| `require_approved_listing` | listings | Blocks unapproved listings from going live. |
| `listing_charity`, `charity_fee_waiver` | listings, transactions | Charity link and fee waiver. |
| `on_listing_live_saved_searches` | listings | Notify saved-search matches. |
| `on_listing_price_drop` | listings | Notify watchers of a price drop. |
| `watchlist_count` | watchlist | Maintains watcher counts. |
| `on_bid_placed` | bids | Outbid and bid notices. |
| `enforce_no_block_bid`, `enforce_no_block_purchase`, `enforce_no_block_question` | bids, transactions, listing_questions | Reject activity between blocked members. |
| `on_transaction_authorized`, `on_transaction_notify`, `on_transaction_safety_alert` | transactions | Status notices and emergency-contact alerts. |
| `on_order_message` | order_messages | Message notices. |
| `on_no_show_reported`, `enforce_strike_limit` | no-shows, strikes | Strikes and suspension limits. |
| `on_review`, `on_listing_review`, `on_order_completed_review_request` | reviews, transactions | Rating totals and review requests. |
