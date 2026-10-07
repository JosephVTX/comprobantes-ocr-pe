import hmac
import os
import resource
import time
from functools import lru_cache

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

API_KEYS = [k.strip() for k in os.environ.get("API_KEYS", "").split(",") if k.strip()]
MAX_MB = int(os.environ.get("MAX_MB", "10"))
app = FastAPI(title="ocr-ppv5-test")


@lru_cache(maxsize=1)
def get_ocr():
    # PP-OCRv5 (mismos modelos de PaddleOCR) ejecutado con onnxruntime: funciona en x86 y ARM
    from rapidocr import OCRVersion, RapidOCR

    return RapidOCR(
        params={
            "Det.ocr_version": OCRVersion.PPOCRV5,
            "Det.model_type": "mobile",
            "Rec.ocr_version": OCRVersion.PPOCRV5,
            "Rec.model_type": "mobile",
        }
    )


def leer(img) -> list[str]:
    return list(get_ocr()(img).txts or [])


def rss_mb() -> float:
    # ru_maxrss en Linux = KB (pico de memoria del proceso)
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)


def auth(key: str | None, authorization: str | None) -> None:
    sent = key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else "")
    if not API_KEYS or not any(hmac.compare_digest(sent, k) for k in API_KEYS):
        raise HTTPException(401, "API key invalida")


@app.get("/health")
def health():
    return {"ok": True, "peak_rss_mb": rss_mb()}


@app.post("/ocr", response_class=PlainTextResponse)
async def ocr(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(None),
    authorization: str | None = Header(None),
):
    auth(x_api_key, authorization)
    data = await file.read()
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(413, "Imagen demasiado grande")
    t = time.perf_counter()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(415, "No es una imagen valida")
    lines = leer(img)
    ms = round((time.perf_counter() - t) * 1000)
    return PlainTextResponse("\n".join(lines), headers={"X-Elapsed-Ms": str(ms), "X-Peak-Rss-Mb": str(rss_mb())})


@app.post("/debug", response_class=PlainTextResponse)
async def debug(file: UploadFile = File(...), x_api_key: str | None = Header(None)):
    """Ejecuta el OCR en un subproceso para ver el error real si el proceso muere."""
    import subprocess

    auth(x_api_key, None)
    p = subprocess.run(["python", "-X", "faulthandler", "probe.py"], input=await file.read(), capture_output=True, timeout=300)
    import platform
    return f"arch={platform.machine()} exit={p.returncode}\n--- stdout\n{p.stdout.decode(errors='ignore')}\n--- stderr\n{p.stderr.decode(errors='ignore')[-3000:]}"
