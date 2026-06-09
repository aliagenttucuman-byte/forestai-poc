"""
Celery task para detección de árboles con DeepForest + SAM.
Permite procesar imágenes grandes sin timeout HTTP.
"""
import os
import base64
import logging
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Almacén en memoria de resultados (suficiente para PoC)
_results: dict = {}


def get_task_result(task_id: str) -> dict | None:
    return _results.get(task_id)


def set_task_result(task_id: str, data: dict):
    _results[task_id] = data


@celery_app.task(bind=True, name="tree_detection.run", time_limit=7200, soft_time_limit=6900)
def run_tree_detection_task(self, image_path: str, original_filename: str = "image"):
    """
    Corre el pipeline completo de detección de árboles en background.
    Guarda el resultado en Redis para que el frontend pueda polling.
    """
    try:
        self.update_state(state="PROGRESS", meta={"status": "Cargando modelo DeepForest..."})
        from app.services.tree_detection import run_tree_detection

        self.update_state(state="PROGRESS", meta={"status": "Procesando tiles..."})
        result = run_tree_detection(image_path=image_path)

        annotated_b64 = base64.b64encode(result["annotated_image_bytes"]).decode()

        return {
            "status": "SUCCESS",
            "tree_count": result["tree_count"],
            "trees": result["trees"],
            "image_width": result["image_width"],
            "image_height": result["image_height"],
            "annotated_image_b64": annotated_b64,
            "used_sample": result.get("used_sample", False),
            "sam_used": result.get("sam_used", False),
            "vlm_used": result.get("vlm_used", False),
            "sample_name": original_filename,
        }
    except Exception as e:
        logger.exception(f"Error en tree detection task: {e}")
        return {"status": "FAILURE", "error": str(e)}
    finally:
        # Limpiar imagen temporal
        try:
            if os.path.exists(image_path):
                os.unlink(image_path)
        except Exception:
            pass
