-- Apply after the app with the automatic listing check is deployed: new
-- listings start as 'pending' and go live when the check approves them.
alter table public.listings alter column review_status set default 'pending';
