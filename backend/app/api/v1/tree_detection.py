"""
Tree Detection API endpoints — versión async con Celery
POST /api/v1/tree-detection/run    → demo con imagen de prueba
POST /api/v1/tree-detection/upload → encola tarea Celery, devuelve task_id
GET  /api/v1/tree-detection/status/{task_id} → polling del resultado
GET  /api/v1/tree-detection/sample-image → imagen de prueba original
"""
import io
import os
import base64
import logging
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import Response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tree-detection", tags=["tree-detection"])


@router.post("/run")
async def run_detection_sample():
    """Corre detección sobre la imagen de prueba pública (NEON OSBS_029) — síncrono, imagen chica."""
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
            "vlm_used": result.get("vlm_used", False),
            "sample_name": "OSBS_029 — Osceola National Forest, Florida (NEON dataset)",
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.exception("Error en tree detection sample")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def run_detection_upload(file: UploadFile = File(...)):
    """
    Encola la detección en Celery y devuelve task_id inmediatamente.
    El frontend hace polling a /status/{task_id}.
    """
    try:
        from app.tasks.tree_detection_task import run_tree_detection_task

        suffix = os.path.splitext(file.filename or "image.png")[1] or ".png"
        # Guardar en /app/uploads — volumen compartido con celery_worker
        import uuid
        tmp_path = f"/app/uploads/detect_{uuid.uuid4().hex}{suffix}"
        with open(tmp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        task = run_tree_detection_task.delay(tmp_path, file.filename or "image")
        logger.info(f"Tarea encolada: {task.id} para {file.filename}")

        return {
            "task_id": task.id,
            "status": "PENDING",
            "message": f"Procesando {file.filename}... usá /status/{task.id} para seguir el progreso."
        }
    except Exception as e:
        logger.exception("Error al encolar tree detection")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{task_id}")
async def get_detection_status(task_id: str):
    """
    Polling del estado de una tarea de detección.
    Estados: PENDING → PROGRESS → SUCCESS | FAILURE
    """
    try:
        from app.tasks.celery_app import celery_app
        task = celery_app.AsyncResult(task_id)

        if task.state == "PENDING":
            return {"task_id": task_id, "status": "PENDING", "message": "En cola..."}

        if task.state == "PROGRESS":
            meta = task.info or {}
            return {"task_id": task_id, "status": "PROGRESS", "message": meta.get("status", "Procesando...")}

        if task.state == "SUCCESS":
            result = task.result
            if result.get("status") == "FAILURE":
                return {"task_id": task_id, "status": "FAILURE", "error": result.get("error", "Error desconocido")}
            return {"task_id": task_id, "status": "SUCCESS", **result}

        if task.state == "FAILURE":
            return {"task_id": task_id, "status": "FAILURE", "error": str(task.info)}

        return {"task_id": task_id, "status": task.state}

    except Exception as e:
        logger.exception("Error consultando estado de tarea")
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
