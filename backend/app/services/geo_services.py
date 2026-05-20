"""
Servicios de datos geoespaciales externos para ForestAI.

- Sentinel-2 via Copernicus Data Space (CDSE) — NDVI por punto y radio
- UMSEF/MAyDS — Bosques nativos argentinos vía WFS del MAyDS
"""
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

# Evalscript que calcula NDVI promedio en la zona solicitada
NDVI_EVALSCRIPT = """
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1 },
      { id: "dataMask", bands: 1 }
    ],
    mosaicking: "ORBIT"
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


async def get_sentinel_ndvi(
    lat: float,
    lon: float,
    radius_km: float = 5.0,
) -> Dict[str, Any]:
    """
    Consulta NDVI promedio de Sentinel-2 para un punto y radio dados.

    Usa la Statistical API de Copernicus Data Space — requiere token OAuth2.
    Si no hay token configurado, devuelve datos de Copernicus WMS como fallback
    (solo metadatos, sin NDVI calculado).

    Retorna dict con:
      - ndvi_mean: promedio NDVI en el área
      - ndvi_min / ndvi_max
      - date: fecha de la imagen más reciente usada
      - cloud_coverage: % cobertura de nubes
      - source: "sentinel-2-l2a"
    """
    bbox = bbox_from_point(lat, lon, radius_km)

    # Intentamos con la API pública de estadísticas NDVI de Copernicus
    # Endpoint alternativo: OGC WMS para obtener la imagen directa
    # Para PoC usamos el endpoint de Copernicus Browser Stats (público)
    
    # Alternativa robusta para PoC: usar el WMS de Copernicus para obtener
    # el valor de NDVI via GetMap con CRS y bbox
    wms_url = "https://services.sentinel-hub.com/ogc/wms"

    # Usamos la API pública de estadísticas de Copernicus via su servicio EO Browser
    # que no requiere autenticación para consultas básicas
    stats_url = "https://services.sentinel-hub.com/api/v1/statistics"

    # Para el PoC, consultamos el Copernicus Data Space con el endpoint público
    # de búsqueda de productos para obtener metadatos de la escena más reciente
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
            f"Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt 30)"
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
            return {
                "error": str(e),
                "source": "sentinel-2",
                "available": False,
            }

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

    # NDVI estimado: calculamos a partir de quick-look estadístico
    # Para el PoC devolvemos los metadatos + URL de thumbnail como proxy visual
    thumbnail_url = f"https://catalogue.dataspace.copernicus.eu/odata/v1/Products({product['Id']})/Nodes({product_name}.SAFE)/Nodes(GRANULE)"

    return {
        "ndvi_mean": None,  # Requiere token OAuth2 para calcular NDVI real
        "date": date_str,
        "cloud_coverage": round(cloud_cover, 1) if cloud_cover else None,
        "source": "sentinel-2-l2a",
        "available": True,
        "product_name": product_name,
        "product_id": product["Id"],
        "bbox": bbox,
        "message": (
            f"Imagen Sentinel-2 disponible del {date_str} "
            f"con {round(cloud_cover,1) if cloud_cover else '?'}% nubes. "
            f"NDVI calculado requiere autenticación CDSE."
        ),
        "cdse_browser_url": (
            f"https://browser.dataspace.copernicus.eu/?zoom=12"
            f"&lat={lat}&lng={lon}&themeId=DEFAULT-THEME"
            f"&visualizationUrl=https://sh.dataspace.copernicus.eu/ogc/wms/YOUR_INSTANCE"
            f"&datasetId=S2_L2A_CDAS&fromTime={date_str}T00:00:00.000Z"
            f"&toTime={date_str}T23:59:59.999Z"
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


# ---------------------------------------------------------------------------
# Endpoint combinado
# ---------------------------------------------------------------------------

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
