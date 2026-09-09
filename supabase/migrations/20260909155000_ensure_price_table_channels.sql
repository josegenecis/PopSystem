-- Defensive repair for environments whose migration history was recorded
-- before PostgREST exposed the new multi-channel field.
ALTER TABLE public.price_tables
  ADD COLUMN IF NOT EXISTS channels text[];

UPDATE public.price_tables
SET channels = CASE
  WHEN channel = 'all' THEN ARRAY['all']::text[]
  ELSE ARRAY[channel]::text[]
END
WHERE channels IS NULL OR cardinality(channels) = 0;

ALTER TABLE public.price_tables
  ALTER COLUMN channels SET DEFAULT ARRAY['all']::text[],
  ALTER COLUMN channels SET NOT NULL;

ALTER TABLE public.price_tables
  DROP CONSTRAINT IF EXISTS price_tables_channels_check;

ALTER TABLE public.price_tables
  ADD CONSTRAINT price_tables_channels_check CHECK (
    cardinality(channels) > 0
    AND channels <@ ARRAY['all', 'pdv', 'delivery', 'waiter', 'totem', 'whatsapp', 'dine_in', 'pickup']::text[]
  );

CREATE INDEX IF NOT EXISTS idx_price_tables_channels
  ON public.price_tables USING gin (channels);

NOTIFY pgrst, 'reload schema';
