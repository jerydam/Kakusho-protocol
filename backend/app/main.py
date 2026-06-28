"""
main.py — FastAPI application entry point for the zk-kyc relayer.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from loguru import logger

from app.core.config import settings
from app.db.database import create_pool, close_pool
from app.api.routes_integrator import router as integrator_router
from app.api.routes_proof import router as proof_router
from app.api.routes_sessions import router as sessions_router
from app.api.routes_nfc import router as nfc_router
from app.api.routes_credential import router as credential_router
from app.routes.ocr import router as ocr_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting zk-kyc relayer...")
    await create_pool()
    logger.info(f"DB pool ready. Network: {settings.STELLAR_NETWORK}")
    logger.info(f"Contract: {settings.KYC_REGISTRY_CONTRACT_ID}")
    logger.info(f"Self integrator: {settings.KAKUSHO_SELF_INTEGRATOR_ID or 'NOT SET'}")
    yield
    logger.info("Shutting down...")
    await close_pool()


app = FastAPI(
    title="zk-KYC Relayer",
    description="Fee-sponsoring relayer for the Kakusho ZK KYC protocol on Soroban",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(integrator_router)
app.include_router(proof_router)
app.include_router(sessions_router)
app.include_router(nfc_router)
app.include_router(credential_router)   # ← new
app.include_router(ocr_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "network": settings.STELLAR_NETWORK,
        "contract": settings.KYC_REGISTRY_CONTRACT_ID,
        "self_integrator_set": bool(settings.KAKUSHO_SELF_INTEGRATOR_ID),
    }