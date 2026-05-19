import uuid, os, shutil
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import pandas as pd
import json

from app.db.session import get_db
from app.db import models
from app.models.schemas import (
    AnalysisCreated, AnalysisStatusResponse, AnalysisList,
    AnalysisSummaryItem, InventorySummary, SpeciesDistribution,
    TreeDetail, ErrorResponse,
)
from app.config import settings
from app.tasks.analysis_task import run_analysis

router = APIRouter(prefix="/api/analyses", tags=["analyses"])


def _check_completed(analysis):
    if analysis is None:
        raise HTTPException(status_code=404, detail="Análisis no encontrado")
    if analysis.status != models.AnalysisStatus.completed:
        raise HTTPException(status_code=409, detail="El análisis todavía está en progreso o falló")


@router.get("", response_model=AnalysisList)
def list_analyses(
    limit: int = Query(20, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    total = db.query(models.Analysis).count()
    items = (
        db.query(models.Analysis)
        .order_by(models.Analysis.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return AnalysisList(
        items=[
            AnalysisSummaryItem(
                analysis_id=a.id,
                filename=a.filename,
                name=a.name,
                status=a.status,
                created_at=a.created_at,
                tree_count=a.tree_count,
                error=a.error,
            )
            for a in items
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=AnalysisCreated, status_code=202)
async def create_analysis(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    # Validar extensión
    if not file.filename.endswith((".tif", ".tiff")):
        raise HTTPException(status_code=422, detail="El archivo debe ser un GeoTIFF (.tif o .tiff)")

    # Validar tamaño
    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Archivo demasiado grande. Límite: {settings.MAX_UPLOAD_MB}MB")

    # Guardar archivo
    analysis_id = uuid.uuid4()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    filepath = os.path.join(settings.UPLOAD_DIR, f"{analysis_id}.tif")
    with open(filepath, "wb") as f:
        f.write(content)

    # Crear registro en BD
    from datetime import datetime
    analysis = models.Analysis(
        id=analysis_id,
        name=name,
        filename=file.filename,
        filepath=filepath,
        status=models.AnalysisStatus.pending,
        progress=0,
        created_at=datetime.utcnow(),
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    # Lanzar tarea Celery
    run_analysis.delay(str(analysis_id), filepath)

    return AnalysisCreated(
        analysis_id=analysis.id,
        status=analysis.status,
        created_at=analysis.created_at,
        filename=analysis.filename,
    )


@router.get("/{analysis_id}", response_model=AnalysisStatusResponse)
def get_analysis_status(analysis_id: str, db: Session = Depends(get_db)):
    analysis = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Análisis no encontrado")

    return AnalysisStatusResponse(
        analysis_id=analysis.id,
        status=analysis.status,
        progress=analysis.progress,
        current_step=analysis.current_step,
        created_at=analysis.created_at,
        completed_at=analysis.completed_at,
        tree_count=analysis.tree_count,
        error=analysis.error,
    )


@router.get("/{analysis_id}/geojson")
def get_geojson(analysis_id: str, db: Session = Depends(get_db)):
    analysis = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    _check_completed(analysis)

    trees = db.query(models.Tree).filter(models.Tree.analysis_id == analysis_id).all()

    features = []
    for tree in trees:
        # Si hay geometría PostGIS, usarla; sino crear punto con centroide
        if tree.geom:
            from geoalchemy2.shape import to_shape
            geom = to_shape(tree.geom)
            geometry = geom.__geo_interface__
        else:
            geometry = {
                "type": "Point",
                "coordinates": [tree.centroid_lon, tree.centroid_lat]
            }

        features.append({
            "type": "Feature",
            "geometry": geometry,
            "properties": {
                "tree_id": tree.id,
                "species": tree.species,
                "crown_area_m2": tree.crown_area_m2,
                "height_m": tree.height_m,
                "biomass_kg": tree.biomass_kg,
                "age_years": tree.age_years,
                "confidence": tree.confidence,
                "centroid_lat": tree.centroid_lat,
                "centroid_lon": tree.centroid_lon,
                "allometric_source": tree.allometric_source,
            }
        })

    return {"type": "FeatureCollection", "features": features}


@router.get("/{analysis_id}/summary", response_model=InventorySummary)
def get_summary(analysis_id: str, db: Session = Depends(get_db)):
    analysis = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    _check_completed(analysis)

    trees = db.query(models.Tree).filter(models.Tree.analysis_id == analysis_id).all()

    if not trees:
        raise HTTPException(status_code=404, detail="No hay árboles en este análisis")

    total_trees = len(trees)
    total_biomass_kg = sum(t.biomass_kg for t in trees)
    total_crown_area_m2 = sum(t.crown_area_m2 for t in trees)
    avg_height = sum(t.height_m for t in trees) / total_trees
    avg_age = sum(t.age_years for t in trees) / total_trees

    # Distribución por especie
    species_map = {}
    for tree in trees:
        if tree.species not in species_map:
            species_map[tree.species] = {"count": 0, "total_biomass_kg": 0.0}
        species_map[tree.species]["count"] += 1
        species_map[tree.species]["total_biomass_kg"] += tree.biomass_kg

    distribution = [
        SpeciesDistribution(
            species=sp,
            count=data["count"],
            percentage=round(data["count"] / total_trees * 100, 1),
            total_biomass_kg=round(data["total_biomass_kg"], 2),
        )
        for sp, data in sorted(species_map.items(), key=lambda x: -x[1]["count"])
    ]

    return InventorySummary(
        analysis_id=analysis.id,
        total_trees=total_trees,
        total_biomass_tons=round(total_biomass_kg / 1000, 3),
        total_crown_area_ha=round(total_crown_area_m2 / 10000, 4),
        average_height_m=round(avg_height, 2),
        average_age_years=round(avg_age, 1),
        species_distribution=distribution,
        analyzed_at=analysis.completed_at,
        source_filename=analysis.filename,
    )


@router.get("/{analysis_id}/trees/{tree_id}", response_model=TreeDetail)
def get_tree_detail(analysis_id: str, tree_id: str, db: Session = Depends(get_db)):
    tree = db.query(models.Tree).filter(
        models.Tree.analysis_id == analysis_id,
        models.Tree.id == tree_id,
    ).first()

    if not tree:
        raise HTTPException(status_code=404, detail="Árbol no encontrado")

    return TreeDetail(
        tree_id=tree.id,
        species=tree.species,
        crown_area_m2=tree.crown_area_m2,
        height_m=tree.height_m,
        biomass_kg=tree.biomass_kg,
        age_years=tree.age_years,
        confidence=tree.confidence,
        centroid_lat=tree.centroid_lat,
        centroid_lon=tree.centroid_lon,
        allometric_source=tree.allometric_source,
        r_mean=tree.r_mean,
        g_mean=tree.g_mean,
        b_mean=tree.b_mean,
        texture_score=tree.texture_score,
    )


@router.get("/{analysis_id}/export")
def export_inventory(
    analysis_id: str,
    format: str = Query(..., enum=["csv", "geojson"]),
    db: Session = Depends(get_db),
):
    analysis = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    _check_completed(analysis)

    trees = db.query(models.Tree).filter(models.Tree.analysis_id == analysis_id).all()

    if format == "csv":
        rows = [{
            "tree_id": t.id, "species": t.species,
            "crown_area_m2": t.crown_area_m2, "height_m": t.height_m,
            "biomass_kg": t.biomass_kg, "age_years": t.age_years,
            "confidence": t.confidence, "lat": t.centroid_lat, "lon": t.centroid_lon,
            "allometric_source": t.allometric_source,
        } for t in trees]

        df = pd.DataFrame(rows)
        csv_content = df.to_csv(index=False)

        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=forestai_{analysis_id[:8]}.csv"},
        )

    elif format == "geojson":
        features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [t.centroid_lon, t.centroid_lat]},
                     "properties": {"tree_id": t.id, "species": t.species, "biomass_kg": t.biomass_kg}} for t in trees]
        geojson_str = json.dumps({"type": "FeatureCollection", "features": features}, indent=2)

        return StreamingResponse(
            iter([geojson_str]),
            media_type="application/geo+json",
            headers={"Content-Disposition": f"attachment; filename=forestai_{analysis_id[:8]}.geojson"},
        )
