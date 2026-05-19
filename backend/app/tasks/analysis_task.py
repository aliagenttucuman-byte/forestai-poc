from datetime import datetime
from app.tasks.celery_app import celery_app
from app.db.session import SessionLocal
from app.db import models
from app.services.forest_analyzer import analyze_ortophoto
import json

@celery_app.task(bind=True)
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
