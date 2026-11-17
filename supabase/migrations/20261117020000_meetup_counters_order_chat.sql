-- Meetup negotiation in both directions, and order chat.
--
-- Either side can suggest a vetted spot with up to 3 times and a short note.
-- The other side picks a time, or counters with their own suggestion (which
-- replaces it). A confirmed meetup can be rescheduled the same way.
-- Buyer and seller can message each other on the order while it's open,
-- including quick "I'm here" / "Running late" messages.

alter table public.transactions
  add column proposed_by uuid references public.profiles (id),
  add column proposal_note text check (char_length(proposal_note) <= 300);
-- Suggestions made before this change were always the seller's.
update public.transactions set proposed_by = seller_id where proposed_times is not null and proposed_by is null;
grant select (proposed_by, proposal_note) on public.transactions to authenticated;

-- ---------------------------------------------------------------------------
drop function public.propose_meetup(bigint, text, timestamptz[]);
create function public.propose_meetup(
  p_transaction_id bigint,
  p_spot_id text,
  p_times timestamptz[],
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  l public.listings;
  tm timestamptz;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  select * into l from public.listings where id = t.listing_id;
  -- The seller isn't told about a set-price sale until the buyer's undo
  -- window has passed, so nobody can start arranging before then.
  if l.listing_type = 'fixed' and t.authorized_at > now() - interval '5 minutes' then
    raise exception '%', case when uid = t.buyer_id
      then 'You can suggest a meetup once your 5-minute undo window has passed'
      else 'The buyer can still cancel for a few minutes. Try again shortly' end
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.meetup_spots where id = p_spot_id and is_active) then
    raise exception 'Pick a meetup spot' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_times, 1), 0) not between 1 and 3 then
    raise exception 'Suggest between 1 and 3 times' using errcode = 'P0001';
  end if;
  foreach tm in array p_times loop
    if tm < now() + interval '30 minutes' then
      raise exception 'Times must be at least 30 minutes from now' using errcode = 'P0001';
    end if;
    if tm > t.meetup_deadline then
      raise exception 'Times must be before %', to_char(t.meetup_deadline, 'Mon DD') using errcode = 'P0001';
    end if;
  end loop;
  if char_length(note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = 'P0001';
  end if;

  update public.transactions
     set meetup_spot_id = p_spot_id,
         proposed_times = (select array_agg(distinct x order by x) from unnest(p_times) x),
         proposed_by = uid,
         proposal_note = note,
         meetup_at = null
   where id = t.id;
end;
$$;
revoke execute on function public.propose_meetup(bigint, text, timestamptz[], text) from public, anon;
grant execute on function public.propose_meetup(bigint, text, timestamptz[], text) to authenticated;

-- Accept one of the other side's times (p_time), or turn them all down
-- (p_time null) so they can suggest again.
create or replace function public.choose_meetup_time(p_transaction_id bigint, p_time timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
begin
  select * into t from public.transactions where id = p_transaction_id for update;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is no longer open' using errcode = 'P0001';
  end if;
  if t.proposed_times is null then
    raise exception 'There''s no suggestion to answer' using errcode = 'P0001';
  end if;
  if coalesce(t.proposed_by, t.seller_id) = uid then
    raise exception 'The other person needs to answer your suggestion' using errcode = 'P0001';
  end if;
  if p_time is null then
    update public.transactions set proposed_times = null, proposal_note = null, meetup_at = null where id = t.id;
    return;
  end if;
  if not (p_time = any (t.proposed_times)) then
    raise exception 'Pick one of the suggested times' using errcode = 'P0001';
  end if;
  if p_time < now() then
    raise exception 'That time has passed. Suggest a new one' using errcode = 'P0001';
  end if;
  update public.transactions set meetup_at = p_time where id = t.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order chat
create table public.order_messages (
  id             bigint generated always as identity primary key,
  transaction_id bigint not null references public.transactions (id) on delete cascade,
  sender_id      uuid not null references public.profiles (id) on delete cascade,
  kind           text not null default 'text' check (kind in ('text', 'here', 'late')),
  body           text not null check (char_length(body) between 1 and 1000),
  created_at     timestamptz not null default now()
);
create index order_messages_transaction on public.order_messages (transaction_id, created_at);
create index order_messages_sender on public.order_messages (sender_id);

alter table public.order_messages enable row level security;
create policy "Buyer and seller can read their order messages" on public.order_messages
  for select to authenticated using (
    exists (
      select 1 from public.transactions t
       where t.id = transaction_id and (select auth.uid()) in (t.buyer_id, t.seller_id)
    )
  );
revoke all on public.order_messages from anon, authenticated;
grant select on public.order_messages to authenticated;
alter publication supabase_realtime add table public.order_messages;

create or replace function public.send_order_message(p_transaction_id bigint, p_body text, p_kind text default 'text')
returns public.order_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  t public.transactions;
  msg public.order_messages;
  body text := btrim(coalesce(p_body, ''));
begin
  select * into t from public.transactions where id = p_transaction_id;
  if not found or uid is null or uid not in (t.buyer_id, t.seller_id) then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if t.status <> 'authorized' then
    raise exception 'This order is closed, so messages are turned off' using errcode = 'P0001';
  end if;
  if p_kind not in ('text', 'here', 'late') then
    raise exception 'Unknown message type' using errcode = 'P0001';
  end if;
  if body = '' then
    raise exception 'Write a message' using errcode = 'P0001';
  end if;
  if char_length(body) > 1000 then
    raise exception 'Keep messages under 1,000 characters' using errcode = 'P0001';
  end if;
  -- The code is what charges the buyer's card: it should only be shown in
  -- person, after the buyer has checked the item.
  if uid = t.buyer_id and t.handoff_code is not null
     and regexp_replace(body, '\D', '', 'g') like '%' || t.handoff_code || '%' then
    raise exception 'Don''t send your handoff code in chat. Show it to the seller in person once you''ve checked the item'
      using errcode = 'P0001';
  end if;
  if (select count(*) from public.order_messages
       where transaction_id = t.id and sender_id = uid and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'You''re sending messages too quickly. Wait a moment' using errcode = 'P0001';
  end if;

  insert into public.order_messages (transaction_id, sender_id, kind, body)
  values (t.id, uid, p_kind, body)
  returning * into msg;
  return msg;
end;
$$;
revoke execute on function public.send_order_message(bigint, text, text) from public, anon;
grant execute on function public.send_order_message(bigint, text, text) to authenticated;

-- Tell the other side. Ordinary messages collapse into one unread
-- notification (one email until they look); "I'm here" and "Running late"
-- always notify.
create or replace function public.on_order_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  l public.listings;
  sender text;
  other uuid;
begin
  select * into t from public.transactions where id = new.transaction_id;
  select * into l from public.listings where id = t.listing_id;
  select coalesce(username, 'They') into sender from public.profiles where id = new.sender_id;
  other := case when new.sender_id = t.buyer_id then t.seller_id else t.buyer_id end;

  if new.kind = 'here' then
    perform public.notify(other, 'message_here', sender || ' is at the meetup spot',
      'For ' || l.title || '.', '/orders/' || t.id, l.id, t.id, true);
  elsif new.kind = 'late' then
    perform public.notify(other, 'message_late', sender || ' is running late', new.body,
      '/orders/' || t.id, l.id, t.id, true);
  else
    update public.notifications
       set body = left(new.body, 200), created_at = now()
     where user_id = other and kind = 'message' and transaction_id = t.id and read_at is null;
    if not found then
      perform public.notify(other, 'message', sender || ' sent you a message about ' || l.title,
        left(new.body, 200), '/orders/' || t.id, l.id, t.id, true);
    end if;
  end if;
  return null;
end;
$$;
create trigger order_messages_notify after insert on public.order_messages
  for each row execute function public.on_order_message();
revoke execute on function public.on_order_message() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Order notifications: same as before, except meetup suggestions now go to
-- whichever side didn't make them, and include the note.
create or replace function public.on_transaction_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.listings;
  s public.meetup_spots;
  buyer text;
  seller text;
  amount text := public.fmt_cents(new.amount_cents);
  link text := '/orders/' || new.id;
  tm text;
  other uuid;
  proposer uuid;
  proposer_name text;
  heading text;
begin
  select * into l from public.listings where id = new.listing_id;
  select coalesce(username, 'The buyer') into buyer from public.profiles where id = new.buyer_id;
  select coalesce(username, 'The seller') into seller from public.profiles where id = new.seller_id;

  if new.status is distinct from old.status then
    if new.status = 'authorized' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'won', 'You won ' || l.title || '!',
        'Your winning bid of ' || amount || ' is on hold on your card. You''re only charged when you meet ' || seller
          || ' and accept the item. Next, agree on a meetup spot and time on the order page.',
        link, l.id, new.id, true, 'won:' || new.id);
      perform public.notify(new.seller_id, 'sold', l.title || ' sold for ' || amount,
        buyer || ' won your auction. Suggest a meetup spot and a few times on the order page.',
        link, l.id, new.id, true, 'sold:' || new.id);

    elsif new.status = 'authorized' then
      perform public.notify(new.buyer_id, 'purchased', 'You bought ' || l.title,
        amount || ' is on hold on your card. You can undo this for 5 minutes; after that you and ' || seller
          || ' agree on a meetup spot and time.',
        link, l.id, new.id, false, 'purchased:' || new.id);

    elsif old.status = 'pending' and new.status = 'canceled' and l.listing_type = 'auction' then
      perform public.notify(new.buyer_id, 'payment_failed', 'We couldn''t hold your card for ' || l.title,
        'We couldn''t place a hold on your card for your winning bid of ' || amount
          || ', so the item went to the next bidder. Check your payment method so this doesn''t happen again.',
        '/profile', l.id, new.id, true, 'payment_failed:' || new.id);

    elsif old.status = 'authorized' and new.status = 'canceled' and new.cancel_reason is not null then
      if new.canceled_by is null then
        perform public.notify(new.buyer_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The meetup didn''t happen before the deadline, so the order was cancelled. The hold on your card has been released.',
          link, l.id, new.id, true, 'canceled:' || new.id);
        perform public.notify(new.seller_id, 'order_canceled', 'Order cancelled: ' || l.title,
          'The meetup didn''t happen before the deadline, so the order was cancelled.'
            || case when l.listing_type = 'fixed' then ' Your listing is active again.' else '' end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      else
        other := case when new.canceled_by = new.buyer_id then new.seller_id else new.buyer_id end;
        perform public.notify(other, 'order_canceled',
          case when other = new.seller_id then buyer else seller end || ' cancelled the order for ' || l.title,
          'Reason: ' || public.cancel_reason_text(new.cancel_reason) || '. '
            || case
                 when other = new.buyer_id then 'The hold on your card has been released; you haven''t been charged.'
                 when l.listing_type = 'fixed' then 'Your listing is active again.'
                 else ''
               end,
          link, l.id, new.id, true, 'canceled:' || new.id);
      end if;

    elsif new.status = 'completed' then
      perform public.notify(new.seller_id, 'payment_sent', 'You''ve been paid for ' || l.title,
        case when new.stripe_transfer_id is not null
          then public.fmt_cents(new.amount_cents - new.platform_fee_cents) || ' is on its way to your bank ('
               || amount || ' minus the ' || public.fmt_cents(new.platform_fee_cents) || ' Blockparty fee).'
          else 'Your payout of ' || public.fmt_cents(new.amount_cents - new.platform_fee_cents)
               || ' is being processed. You can check it on your dashboard.'
        end,
        link, l.id, new.id, true, 'paid:' || new.id);
      perform public.notify(new.buyer_id, 'receipt', 'Receipt: ' || l.title,
        'You paid ' || amount || ' to ' || seller || '. Thanks for buying local!',
        link, l.id, new.id, true, 'receipt:' || new.id);
    end if;
  end if;

  -- Meetup negotiation (only while the order is open).
  if new.status = 'authorized' and old.status = 'authorized' then
    select * into s from public.meetup_spots where id = new.meetup_spot_id;

    if new.proposed_times is not null and (
         new.proposed_times is distinct from old.proposed_times
         or new.meetup_spot_id is distinct from old.meetup_spot_id
         or new.proposed_by is distinct from old.proposed_by
         or new.proposal_note is distinct from old.proposal_note
       ) then
      proposer := coalesce(new.proposed_by, new.seller_id);
      proposer_name := case when proposer = new.buyer_id then buyer else seller end;
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      heading := case
        when old.meetup_at is not null then proposer_name || ' wants to reschedule the meetup for ' || l.title
        when old.proposed_times is not null and coalesce(old.proposed_by, new.seller_id) <> proposer
          then proposer_name || ' suggested something else for ' || l.title
        else 'Pick a meetup time for ' || l.title
      end;
      perform public.notify(other, 'meetup_proposed', heading,
        proposer_name || ' suggested ' || coalesce(s.name, 'a meetup spot') || ' and '
          || cardinality(new.proposed_times) || case when cardinality(new.proposed_times) = 1 then ' time' else ' times' end
          || '.' || coalesce(' Their note: "' || new.proposal_note || '"', '')
          || ' Pick one, or suggest something else.',
        link, l.id, new.id, true);

    elsif new.meetup_at is not null and new.meetup_at is distinct from old.meetup_at then
      tm := public.fmt_meetup(new.meetup_at, s.timezone);
      perform public.notify(new.seller_id, 'meetup_confirmed', 'Meetup set: ' || tm,
        buyer || ' will meet you at ' || s.name || ', ' || s.address || ' for ' || l.title || '.',
        link, l.id, new.id, true);
      perform public.notify(new.buyer_id, 'meetup_confirmed', 'Meetup set: ' || tm,
        'You''re meeting ' || seller || ' at ' || s.name || ', ' || s.address
          || '. Check the item, then show them the handoff code on your order page.',
        link, l.id, new.id, true);

    elsif new.proposed_times is null and old.proposed_times is not null then
      proposer := coalesce(old.proposed_by, new.seller_id);
      other := case when proposer = new.buyer_id then new.seller_id else new.buyer_id end;
      perform public.notify(proposer, 'meetup_declined',
        case when other = new.buyer_id then buyer else seller end || ' needs different times for ' || l.title,
        'None of the times you suggested work. Suggest new ones on the order page.',
        link, l.id, new.id, true);
    end if;
  end if;
  return null;
end;
$$;
