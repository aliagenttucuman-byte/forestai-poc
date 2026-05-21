"""
Tree Detection API endpoints
POST /api/v1/tree-detection/run   → corre con imagen de prueba (demo)
POST /api/v1/tree-detection/upload → corre con imagen subida por el usuario
GET  /api/v1/tree-detection/sample-image → devuelve la imagen de prueba
"""
import io
import base64
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tree-detection", tags=["tree-detection"])


@router.post("/run")
async def run_detection_sample():
    """Corre detección de árboles sobre la imagen de prueba pública (NEON OSBS_029)."""
    try:
        from app.services.tree_detection import run_tree_detection
        result = run_tree_detection(image_path=None)
        annotated_b64 = base64.b64encode(result["annotated_image_bytes"]).decode()
        return {
            "tree_count": result["tree_count"],
            "trees": result["trees"],
            "image_width": result["image_width"],
            "image_height": result["image_height"],
            "annotated_image_b64": annotated_b64,
            "used_sample": result["used_sample"],
            "sam_used": result.get("sam_used", False),
            "sample_name": "OSBS_029 — Osceola National Forest, Florida (NEON dataset)",
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Error en tree detection")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def run_detection_upload(file: UploadFile = File(...)):
    """Corre detección sobre una imagen subida por el usuario (PNG/JPG/TIFF)."""
    import tempfile, os
    try:
        from app.services.tree_detection import run_tree_detection

        # Guardamos temporalmente
        suffix = os.path.splitext(file.filename or "image.png")[1] or ".png"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        try:
            result = run_tree_detection(image_path=tmp_path)
        finally:
            os.unlink(tmp_path)

        annotated_b64 = base64.b64encode(result["annotated_image_bytes"]).decode()
        return {
            "tree_count": result["tree_count"],
            "trees": result["trees"],
            "image_width": result["image_width"],
            "image_height": result["image_height"],
            "annotated_image_b64": annotated_b64,
            "used_sample": False,
            "sample_name": file.filename,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Error en tree detection upload")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sample-image")
async def get_sample_image():
    """Devuelve la imagen de prueba original (sin anotaciones)."""
    try:
        from app.services.tree_detection import _get_sample_image
        path = _get_sample_image()
        with open(path, "rb") as f:
            content = f.read()
        return Response(content=content, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
