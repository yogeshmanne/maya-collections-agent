-- 001_init.sql
-- Real relational schema for the Kapture Finance collections voicebot backend.
-- Run via `npm run db:migrate`. Designed for Postgres; no ORM binary dependency.

CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,
  account_ref        TEXT UNIQUE NOT NULL,       -- business-facing ID, e.g. ACC-88392
  customer_name      TEXT NOT NULL,
  loan_type          TEXT NOT NULL,
  amount_due         NUMERIC(12,2) NOT NULL,
  days_past_due      INTEGER NOT NULL,
  verification_hash  TEXT NOT NULL,               -- SHA-256 of the verification code; raw code is never stored
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE call_state AS ENUM (
  'INIT', 'AUTH_PENDING', 'AUTHENTICATED', 'NEGOTIATION',
  'PTP_COLLECTED', 'ESCALATED', 'DISPOSED', 'CALL_ENDED'
);

CREATE TABLE IF NOT EXISTS calls (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL REFERENCES accounts(id),
  vapi_call_id          TEXT UNIQUE,
  state                 call_state NOT NULL DEFAULT 'INIT',
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  verified_at           TIMESTAMPTZ,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  disposition           TEXT,
  disposition_notes     TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_state ON calls(state);
CREATE INDEX IF NOT EXISTS idx_calls_account ON calls(account_id);

-- Every tool invocation is logged here, including ones the state machine
-- BLOCKED. This table is the audit evidence that auth is enforced in code,
-- not just via prompt discipline.
CREATE TABLE IF NOT EXISTS tool_call_logs (
  id           TEXT PRIMARY KEY,
  call_id      TEXT NOT NULL REFERENCES calls(id),
  tool_name    TEXT NOT NULL,
  args_json    TEXT NOT NULL,   -- PII-masked before storage
  allowed      BOOLEAN NOT NULL,
  block_reason TEXT,
  result_json  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tool_logs_call ON tool_call_logs(call_id);
CREATE INDEX IF NOT EXISTS idx_tool_logs_tool ON tool_call_logs(tool_name);

CREATE TABLE IF NOT EXISTS promises_to_pay (
  id           TEXT PRIMARY KEY,
  call_id      TEXT UNIQUE NOT NULL REFERENCES calls(id),
  ptp_date     DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  link_sent    BOOLEAN NOT NULL DEFAULT false,
  link_channel TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escalations (
  id         TEXT PRIMARY KEY,
  call_id    TEXT UNIQUE NOT NULL REFERENCES calls(id),
  reason     TEXT NOT NULL,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
