-- Refresh PostgREST after adding price_tables.channels so the new field is
-- immediately available to the production API.
NOTIFY pgrst, 'reload schema';
