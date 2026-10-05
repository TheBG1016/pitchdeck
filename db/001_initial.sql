CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Investment Pool Evaluation',
  currency_code text NOT NULL DEFAULT 'INR' CHECK (currency_code ~ '^[A-Z]{3}$'),
  phase text NOT NULL DEFAULT 'REGISTRATION' CHECK (phase IN ('REGISTRATION','SHORTLISTING','PRESENTATION','INVESTMENT','CLOSED','RESULTS')),
  paused boolean NOT NULL DEFAULT false,
  results_revealed boolean NOT NULL DEFAULT false,
  trading_started boolean NOT NULL DEFAULT false,
  starting_balance_minor bigint NOT NULL DEFAULT 150000 CHECK (starting_balance_minor >= 0),
  stocks_per_team integer NOT NULL DEFAULT 10 CHECK (stocks_per_team > 0),
  stock_price_minor bigint NOT NULL DEFAULT 10000 CHECK (stock_price_minor > 0),
  investment_starts_at timestamptz,
  investment_ends_at timestamptz,
  current_presentation_team_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_window CHECK (investment_starts_at IS NULL OR investment_ends_at IS NULL OR investment_starts_at < investment_ends_at)
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name text NOT NULL,
  college text NOT NULL,
  is_participant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teams_event_name_idx ON teams(event_id, name);

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot integer NOT NULL CHECK (slot BETWEEN 1 AND 4),
  name text NOT NULL,
  email text NOT NULL,
  registration_number text NOT NULL,
  UNIQUE(team_id, slot)
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON team_members(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS members_registration_unique ON team_members(lower(registration_number));

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('ADMIN','TEAM_LEADER')),
  email text NOT NULL,
  team_id uuid UNIQUE REFERENCES teams(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'ADMIN' AND team_id IS NULL) OR (role = 'TEAM_LEADER' AND team_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS wallets (
  team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE RESTRICT,
  starting_minor bigint NOT NULL CHECK (starting_minor >= 0),
  available_minor bigint NOT NULL CHECK (available_minor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL UNIQUE REFERENCES teams(id) ON DELETE RESTRICT,
  initial_quantity integer NOT NULL CHECK (initial_quantity > 0),
  sold_quantity integer NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0 AND sold_quantity <= initial_quantity),
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  presentation_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, presentation_order)
);

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_current_presentation_team_id_fkey;
ALTER TABLE events ADD CONSTRAINT events_current_presentation_team_id_fkey
  FOREIGN KEY (current_presentation_team_id) REFERENCES teams(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  buyer_team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES offerings(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  status text NOT NULL DEFAULT 'COMMITTED' CHECK (status = 'COMMITTED'),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(buyer_team_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS purchases_offering_idx ON purchases(offering_id, created_at);
CREATE INDEX IF NOT EXISTS purchases_buyer_idx ON purchases(buyer_team_id, created_at);

CREATE TABLE IF NOT EXISTS purchase_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rows jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  event_id uuid REFERENCES events(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  purchase_id uuid REFERENCES purchases(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_event_time_idx ON audit_logs(event_id, created_at DESC);

INSERT INTO events(name)
SELECT 'Investment Pool Evaluation'
WHERE NOT EXISTS (SELECT 1 FROM events);
