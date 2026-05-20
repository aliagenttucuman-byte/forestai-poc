"""
Servicios de datos geoespaciales externos para ForestAI.

- Sentinel-2 via Copernicus Data Space (CDSE) — NDVI por punto y radio
- UMSEF/MAyDS — Bosques nativos argentinos vía WFS del MAyDS
"""
import os
import httpx
import math
from typing import Dict, Any, Optional, List


# ---------------------------------------------------------------------------
# Helpers geométricos
# ---------------------------------------------------------------------------

def bbox_from_point(lat: float, lon: float, radius_km: float) -> Dict[str, float]:
    """Calcula bounding box a partir de un punto y radio en km."""
    # 1 grado lat ≈ 111 km
    delta_lat = radius_km / 111.0
    delta_lon = radius_km / (111.0 * math.cos(math.radians(lat)))
    return {
        "min_lon": lon - delta_lon,
        "min_lat": lat - delta_lat,
        "max_lon": lon + delta_lon,
        "max_lat": lat + delta_lat,
    }


def wkt_circle(lat: float, lon: float, radius_km: float, points: int = 32) -> str:
    """Genera WKT POLYGON aproximando un círculo (para WFS CQL_FILTER)."""
    coords = []
    for i in range(points + 1):
        angle = 2 * math.pi * i / points
        dlat = (radius_km / 111.0) * math.sin(angle)
        dlon = (radius_km / (111.0 * math.cos(math.radians(lat)))) * math.cos(angle)
        coords.append(f"{lon + dlon} {lat + dlat}")
    return f"POLYGON(({', '.join(coords)}))"


# ---------------------------------------------------------------------------
# Sentinel-2 — NDVI via Copernicus Data Space Ecosystem (CDSE)
# Endpoint: Statistical API (no requiere token para consultas básicas de NDVI)
# Documentación: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Statistical.html
# ---------------------------------------------------------------------------

CDSE_STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics"
CDSE_TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"

# Evalscript que calcula NDVI promedio en la zona solicitada
NDVI_EVALSCRIPT = """
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1 },
      { id: "dataMask", bands: 1 }
    ]
  };
}
function evaluatePixel(samples) {
  let ndvi = (samples.B08 - samples.B04) / (samples.B08 + samples.B04 + 0.0001);
  return {
    ndvi: [ndvi],
    dataMask: [samples.dataMask]
  };
}
"""

async def _get_cdse_token() -> Optional[str]:
    """Obtiene token OAuth2 de Copernicus Data Space."""
    user = os.environ.get("CDSE_USER")
    password = os.environ.get("CDSE_PASSWORD")
    if not user or not password:
        return None
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                CDSE_TOKEN_URL,
                data={
                    "grant_type": "password",
                    "username": user,
                    "password": password,
                    "client_id": "cdse-public",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
            return resp.json().get("access_token")
        except Exception:
            return None


async def get_sentinel_ndvi(
    lat: float,
    lon: float,
    radius_km: float = 5.0,
) -> Dict[str, Any]:
    """
    Consulta NDVI promedio de Sentinel-2 para un punto y radio dados.

    Usa la Statistical API de Copernicus Data Space con OAuth2 (CDSE_USER + CDSE_PASSWORD).
    Si no hay credenciales configuradas, devuelve solo metadatos sin NDVI.

    Retorna dict con:
      - ndvi_mean: promedio NDVI en el área
      - ndvi_min / ndvi_max
      - date: fecha de la imagen más reciente usada
      - cloud_coverage: % cobertura de nubes
      - source: "sentinel-2-l2a"
    """
    from datetime import datetime, timedelta

    bbox = bbox_from_point(lat, lon, radius_km)

    # 1. Buscar imagen más reciente con < 30% nubes (endpoint público, sin auth)
    search_url = "https://catalogue.dataspace.copernicus.eu/odata/v1/Products"
    params = {
        "$filter": (
            f"Collection/Name eq 'SENTINEL-2' and "
            f"OData.CSC.Intersects(area=geography'SRID=4326;POLYGON(("
            f"{bbox['min_lon']} {bbox['min_lat']},"
            f"{bbox['max_lon']} {bbox['min_lat']},"
            f"{bbox['max_lon']} {bbox['max_lat']},"
            f"{bbox['min_lon']} {bbox['max_lat']},"
            f"{bbox['min_lon']} {bbox['min_lat']}"
            f"))') and "
            f"Attributes/OData.CSC.DoubleAttribute/any("
            f"att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt 30)"
        ),
        "$orderby": "ContentDate/Start desc",
        "$top": 1,
        "$expand": "Attributes",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(search_url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            return {"error": str(e), "source": "sentinel-2", "available": False}

    products = data.get("value", [])
    if not products:
        return {
            "ndvi_mean": None,
            "date": None,
            "cloud_coverage": None,
            "source": "sentinel-2-l2a",
            "available": False,
            "message": "No hay imágenes disponibles con <30% nubes en esta zona.",
            "bbox": bbox,
        }

    product = products[0]
    attrs = {a["Name"]: a.get("Value") for a in product.get("Attributes", [])}
    cloud_cover = attrs.get("cloudCover")
    date_str = product.get("ContentDate", {}).get("Start", "")[:10]
    product_name = product.get("Name", "")

    # 2. Obtener token OAuth2 y calcular NDVI con Statistical API
    token = await _get_cdse_token()
    ndvi_mean = ndvi_min = ndvi_max = None
    ndvi_error = None

    if token and date_str:
        # Rango temporal: últimos 30 días desde la imagen encontrada
        try:
            d = datetime.fromisoformat(date_str)
        except Exception:
            d = datetime.utcnow()
        time_from = (d - timedelta(days=30)).strftime("%Y-%m-%dT00:00:00Z")
        time_to = d.strftime("%Y-%m-%dT23:59:59Z")

        stats_payload = {
            "input": {
                "bounds": {
                    "bbox": [bbox["min_lon"], bbox["min_lat"], bbox["max_lon"], bbox["max_lat"]],
                },
                "data": [{
                    "type": "sentinel-2-l2a",
                    "dataFilter": {"maxCloudCoverage": 30},
                }],
            },
            "aggregation": {
                "timeRange": {"from": time_from, "to": time_to},
                "aggregationInterval": {"of": "P30D"},
                "evalscript": NDVI_EVALSCRIPT,
                "width": 256,
                "height": 256,
            },
            "calculations": {
                "ndvi": {
                    "statistics": {"default": {}},
                }
            },
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                r = await client.post(
                    CDSE_STATS_URL,
                    json=stats_payload,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                )
                if r.status_code == 200:
                    result = r.json()
                    intervals = result.get("data", [])
                    if intervals:
                        outputs = intervals[0].get("outputs", {})
                        stats = outputs.get("ndvi", {}).get("bands", {}).get("B0", {}).get("stats", {})
                        import math
                        def _f(v):
                            if v is None:
                                return None
                            fv = float(v)
                            return round(fv, 3) if math.isfinite(fv) else None
                        ndvi_mean = _f(stats.get("mean"))
                        ndvi_min = _f(stats.get("min"))
                        ndvi_max = _f(stats.get("max"))
                else:
                    ndvi_error = f"Statistical API HTTP {r.status_code}: {r.text[:200]}"
            except Exception as e:
                ndvi_error = str(e)

    return {
        "ndvi_mean": ndvi_mean,
        "ndvi_min": ndvi_min,
        "ndvi_max": ndvi_max,
        "date": date_str,
        "cloud_coverage": round(cloud_cover, 1) if cloud_cover else None,
        "source": "sentinel-2-l2a",
        "available": True,
        "product_name": product_name,
        "product_id": product["Id"],
        "bbox": bbox,
        "ndvi_error": ndvi_error,
        "message": (
            f"Imagen Sentinel-2 del {date_str} con "
            f"{round(cloud_cover,1) if cloud_cover else '?'}% nubes. "
            + (f"NDVI medio: {ndvi_mean}" if ndvi_mean is not None else
               ("NDVI no disponible: " + (ndvi_error or "sin credenciales")))
        ),
    }


# ---------------------------------------------------------------------------
# UMSEF / MAyDS — Bosques Nativos Argentinos via WFS
# Endpoint: https://geo.ambiente.gob.ar/geoserver/wfs
# ---------------------------------------------------------------------------

UMSEF_WFS_URL = "https://geo.ambiente.gob.ar/geoserver/wfs"

# Capas reales del WFS de ambiente.gob.ar (verificadas via GetCapabilities)
UMSEF_LAYERS = {
    "bosques_nativos": "bosques:bap_pinb_umsef_3857",   # Bosque Nativo consolidado UMSEF
    "otbn_chaco": "bosques:CH_2009_OTBN",               # OTBN Chaco
    "otbn_formosa": "bosques:FS_2018_OTBN",             # OTBN Formosa
    "otbn_salta": "bosques:ST_2009_OTBN",               # OTBN Salta
    "otbn_misiones": "bosques:MS_2015_OTBN",            # OTBN Misiones
    "otbn_entre_rios": "bosques:ER_2014_OTBN",          # OTBN Entre Ríos
    "otbn_buenos_aires": "bosques:BA_2016_OTBN",        # OTBN Buenos Aires
    "otbn_jujuy": "bosques:JJ_2018_OTBN",              # OTBN Jujuy
    "otbn_santa_fe": "bosques:SF_2022_OTBN",            # OTBN Santa Fe
    "otbn_cordoba": "bosques:CD_2010_OTBN",             # OTBN Córdoba
    "otbn_corrientes": "bosques:CS_2010_OTBN",          # OTBN Corrientes
    "otbn_catamarca": "bosques:CM_2010_OTBN",           # OTBN Catamarca
}

OTBN_CATEGORIAS = {
    "I": {"nombre": "Rojo", "descripcion": "Muy alto valor de conservación. No puede desmontarse.", "color": "#e53e3e"},
    "II": {"nombre": "Amarillo", "descripcion": "Mediano valor de conservación. Uso sostenible posible.", "color": "#d69e2e"},
    "III": {"nombre": "Verde", "descripcion": "Bajo valor de conservación. Puede transformarse bajo condiciones.", "color": "#38a169"},
}


async def get_bosques_nativos(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
) -> Dict[str, Any]:
    """
    Consulta la cobertura de bosques nativos y categoría OTBN
    para un punto y radio dados, via WFS del MAyDS.
    """
    bbox = bbox_from_point(lat, lon, radius_km)
    bbox_str = f"{bbox['min_lon']},{bbox['min_lat']},{bbox['max_lon']},{bbox['max_lat']}"

    results = {}

    async with httpx.AsyncClient(timeout=20.0) as client:
        for layer_key, layer_name in UMSEF_LAYERS.items():
            params = {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeName": layer_name,
                "bbox": f"{bbox_str},EPSG:4326",
                "outputFormat": "application/json",
                "count": 50,
                "srsName": "EPSG:4326",
            }
            try:
                resp = await client.get(UMSEF_WFS_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    features = data.get("features", [])
                    results[layer_key] = {
                        "count": len(features),
                        "features": features[:10],  # máx 10 para no sobrecargar
                        "available": True,
                    }
                else:
                    results[layer_key] = {
                        "available": False,
                        "error": f"HTTP {resp.status_code}",
                    }
            except Exception as e:
                results[layer_key] = {
                    "available": False,
                    "error": str(e),
                }

    # Procesar OTBN si está disponible — capas por provincia
    categorias_encontradas = []
    for layer_key, layer_data in results.items():
        if not layer_key.startswith("otbn_"):
            continue
        features = layer_data.get("features", [])
        for feat in features:
            props = feat.get("properties", {})
            # Buscar campo de categoría en distintos nombres posibles
            cat = (props.get("cat_cons") or props.get("categoria") or
                   props.get("CATEGORIA") or props.get("cat") or
                   props.get("CAT") or props.get("categoria_otbn"))
            clase = props.get("clase", "")
            area_ha = props.get("area_ha")
            if cat:
                cat_str = str(cat).strip().upper()
                info = OTBN_CATEGORIAS.get(cat_str, {
                    "nombre": cat_str,
                    "descripcion": "Categoría OTBN",
                    "color": "#718096"
                })
                provincia = (props.get("provincia") or props.get("PROVINCIA") or
                            layer_key.replace("otbn_", "").replace("_", " ").title())
                entry = {
                    "categoria": cat_str,
                    **info,
                    "provincia": provincia,
                    "clase": clase,
                    "area_ha": area_ha,
                }
                if entry not in categorias_encontradas:
                    categorias_encontradas.append(entry)

    # Cobertura de bosque nativo
    bosques_count = results.get("bosques_nativos", {}).get("count", 0)
    # Fallback: si hay features OTBN con clase "Bosque Nativo", también cuenta
    tiene_bosque_otbn = any(
        feat.get("properties", {}).get("clase", "") == "Bosque Nativo"
        for layer_key, layer_data in results.items()
        if layer_key.startswith("otbn_")
        for feat in layer_data.get("features", [])
    )
    tiene_bosque = bosques_count > 0 or tiene_bosque_otbn

    return {
        "lat": lat,
        "lon": lon,
        "radius_km": radius_km,
        "bbox": bbox,
        "tiene_bosque_nativo": tiene_bosque,
        "area_bosque_features": bosques_count,
        "categorias_otbn": categorias_encontradas,
        "deforestacion_registrada": results.get("deforestacion", {}).get("count", 0) > 0,
        "raw": {k: {"available": v.get("available"), "count": v.get("count", 0)}
                for k, v in results.items()},
        "fuente": "MAyDS - UMSEF (geo.ambiente.gob.ar)",
        "mas_info": "https://www.argentina.gob.ar/ambiente/bosques/umsef",
    }


async def get_sentinel_preview(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
    layer: str = "TRUE_COLOR",
) -> Optional[bytes]:
    """
    Descarga imagen PNG de Sentinel-2 para la zona via Sentinel Hub WMS (CDSE).
    layer: TRUE_COLOR | NDVI (coloreado verde)
    Retorna bytes PNG o None si falla.
    """
    token = await _get_cdse_token()
    if not token:
        return None

    bbox = bbox_from_point(lat, lon, radius_km)

    # Evalscripts por capa
    evalscripts = {
        "TRUE_COLOR": """//VERSION=3
function setup() { return { input: ["B04","B03","B02"], output: { bands: 3 } }; }
function evaluatePixel(s) {
  return [3.5*s.B04, 3.5*s.B03, 3.5*s.B02];
}""",
        "NDVI": """//VERSION=3
function setup() { return { input: ["B08","B04"], output: { bands: 3 } }; }
function evaluatePixel(s) {
  let ndvi = (s.B08 - s.B04) / (s.B08 + s.B04 + 0.0001);
  if (ndvi < 0)   return [0.5, 0.5, 0.5];
  if (ndvi < 0.2) return [0.9, 0.8, 0.2];
  if (ndvi < 0.4) return [0.5, 0.8, 0.2];
  if (ndvi < 0.6) return [0.1, 0.6, 0.1];
  return [0.0, 0.4, 0.0];
}""",
    }

    evalscript = evalscripts.get(layer, evalscripts["TRUE_COLOR"])

    payload = {
        "input": {
            "bounds": {
                "bbox": [bbox["min_lon"], bbox["min_lat"], bbox["max_lon"], bbox["max_lat"]],
            },
            "data": [{
                "type": "sentinel-2-l2a",
                "dataFilter": {"maxCloudCoverage": 30},
            }],
        },
        "output": {
            "width": 512,
            "height": 512,
            "responses": [{"identifier": "default", "format": {"type": "image/png"}}],
        },
        "evalscript": evalscript,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.post(
                "https://sh.dataspace.copernicus.eu/api/v1/process",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            if r.status_code == 200:
                return r.content
            return None
        except Exception:
            return None


async def get_geo_context(
    lat: float,
    lon: float,
    radius_km: float = 10.0,
) -> Dict[str, Any]:
    """
    Consulta combinada: Sentinel-2 + Bosques Nativos para un punto y radio.
    """
    import asyncio
    sentinel_task = get_sentinel_ndvi(lat, lon, radius_km)
    bosques_task = get_bosques_nativos(lat, lon, radius_km)

    sentinel_result, bosques_result = await asyncio.gather(
        sentinel_task, bosques_task, return_exceptions=True
    )

    return {
        "sentinel2": sentinel_result if not isinstance(sentinel_result, Exception) else {"error": str(sentinel_result)},
        "bosques_nativos": bosques_result if not isinstance(bosques_result, Exception) else {"error": str(bosques_result)},
    }
