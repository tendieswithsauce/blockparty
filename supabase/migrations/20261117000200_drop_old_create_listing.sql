-- Apply after the categories/search app is deployed: the old create_listing()
-- signature (no category or condition) was only kept for the previous deploy.
drop function public.create_listing(text, text, public.listing_type, text, text[], integer, integer, integer);
