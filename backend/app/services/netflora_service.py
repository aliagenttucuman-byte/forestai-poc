"""
NetFlora Service — Detección de especies forestales amazónicas
Usa los modelos YOLOv7 preentrenados de Embrapa Acre / Fundo JBS Amazônia.

Repo oficial: https://github.com/NetFlora/Netflora
"""
import sys
import os
import json
import time
import math
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional

import numpy as np
import cv2
import torch

# ─── Paths ────────────────────────────────────────────────────────────────────
NETFLORA_REPO   = Path("/app/netflora_repo")
MODELS_DIR      = Path("/app/netflora_models")
SPECIES_JSON    = NETFLORA_REPO / "json" / "groups.json"
CATEGORIES_JSON = NETFLORA_REPO / "json" / "categories.json"

MODELS_DIR.mkdir(exist_ok=True)

# Agregar el repo de NetFlora al path para importar sus clases YOLOv7
if str(NETFLORA_REPO) not in sys.path:
    sys.path.insert(0, str(NETFLORA_REPO))

# ─── Catálogo de modelos por categoría ────────────────────────────────────────
CATEGORY_SPECS: Dict[str, Dict] = {
    "Açaí": {
        "model_file": "ACAI_Embrapa00.pt",
        "url": "https://github.com/NetFlora/Netflora/releases/download/Assets/ACAI_Embrapa00.pt",
        "tile_size": 1536,
        "overlap": 128,
        "available": True,
    },
    "Palmeiras": {
        "model_file": "PALMEIRAS_Embrapa00.pt",
        "url": "https://github.com/NetFlora/Netflora/releases/download/Assets/PALMEIRAS_Embrapa00.pt",
        "tile_size": 1536,
        "overlap": 256,
        "available": True,
    },
    "PFNMs": {
        "model_file": "NM_Embrapa00.pt",
        "url": "https://github.com/NetFlora/Netflora/releases/download/Assets/NM_Embrapa00.pt",
        "tile_size": 1536,
        "overlap": 512,
        "available": True,
    },
    "PMFS": {
        "model_file": "PMFS_Embrapa00.pt",
        "url": "https://github.com/NetFlora/Netflora/releases/download/Assets/PMFS_Embrapa00.pt",
        "tile_size": 1536,
        "overlap": 768,
        "available": True,
    },
    "Castanheira": {
        "model_file": None,
        "url": None,
        "tile_size": 2048,
        "overlap": 1024,
        "available": False,
    },
    "Ecológico": {
        "model_file": None,
        "url": None,
        "tile_size": 3000,
        "overlap": 0,
        "available": False,
    },
    "Ambiental": {
        "model_file": None,
        "url": None,
        "tile_size": 1536,
        "overlap": 256,
        "available": False,
    },
}

# ─── Cargar catálogo de especies ───────────────────────────────────────────────
def _load_species_catalog() -> Dict[str, Any]:
    if SPECIES_JSON.exists():
        with open(SPECIES_JSON, encoding="utf-8") as f:
            data = json.load(f)
        return data
    # Fallback embebido si el JSON no está disponible
    return {"species_dict": {}, "categories": {}}

def get_species_catalog() -> Dict[str, Any]:
    return _load_species_catalog()

def get_categories_catalog() -> List[Dict]:
    if CATEGORIES_JSON.exists():
        with open(CATEGORIES_JSON, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("categories", {})
    return {}


# ─── Descarga de modelos ───────────────────────────────────────────────────────
def _download_model(category: str, progress_cb: Optional[Callable] = None) -> Path:
    spec = CATEGORY_SPECS[category]
    if not spec["available"]:
        raise ValueError(f"Modelo no disponible para categoría: {category}")

    model_path = MODELS_DIR / spec["model_file"]
    if model_path.exists():
        return model_path

    url = spec["url"]
    if progress_cb:
        progress_cb(5, f"Descargando modelo {spec['model_file']}...")

    def _reporthook(count, block_size, total_size):
        if total_size > 0 and progress_cb:
            pct = min(int(count * block_size * 100 / total_size), 20)
            progress_cb(pct, f"Descargando {spec['model_file']} ({pct}%)...")

    urllib.request.urlretrieve(url, model_path, _reporthook)
    return model_path


# ─── Carga de modelo YOLOv7 ───────────────────────────────────────────────────
_model_cache: Dict[str, Any] = {}

def _load_model(model_path: Path) -> Any:
    key = str(model_path)
    if key in _model_cache:
        return _model_cache[key]

    model_data = torch.load(model_path, map_location="cpu", weights_only=False)
    model = model_data["model"]
    model.eval()
    model.float()

    # EMA si está disponible (mejora precisión)
    if "ema" in model_data and model_data["ema"]:
        ema = model_data["ema"]
        ema.eval()
        _model_cache[key] = ema
        return ema

    _model_cache[key] = model
    return model


# ─── Inferencia sobre un tile ─────────────────────────────────────────────────
def _infer_tile(model, img_rgb: np.ndarray, img_size: int, conf_thresh: float) -> List[Dict]:
    """
    Corre YOLOv7 sobre un tile RGB numpy array.
    Retorna lista de detecciones: {class_id, conf, x1, y1, x2, y2}
    """
    h, w = img_rgb.shape[:2]
    # Resize al tamaño esperado por el modelo manteniendo aspect ratio
    scale = img_size / max(h, w)
    new_h, new_w = int(h * scale), int(w * scale)
    resized = cv2.resize(img_rgb, (new_w, new_h))

    # Padding a img_size x img_size
    canvas = np.zeros((img_size, img_size, 3), dtype=np.uint8)
    canvas[:new_h, :new_w] = resized

    # Tensor [1, 3, H, W] normalizado 0-1
    tensor = torch.from_numpy(canvas).permute(2, 0, 1).float() / 255.0
    tensor = tensor.unsqueeze(0)

    with torch.no_grad():
        pred = model(tensor)[0]  # [1, N, 85+]

    # NMS manual
    from utils.general import non_max_suppression
    pred = non_max_suppression(pred, conf_thres=conf_thresh, iou_thres=0.45)

    detections = []
    if pred[0] is not None and len(pred[0]):
        for *xyxy, conf, cls in pred[0].tolist():
            # Desescalar al tamaño original del tile
            x1 = max(0, xyxy[0] / scale)
            y1 = max(0, xyxy[1] / scale)
            x2 = min(w, xyxy[2] / scale)
            y2 = min(h, xyxy[3] / scale)
            detections.append({
                "class_id": int(cls),
                "conf": round(float(conf), 4),
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            })
    return detections


# ─── Georreferenciación de detecciones ────────────────────────────────────────
def _pixel_to_geo(px: float, py: float, tile_col: int, tile_row: int,
                  tile_size: int, overlap: int,
                  img_w: int, img_h: int,
                  bounds: tuple) -> tuple:
    """
    Convierte coordenadas de píxel dentro de un tile a lat/lon.
    bounds = (left, bottom, right, top) en grados o metros (EPSG:4326).
    """
    left, bottom, right, top = bounds
    # Offset global del tile (considerando overlap)
    step = tile_size - overlap
    global_x = tile_col * step + px
    global_y = tile_row * step + py

    lon = left + (global_x / img_w) * (right - left)
    lat = top  - (global_y / img_h) * (top - bottom)
    return lat, lon


# ─── Pipeline principal ───────────────────────────────────────────────────────
def run_netflora_detection(
    image_path: str,
    category: str,
    conf_threshold: float = 0.25,
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> Dict[str, Any]:
    """
    Pipeline completo:
      1. Descarga modelo si no existe
      2. Carga la ortofoto GeoTIFF (o imagen RGB)
      3. Genera tiles con overlap
      4. Corre YOLOv7 en cada tile
      5. Georreferencia detecciones
      6. Aplica NMS global para eliminar duplicados entre tiles
      7. Retorna resumen + lista de detecciones

    Returns dict con:
      - category, conf_threshold
      - total_detected: int
      - area_ha: float
      - processing_time_s: float
      - species: [{ species_id, common_name, scientific_name, count, conf_avg }]
      - detections: [{ species_id, common_name, conf, lat, lon, bbox_px }]
    """
    spec = CATEGORY_SPECS.get(category)
    if not spec:
        raise ValueError(f"Categoría desconocida: {category}")
    if not spec["available"]:
        raise ValueError(f"Modelo no disponible para: {category}. Sin pesos públicos aún.")

    t0 = time.time()

    # 1. Descargar modelo
    model_path = _download_model(category, progress_cb)

    if progress_cb:
        progress_cb(22, "Cargando modelo YOLOv7...")
    model = _load_model(model_path)

    # Obtener nombres de especies del modelo
    model_names: List[str] = model.names if hasattr(model, "names") else []

    # Cargar catálogo de mapeo class_id → especie
    catalog = _load_species_catalog()
    categories_map = catalog.get("categories", {})
    cat_species = categories_map.get(category, [])  # [{specie, class_id}, ...]
    class_id_to_specie = {item["class_id"]: item["specie"] for item in cat_species}

    species_dict = catalog.get("species_dict", {})

    # 2. Cargar imagen
    if progress_cb:
        progress_cb(28, "Leyendo ortofoto...")

    bounds = None
    img_rgb = None

    # Intentar leer como GeoTIFF para obtener coordenadas reales
    try:
        import rasterio
        from rasterio.warp import reproject, Resampling, calculate_default_transform
        from rasterio.crs import CRS

        with rasterio.open(image_path) as src:
            # Reproyectar a EPSG:4326 si es necesario para tener bounds en lat/lon
            if src.crs and src.crs.to_epsg() != 4326:
                dst_crs = CRS.from_epsg(4326)
                transform, width, height = calculate_default_transform(
                    src.crs, dst_crs, src.width, src.height, *src.bounds
                )
            else:
                width, height = src.width, src.height

            # Limitar resolución para no reventar RAM
            MAX_DIM = 8000
            scale = min(MAX_DIM / src.width, MAX_DIM / src.height, 1.0)
            out_w = max(1, int(src.width * scale))
            out_h = max(1, int(src.height * scale))

            bands = min(src.count, 3)
            img_rgb = np.zeros((out_h, out_w, 3), dtype=np.uint8)
            for i in range(bands):
                band = src.read(i + 1, out_shape=(out_h, out_w), resampling=Resampling.average)
                # Normalizar a uint8
                bmin, bmax = band.min(), band.max()
                if bmax > bmin:
                    band = ((band - bmin) / (bmax - bmin) * 255).astype(np.uint8)
                else:
                    band = np.zeros_like(band, dtype=np.uint8)
                img_rgb[:, :, i] = band

            bounds = src.bounds  # (left, bottom, right, top)

    except Exception:
        # Fallback: leer como imagen normal con OpenCV
        img_bgr = cv2.imread(image_path)
        if img_bgr is None:
            raise ValueError(f"No se pudo leer la imagen: {image_path}")
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

    img_h, img_w = img_rgb.shape[:2]
    tile_size = spec["tile_size"]
    overlap = spec["overlap"]
    step = tile_size - overlap

    # Calcular grilla de tiles
    n_cols = max(1, math.ceil((img_w - overlap) / step))
    n_rows = max(1, math.ceil((img_h - overlap) / step))
    total_tiles = n_cols * n_rows

    if progress_cb:
        progress_cb(32, f"Generando {total_tiles} tiles ({n_cols}×{n_rows})...")

    # 3-4. Recorrer tiles y correr inferencia
    all_detections = []
    tile_idx = 0

    for row in range(n_rows):
        for col in range(n_cols):
            x1 = col * step
            y1 = row * step
            x2 = min(x1 + tile_size, img_w)
            y2 = min(y1 + tile_size, img_h)

            tile = img_rgb[y1:y2, x1:x2]
            if tile.size == 0:
                continue

            dets = _infer_tile(model, tile, tile_size, conf_threshold)

            for d in dets:
                # Coordenadas absolutas en la imagen global
                abs_x1 = x1 + d["x1"]
                abs_y1 = y1 + d["y1"]
                abs_x2 = x1 + d["x2"]
                abs_y2 = y1 + d["y2"]
                cx_px = (abs_x1 + abs_x2) / 2
                cy_px = (abs_y1 + abs_y2) / 2

                # Georreferenciar
                if bounds:
                    left, bottom, right, top = bounds.left, bounds.bottom, bounds.right, bounds.top
                    lon = left + (cx_px / img_w) * (right - left)
                    lat = top  - (cy_px / img_h) * (top  - bottom)
                else:
                    lat = lon = 0.0

                # Mapear class_id a especie
                class_id = d["class_id"]
                specie_code = class_id_to_specie.get(class_id, None)
                specie_info = species_dict.get(specie_code, {}) if specie_code else {}

                all_detections.append({
                    "class_id": class_id,
                    "specie_code": specie_code or f"cls_{class_id}",
                    "common_name": specie_info.get("common_name") or model_names[class_id] if class_id < len(model_names) else f"cls_{class_id}",
                    "scientific_name": specie_info.get("scientific_name"),
                    "conf": d["conf"],
                    "lat": round(lat, 7),
                    "lon": round(lon, 7),
                    "bbox_global": [abs_x1, abs_y1, abs_x2, abs_y2],
                })

            tile_idx += 1
            pct = 32 + int((tile_idx / total_tiles) * 55)
            if progress_cb and tile_idx % max(1, total_tiles // 10) == 0:
                progress_cb(pct, f"Procesando tile {tile_idx}/{total_tiles}...")

    # 5. NMS global (eliminar duplicados entre tiles)
    if progress_cb:
        progress_cb(88, "Eliminando detecciones duplicadas...")
    all_detections = _global_nms(all_detections, iou_thresh=0.5)

    # 6. Calcular área aproximada de la ortofoto en hectáreas
    area_ha = 0.0
    if bounds:
        import pyproj
        from shapely.geometry import box
        from pyproj import Transformer

        try:
            transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
            x_min, y_min = transformer.transform(bounds.left, bounds.bottom)
            x_max, y_max = transformer.transform(bounds.right, bounds.top)
            area_m2 = abs((x_max - x_min) * (y_max - y_min))
            area_ha = round(area_m2 / 10000, 2)
        except Exception:
            area_ha = 0.0

    # 7. Agrupar por especie
    species_counts: Dict[str, Dict] = {}
    for det in all_detections:
        code = det["specie_code"]
        if code not in species_counts:
            species_counts[code] = {
                "species_id": code,
                "common_name": det["common_name"],
                "scientific_name": det["scientific_name"],
                "count": 0,
                "conf_sum": 0.0,
            }
        species_counts[code]["count"] += 1
        species_counts[code]["conf_sum"] += det["conf"]

    species_summary = []
    for code, s in sorted(species_counts.items(), key=lambda x: -x[1]["count"]):
        species_summary.append({
            "species_id": s["species_id"],
            "common_name": s["common_name"],
            "scientific_name": s["scientific_name"],
            "count": s["count"],
            "conf_avg": round(s["conf_sum"] / s["count"], 3) if s["count"] else 0,
        })

    processing_time = round(time.time() - t0, 1)

    if progress_cb:
        progress_cb(100, "Detección completada")

    return {
        "category": category,
        "conf_threshold": conf_threshold,
        "total_detected": len(all_detections),
        "area_ha": area_ha,
        "processing_time_s": processing_time,
        "tiles_processed": tile_idx,
        "species": species_summary,
        "detections": all_detections[:2000],  # Cap para no reventar JSON
    }


# ─── NMS global entre tiles ───────────────────────────────────────────────────
def _iou_bbox(a: List[float], b: List[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _global_nms(detections: List[Dict], iou_thresh: float = 0.5) -> List[Dict]:
    if not detections:
        return []
    # Ordenar por confianza descendente
    sorted_dets = sorted(detections, key=lambda x: -x["conf"])
    kept = []
    suppressed = set()
    for i, det in enumerate(sorted_dets):
        if i in suppressed:
            continue
        kept.append(det)
        for j in range(i + 1, len(sorted_dets)):
            if j in suppressed:
                continue
            if sorted_dets[j]["class_id"] != det["class_id"]:
                continue
            iou = _iou_bbox(det["bbox_global"], sorted_dets[j]["bbox_global"])
            if iou > iou_thresh:
                suppressed.add(j)
    return kept
