"""
NetFlora API — Detección de especies forestales amazónicas
Endpoints: /api/netflora/detect, /upload, /jobs/{job_id}, /species, /categories
"""
import uuid
import os
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db import models
from app.services.netflora_service import CATEGORY_SPECS, get_species_catalog, get_categories_catalog
from app.tasks.netflora_task import run_netflora_task
from app.config import settings

router = APIRouter(prefix="/api/netflora", tags=["netflora"])


# ─── Schemas ────────────────────────────────────────────────────────────────────────────────────────

class DetectRequest(BaseModel):
    analysis_id: Optional[str] = Field(None, description="ID de análisis de ForestAI (opcional)")
    file_id: Optional[str] = Field(None, description="ID del archivo subido vía /upload (opcional)")
    category: str = Field(..., description="Categoría NetFlora: Açaí, Palmeiras, PFNMs, PMFS")
    conf_threshold: float = Field(0.25, ge=0.05, le=0.95, description="Confianza mínima de detección")

class DetectResponse(BaseModel):
    job_id: str
    status: str
    category: str
    message: str

class UploadResponse(BaseModel):
    file_id: str
    filename: str
    filepath: str
    message: str

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    category: str
    progress: int
    current_step: Optional[str]
    total_detected: Optional[int]
    area_ha: Optional[float]
    processing_time_s: Optional[float]
    error: Optional[str]
    result: Optional[dict]
    created_at: str
    completed_at: Optional[str]


# ─── Endpoints ────────────────────────────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=UploadResponse, status_code=201)
async def upload_ortofoto(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Sube una ortofoto GeoTIFF para usar con NetFlora.
    Retorna file_id para pasar a /detect.
    """
    # Validar extensión
    if not file.filename.endswith((".tif", ".tiff")):
        raise HTTPException(status_code=422, detail="El archivo debe ser un GeoTIFF (.tif o .tiff)")

    # Validar tamaño
    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Archivo demasiado grande. Límite: {settings.MAX_UPLOAD_MB}MB")

    # Guardar archivo
    file_id = uuid.uuid4()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    filepath = os.path.join(settings.UPLOAD_DIR, f"netflora_{file_id}.tif")
    with open(filepath, "wb") as f:
        f.write(content)

    return UploadResponse(
        file_id=str(file_id),
        filename=file.filename,
        filepath=filepath,
        message="Ortofoto subida correctamente. Usá este file_id en /api/netflora/detect",
    )


@router.post("/detect", response_model=DetectResponse, status_code=202)
def detect_species(req: DetectRequest, db: Session = Depends(get_db)):
    """
    Lanza una detección NetFlora asíncrona.
    Si analysis_id está presente, usa el filepath de ese análisis.
    Si file_id está presente, usa el filepath del upload directo.
    Si ninguno, usa imagen de muestra del repo NetFlora.
    """
    # Validar categoría
    spec = CATEGORY_SPECS.get(req.category)
    if not spec:
        raise HTTPException(status_code=422, detail=f"Categoría desconocida: {req.category}")
    if not spec["available"]:
        raise HTTPException(
            status_code=422,
            detail=f"Modelo no disponible para '{req.category}'. Embrapa aún no publicó los pesos."
        )

    # Resolver filepath
    filepath = None
    if req.file_id:
        # Upload directo
        upload_path = os.path.join(settings.UPLOAD_DIR, f"netflora_{req.file_id}.tif")
        if not os.path.exists(upload_path):
            raise HTTPException(status_code=404, detail=f"Archivo no encontrado: {req.file_id}")
        filepath = upload_path
    elif req.analysis_id:
        # Análisis existente
        analysis = db.query(models.Analysis).filter(
            models.Analysis.id == req.analysis_id
        ).first()
        if not analysis:
            raise HTTPException(status_code=404, detail="Análisis no encontrado")
        if analysis.status != models.AnalysisStatus.completed:
            raise HTTPException(status_code=409, detail="El análisis no está completado aún")
        filepath = analysis.filepath

    # Crear job en BD
    job = models.NetFloraJob(
        analysis_id=uuid.UUID(req.analysis_id) if req.analysis_id else None,
        filepath=filepath,
        category=req.category,
        conf_threshold=req.conf_threshold,
        status=models.NetFloraJobStatus.queued,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    job_id = str(job.id)

    # Disparar tarea Celery
    run_netflora_task.delay(job_id, filepath, req.category, req.conf_threshold)

    return DetectResponse(
        job_id=job_id,
        status="queued",
        category=req.category,
        message=f"Detección de {req.category} encolada. Consultá /api/netflora/jobs/{job_id}",
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job_status(job_id: str, db: Session = Depends(get_db)):
    """Consulta el estado de un job NetFlora."""
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="job_id inválido")

    job = db.query(models.NetFloraJob).filter(models.NetFloraJob.id == job_uuid).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")

    return JobStatusResponse(
        job_id=str(job.id),
        status=job.status.value,
        category=job.category,
        progress=job.progress or 0,
        current_step=job.current_step,
        total_detected=job.total_detected,
        area_ha=job.area_ha,
        processing_time_s=job.processing_time_s,
        error=job.error,
        result=job.result_json,
        created_at=job.created_at.isoformat(),
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
    )


@router.get("/jobs")
def list_jobs(limit: int = 20, db: Session = Depends(get_db)):
    """Lista los últimos jobs NetFlora."""
    jobs = (
        db.query(models.NetFloraJob)
        .order_by(models.NetFloraJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "jobs": [
            {
                "job_id": str(j.id),
                "category": j.category,
                "status": j.status.value,
                "progress": j.progress or 0,
                "total_detected": j.total_detected,
                "area_ha": j.area_ha,
                "created_at": j.created_at.isoformat(),
            }
            for j in jobs
        ]
    }


@router.get("/species")
def get_species():
    """Catálogo completo de 72 especies NetFlora con nombres y categorías."""
    catalog = get_species_catalog()
    species_dict = catalog.get("species_dict", {})
    cat_map = catalog.get("categories", {})

    # Construir lookup especie → categoría
    specie_to_cat: dict = {}
    for cat_name, entries in cat_map.items():
        for entry in entries:
            specie_to_cat[entry.get("specie", "")] = cat_name

    result = []
    for code, info in species_dict.items():
        result.append({
            "species_id": code,
            "common_name": info.get("common_name"),
            "scientific_name": info.get("scientific_name"),
            "category": specie_to_cat.get(code),
        })

    return {"total": len(result), "species": result}


@router.get("/categories")
def get_categories():
    """Retorna las categorías disponibles con info de modelos."""
    result = []
    for cat, spec in CATEGORY_SPECS.items():
        result.append({
            "name": cat,
            "available": spec["available"],
            "model_file": spec["model_file"],
            "tile_size": spec["tile_size"],
            "overlap": spec["overlap"],
        })
    return {"categories": result}
