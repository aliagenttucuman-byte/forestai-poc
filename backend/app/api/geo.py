"""
Endpoints de datos geoespaciales externos.

GET /api/geo/sentinel?lat=-26.8&lon=-65.2&radius_km=5
GET /api/geo/bosques?lat=-26.8&lon=-65.2&radius_km=10
GET /api/geo/context?lat=-26.8&lon=-65.2&radius_km=10
"""
from fastapi import APIRouter, Query, HTTPException
from app.services.geo_services import (
    get_sentinel_ndvi,
    get_bosques_nativos,
    get_geo_context,
)

router = APIRouter(prefix="/api/geo", tags=["geo"])


@router.get("/sentinel")
async def sentinel_ndvi(
    lat: float = Query(..., description="Latitud decimal (ej: -26.8)"),
    lon: float = Query(..., description="Longitud decimal (ej: -65.2)"),
    radius_km: float = Query(5.0, ge=1.0, le=100.0, description="Radio en km (1–100)"),
):
    """
    Consulta imagen Sentinel-2 más reciente con <30% nubes para la zona.
    Devuelve metadatos de la escena: fecha, nubosidad, disponibilidad.
    """
    if not (-55.0 <= lat <= -21.0 and -74.0 <= lon <= -53.0):
        raise HTTPException(
            status_code=400,
            detail="Coordenadas fuera del territorio argentino. Usar lat entre -55 y -21, lon entre -74 y -53."
        )
    return await get_sentinel_ndvi(lat, lon, radius_km)


@router.get("/bosques")
async def bosques_nativos(
    lat: float = Query(..., description="Latitud decimal (ej: -26.8)"),
    lon: float = Query(..., description="Longitud decimal (ej: -65.2)"),
    radius_km: float = Query(10.0, ge=1.0, le=100.0, description="Radio en km (1–100)"),
):
    """
    Consulta cobertura de bosques nativos y categoría OTBN para la zona.
    Fuente: MAyDS - UMSEF (geo.ambiente.gob.ar WFS).
    """
    if not (-55.0 <= lat <= -21.0 and -74.0 <= lon <= -53.0):
        raise HTTPException(
            status_code=400,
            detail="Coordenadas fuera del territorio argentino."
        )
    return await get_bosques_nativos(lat, lon, radius_km)


@router.get("/context")
async def geo_context(
    lat: float = Query(..., description="Latitud decimal (ej: -26.8)"),
    lon: float = Query(..., description="Longitud decimal (ej: -65.2)"),
    radius_km: float = Query(10.0, ge=1.0, le=100.0, description="Radio en km (1–100)"),
):
    """
    Consulta combinada: Sentinel-2 + Bosques Nativos en paralelo.
    Endpoint principal para el frontend.
    """
    if not (-55.0 <= lat <= -21.0 and -74.0 <= lon <= -53.0):
        raise HTTPException(
            status_code=400,
            detail="Coordenadas fuera del territorio argentino."
        )
    return await get_geo_context(lat, lon, radius_km)
