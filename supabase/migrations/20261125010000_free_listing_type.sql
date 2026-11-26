-- Free items: a third listing type (used by 20261125020000_free_items).
alter type public.listing_type add value if not exists 'free';
