-- schema.sql — run this against a fresh database before starting the
-- relayer (or wire it into your migration tool of choice, e.g. alembic).
--
-- Three tables only, by design — see models.py's module docstring for
-- why this backend should never accumulate more than this.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS integrators (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integrator_id_hex VARCHAR(64) NOT NULL UNIQUE,  -- matches the 32-byte integrator_id registered on-chain
    name TEXT NOT NULL,
    owner_stellar_address VARCHAR(56) NOT NULL,     -- must match kyc_registry's registered owner
    api_key_hash TEXT NOT NULL,                       -- sha256(api_key) — never store the raw key
    webhook_url TEXT,
    webhook_secret TEXT,                              -- HMAC secret for signing webhook payloads
    daily_sponsored_tx_limit INT NOT NULL DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrators_integrator_id ON integrators(integrator_id_hex);

CREATE TABLE IF NOT EXISTS sponsored_tx_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    integrator_id UUID NOT NULL REFERENCES integrators(id),
    nullifier_hex VARCHAR(64) NOT NULL,
    user_stellar_address VARCHAR(56),
    status VARCHAR(16) NOT NULL DEFAULT 'submitted',  -- submitted | confirmed | rejected
    tx_hash VARCHAR(64),
    off_chain_check_passed BOOLEAN NOT NULL,           -- result of snarkjs_verify.py's pre-check
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Used for both abuse investigation AND the daily spend-limit check in
-- stellar_sponsor.py — keep this index, the limit check runs on every
-- single submission.
CREATE INDEX IF NOT EXISTS idx_sponsored_tx_integrator_created
    ON sponsored_tx_log(integrator_id, created_at);

-- Nullifiers are meaningful only within an integrator's namespace (see
-- nullifier.circom), so uniqueness is scoped per-integrator, not global.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsored_tx_integrator_nullifier
    ON sponsored_tx_log(integrator_id, nullifier_hex);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID NOT NULL REFERENCES sponsored_tx_log(id),
    integrator_id UUID NOT NULL REFERENCES integrators(id),
    payload JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
    attempt_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    last_response_code INT,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
    ON webhook_deliveries(status, next_retry_at)
    WHERE status = 'pending';