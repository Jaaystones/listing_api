CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE listing_type AS ENUM ('rent', 'sale', 'shortlet');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  price       NUMERIC(15, 2) NOT NULL CHECK (price >= 0),
  type        listing_type NOT NULL,
  bedrooms    SMALLINT NOT NULL CHECK (bedrooms BETWEEN 0 AND 50),
  -- geography(Point) so distance maths is on the spheroid and in metres.
  location    GEOGRAPHY(POINT, 4326) NOT NULL,
  agent_id    UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index used by ST_DWithin radius searches.
CREATE INDEX IF NOT EXISTS listings_location_gix ON listings USING GIST (location);
-- Common filter combination: type + price range, newest first.
CREATE INDEX IF NOT EXISTS listings_type_price_idx ON listings (type, price);
CREATE INDEX IF NOT EXISTS listings_created_at_idx ON listings (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS listings_agent_id_idx ON listings (agent_id);
