import asyncio
import os
from datetime import datetime
from app.tasks.celery_app import celery_app
from app.db.session import SessionLocal
from app.db import models
from app.services.forest_analyzer import analyze_ortophoto
from app.services.vlm_classifier import classify_trees_vlm
import json
import numpy as np
from PIL import Image

@celery_app.task(bind=True, time_limit=7200, soft_time_limit=6900)
def run_analysis(self, analysis_id: str, filepath: str):
    db = SessionLocal()
    try:
        analysis = db.query(models.Analysis).filter(
            models.Analysis.id == analysis_id
        ).first()

        if not analysis:
            return {"error": "Analysis not found"}

        # Actualizar estado a processing
        analysis.status = models.AnalysisStatus.processing
        analysis.progress = 5
        analysis.current_step = "Iniciando análisis..."
        db.commit()

        def progress_callback(pct: int, step: str):
            analysis.progress = pct
            analysis.current_step = step
            db.commit()

        # Ejecutar pipeline
        trees_data = analyze_ortophoto(filepath, progress_callback)

        # Guardar árboles en BD
        progress_callback(80, f"Guardando {len(trees_data)} árboles en base de datos...")

        # Eliminar árboles anteriores de este análisis (si se reprocesa)
        db.query(models.Tree).filter(
            models.Tree.analysis_id == analysis_id
        ).delete()

        for tree in trees_data:
            # Construir geometría WKT para PostGIS
            coords = tree.get("polygon_coords", [])
            geom_wkt = None
            if len(coords) >= 4:
                coords_str = ", ".join(f"{lon} {lat}" for lon, lat in coords)
                geom_wkt = f"SRID=4326;POLYGON(({coords_str}))"

            db_tree = models.Tree(
                id=f"{analysis_id[:8]}-{tree['tree_id']}",
                analysis_id=analysis_id,
                species=tree["species"],
                crown_area_m2=tree["crown_area_m2"],
                height_m=tree["height_m"],
                biomass_kg=tree["biomass_kg"],
                age_years=tree["age_years"],
                confidence=tree["confidence"],
                centroid_lat=tree["centroid_lat"],
                centroid_lon=tree["centroid_lon"],
                allometric_source=tree["allometric_source"],
                r_mean=tree.get("r_mean"),
                g_mean=tree.get("g_mean"),
                b_mean=tree.get("b_mean"),
                texture_score=tree.get("texture_score"),
                geom=geom_wkt,
            )
            db.add(db_tree)

        db.commit()

        # --- Clasificación VLM (opcional) ---
        nvidia_key = (os.getenv("OPENCODE_API_KEY", "") or os.getenv("NVIDIA_API_KEY", "")).strip()
        if nvidia_key:
            progress_callback(83, "Clasificando árboles con Vision LLM...")
            try:
                # Cargar la imagen original para los crops
                # TIFs forestales pueden ser muy grandes — desactivar límite PIL
                Image.MAX_IMAGE_PIXELS = None
                image_arr = np.array(Image.open(filepath).convert("RGB"))
                H, W = image_arr.shape[:2]

                # Convertir lat/lon a coordenadas pixel (aproximado, escala lineal)
                lats = [t["centroid_lat"] for t in trees_data]
                lons = [t["centroid_lon"] for t in trees_data]
                lat_min, lat_max = min(lats), max(lats)
                lon_min, lon_max = min(lons), max(lons)

                trees_px = []
                for t in trees_data:
                    # crown_area_m2 → radio px (aprox)
                    import math
                    r_deg = math.sqrt(t.get("crown_area_m2", 16)) / 111_000
                    lat_range = lat_max - lat_min or 1e-6
                    lon_range = lon_max - lon_min or 1e-6
                    cx = int((t["centroid_lon"] - lon_min) / lon_range * (W - 1))
                    cy = int((1 - (t["centroid_lat"] - lat_min) / lat_range) * (H - 1))
                    r_px = max(15, int(r_deg / lon_range * W))
                    trees_px.append({
                        "xmin": max(0, cx - r_px),
                        "ymin": max(0, cy - r_px),
                        "xmax": min(W, cx + r_px),
                        "ymax": min(H, cy + r_px),
                    })

                # Celery también corre con event loop activo en algunos configs.
                # Usamos thread separado para evitar "cannot be called from a running event loop".
                import concurrent.futures

                def _run_vlm_celery():
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    try:
                        return loop.run_until_complete(
                            classify_trees_vlm(image_arr, trees_px, nvidia_key)
                        )
                    finally:
                        loop.close()

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    vlm_results = pool.submit(_run_vlm_celery).result(timeout=120)

                # Aplicar resultados a la BD
                db_trees = db.query(models.Tree).filter(
                    models.Tree.analysis_id == analysis_id
                ).all()
                tree_by_id = {t.id: t for t in db_trees}

                for vlm in vlm_results:
                    if not vlm.get("vlm_ok"):
                        continue
                    idx = vlm["tree_idx"]
                    tree_id = f"{analysis_id[:8]}-{trees_data[idx]['tree_id']}"
                    if tree_id in tree_by_id:
                        db_t = tree_by_id[tree_id]
                        db_t.vlm_species    = vlm.get("vlm_species")
                        db_t.vlm_health     = vlm.get("vlm_health")
                        db_t.vlm_confidence = vlm.get("vlm_confidence")
                        db_t.vlm_notes      = vlm.get("vlm_notes")

                db.commit()
                ok_count = sum(1 for v in vlm_results if v.get("vlm_ok"))
                progress_callback(90, f"VLM: {ok_count}/{len(trees_data)} árboles clasificados")
            except Exception as vlm_exc:
                # VLM es opcional — no fallar el análisis por esto
                import logging
                logging.getLogger(__name__).warning(f"VLM classification failed (non-fatal): {vlm_exc}")
                progress_callback(90, "VLM: clasificación omitida (ver logs)")

        # Completar
        analysis.status = models.AnalysisStatus.completed
        analysis.progress = 100
        analysis.current_step = f"Completado: {len(trees_data)} árboles detectados"
        analysis.tree_count = len(trees_data)
        analysis.completed_at = datetime.utcnow()
        db.commit()

        return {"tree_count": len(trees_data), "status": "completed"}

    except Exception as e:
        if analysis:
            analysis.status = models.AnalysisStatus.failed
            analysis.error = str(e)
            analysis.progress = 0
            db.commit()
        raise e
    finally:
        db.close()
