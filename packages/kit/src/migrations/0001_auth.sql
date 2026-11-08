-- The tables Better Auth needs, in Spotcraft's naming: plural, snake_case, uuid ids,
-- timestamptz times. Guests and registered users share auth.users (is_anonymous).
-- Migrations only ever add; never drop or rename in a later file (ADR 0016).

CREATE TABLE auth.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL DEFAULT '',
  email          text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image          text,
  is_anonymous   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per way to sign in ('credential' holds a password hash; OAuth providers later).
CREATE TABLE auth.accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  provider_id              text NOT NULL,
  account_id               text NOT NULL,
  password                 text,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);

-- Email verification, password reset and magic-link tokens.
CREATE TABLE auth.verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON auth.sessions (user_id);
CREATE INDEX accounts_user_id_idx ON auth.accounts (user_id);
CREATE INDEX verifications_identifier_idx ON auth.verifications (identifier);
CREATE INDEX users_created_at_idx ON auth.users (created_at);
