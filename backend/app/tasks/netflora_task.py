"""
Tarea Celery para ejecutar detección NetFlora en background.
"""
import os
from datetime import datetime
from app.tasks.celery_app import celery_app
from app.db.session import SessionLocal
from app.db import models


@celery_app.task(bind=True, name="netflora.run_detection", time_limit=3600)
def run_netflora_task(self, job_id: str, filepath: str | None, category: str, conf_threshold: float):
    """
    Tarea Celery que ejecuta el pipeline NetFlora completo:
    1. Descarga el modelo si no existe
    2. Corre la detección sobre la ortofoto o imagen de muestra
    3. Guarda resultados en la BD
    """
    db = SessionLocal()
    try:
        # Buscar el job
        import uuid as _uuid
        job = db.query(models.NetFloraJob).filter(
            models.NetFloraJob.id == _uuid.UUID(job_id)
        ).first()

        if not job:
            return {"error": "Job no encontrado"}

        # Actualizar a processing
        job.status = models.NetFloraJobStatus.processing
        job.progress = 2
        job.current_step = "Inicializando pipeline NetFlora..."
        db.commit()

        def progress_cb(pct: int, step: str):
            job.progress = pct
            job.current_step = step
            db.commit()

        # Resolver filepath: prioridad al guardado en el job, luego parámetro
        image_path = job.filepath or filepath
        if not image_path or not os.path.exists(image_path):
            # Usar imagen de muestra descargada si no hay ortofoto real
            image_path = _get_sample_image(category, progress_cb)
            # Actualizar job con el path usado
            job.filepath = image_path
            db.commit()

        # Correr pipeline
        from app.services.netflora_service import run_netflora_detection
        result = run_netflora_detection(
            image_path=image_path,
            category=category,
            conf_threshold=conf_threshold,
            progress_cb=progress_cb,
        )

        # Guardar resultado
        job.status        = models.NetFloraJobStatus.completed
        job.progress      = 100
        job.current_step  = "Completado"
        job.total_detected= result["total_detected"]
        area_ha = result.get("area_ha", 0) or 0
        import math as _math
        if _math.isnan(area_ha) or _math.isinf(area_ha):
            area_ha = 0.0
        job.area_ha       = area_ha
        job.processing_time_s = result.get("processing_time_s", 0)
        job.result_json   = {
            "category":          result["category"],
            "conf_threshold":    result["conf_threshold"],
            "total_detected":    result["total_detected"],
            "area_ha":           area_ha,
            "processing_time_s": result.get("processing_time_s", 0),
            "tiles_processed":   result.get("tiles_processed", 0),
            "species":           result["species"],
            "detections_count":  len(result.get("detections", [])),
        }
        job.completed_at = datetime.utcnow()
        db.commit()

        return {"job_id": job_id, "status": "completed", "total": result["total_detected"]}

    except Exception as e:
        import traceback
        err = traceback.format_exc()
        try:
            job.status    = models.NetFloraJobStatus.failed
            job.error     = str(e)[:500]
            job.current_step = f"Error: {str(e)[:100]}"
            db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()


def _get_sample_image(category: str, progress_cb=None) -> str:
    """
    Si no hay ortofoto, descarga una imagen de muestra del repo NetFlora
    para poder demostrar la detección.
    """
    import urllib.request
    from pathlib import Path

    samples_dir = Path("/tmp/netflora_samples")
    samples_dir.mkdir(exist_ok=True)

    # Imágenes de muestra del repo NetFlora
    SAMPLE_URLS = {
        "Açaí":      "https://github.com/NetFlora/NetFlora/raw/main/inference/images/Acai.jpg",
        "Palmeiras":  "https://github.com/NetFlora/NetFlora/raw/main/inference/images/Palmeiras.jpg",
        "PFNMs":      "https://github.com/NetFlora/NetFlora/raw/main/inference/images/PFMNs.jpg",
        "PMFS":       "https://github.com/NetFlora/NetFlora/raw/main/inference/images/PFMNs.jpg",
    }

    url = SAMPLE_URLS.get(category)
    if not url:
        raise ValueError(f"Sin imagen de muestra para categoría: {category}")

    ext = url.split(".")[-1]
    dest = samples_dir / f"sample_{category.lower().replace(' ', '_')}.{ext}"

    if not dest.exists():
        if progress_cb:
            progress_cb(8, f"Descargando imagen de muestra ({category})...")
        urllib.request.urlretrieve(url, dest)

    return str(dest)
