# ─────────────────────────────────────────────────────────────────────────────
# Kakusho Protocol — FastAPI Relayer Backend
# Multi-stage build: builder installs deps, final image is lean and secure.
#
# Build:
#   docker build -t kakusho-relayer .
#
# Run (development):
#   docker run --env-file .env -p 8000:8000 kakusho-relayer
#
# Run (production with Koyeb / Railway / Render):
#   Set all env vars in the platform dashboard, then deploy this image.
#   The container listens on PORT (default 8000).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

# System deps needed to compile asyncpg (C extension) and cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    libssl-dev \
    libffi-dev \
    cargo \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy and install Python dependencies into a prefix we'll copy to final image
COPY requirements.txt .
RUN pip install --upgrade pip \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt

# ── Stage 2: Final image ──────────────────────────────────────────────────────
FROM python:3.11-slim

# Runtime system deps only (no compilers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libssl3 \
    # Node.js 20 LTS — required for snarkjs off-chain proof pre-check (snarkjs_verify.py)
    # and the build_restricted_tree.js country Merkle tree builder
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install snarkjs globally for the off-chain proof pre-check
RUN npm install -g snarkjs@0.7.4

# Create a non-root user — never run as root in production
RUN groupadd --gid 1001 kakusho \
 && useradd --uid 1001 --gid kakusho --shell /bin/bash --create-home kakusho

# Copy installed Python packages from builder
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application source
COPY --chown=kakusho:kakusho app/          ./app/
COPY --chown=kakusho:kakusho schema.sql    ./schema.sql
COPY --chown=kakusho:kakusho requirements.txt ./requirements.txt

# Copy ZK verification keys — these must be present at runtime.
# In CI/CD, copy from your artifact store or secret manager before building.
# For local dev: docker run -v $(pwd)/zk:/app/zk ...
COPY --chown=kakusho:kakusho zk/           ./zk/

# Copy CSCA master list for NFC Passive Authentication
# Download from https://www.icao.int/Security/FAL/PKD/Pages/ICAO-Master-List.aspx
# or https://github.com/UsePassport/open-csca-masterlist
# If file doesn't exist yet, the COPY will fail — create an empty placeholder:
#   mkdir -p data && touch data/csca_masterlist.pem
COPY --chown=kakusho:kakusho data/         ./data/

# Switch to non-root user
USER kakusho

# Expose the port uvicorn listens on
EXPOSE 8000

# Health check — Koyeb and Railway use this to know when the container is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Start the server.
# PORT env var is set by Koyeb/Railway/Render automatically.
# Workers: 1 for now (asyncpg pool handles concurrency inside one process).
# For higher load: increase --workers or deploy multiple container replicas.
CMD uvicorn app.main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8000} \
    --workers 1 \
    --log-level info \
    --no-access-log