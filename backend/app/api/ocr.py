"""
routes/ocr.py — MRZ OCR endpoint.

Receives a JPEG frame from MrzCameraScreen, extracts the two MRZ lines
from the passport data page using passporteye, and returns parsed BAC key
fields ready for the mobile client to pass directly into NFC chip reading.

No data is stored — this is a stateless transform endpoint.
"""
import os
import tempfile
from fastapi import APIRouter, File, HTTPException, UploadFile
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/ocr", tags=["ocr"])


class MrzResult(BaseModel):
    document_number: str
    date_of_birth: str   # YYYY-MM-DD
    date_of_expiry: str  # YYYY-MM-DD
    nationality: str | None = None
    last_name: str | None = None
    first_name: str | None = None


@router.post("/mrz", response_model=MrzResult)
async def ocr_mrz(image: UploadFile = File(...)):
    """
    Accepts a JPEG image, runs passporteye MRZ extraction, returns
    parsed passport fields. Called every ~1.5 s by MrzCameraScreen
    until a valid MRZ is detected.

    Returns 422 if no MRZ is found in the frame so the client can
    keep looping without treating it as a hard error.
    """
    # Write upload to a temp file — passporteye needs a path, not bytes
    suffix = os.path.splitext(image.filename or "mrz.jpg")[1] or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await image.read())
        tmp_path = tmp.name

    try:
        return _extract(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _extract(image_path: str) -> MrzResult:
    try:
        # passporteye is the most reliable pure-Python MRZ extractor.
        # pip install passporteye pillow
        from passporteye import read_mrz
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="passporteye not installed — run: pip install passporteye pillow",
        )

    mrz = read_mrz(image_path)

    if mrz is None:
        raise HTTPException(status_code=422, detail="no_mrz_found")

    fields = mrz.to_dict()
    logger.debug(f"MRZ extracted: {fields}")

    doc_number = (fields.get("number") or "").replace("<", "").strip()
    dob_raw    = fields.get("date_of_birth") or ""
    expiry_raw = fields.get("expiration_date") or ""

    if not doc_number or len(dob_raw) != 6 or len(expiry_raw) != 6:
        raise HTTPException(
            status_code=422,
            detail=f"MRZ parsed but fields incomplete: number={doc_number!r} "
                   f"dob={dob_raw!r} expiry={expiry_raw!r}",
        )

    # Parse name — passporteye gives "SMITH<<JOHN" in surname field
    raw_name  = fields.get("surname", "") or ""
    parts     = raw_name.replace("<", " ").strip().split()
    last_name  = parts[0].title() if parts else None
    first_name = " ".join(parts[1:]).title() if len(parts) > 1 else None

    return MrzResult(
        document_number=doc_number,
        date_of_birth=_mrz_to_iso(dob_raw),
        date_of_expiry=_mrz_to_iso(expiry_raw),
        nationality=(fields.get("nationality") or "").replace("<", "").strip() or None,
        last_name=last_name,
        first_name=first_name,
    )


def _mrz_to_iso(yymmdd: str) -> str:
    """YYMMDD → YYYY-MM-DD, treating YY ≥ 30 as 19xx."""
    if len(yymmdd) != 6:
        return yymmdd
    yy   = int(yymmdd[:2])
    year = 1900 + yy if yy >= 30 else 2000 + yy
    return f"{year}-{yymmdd[2:4]}-{yymmdd[4:6]}"