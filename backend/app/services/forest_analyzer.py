"""
Pipeline de análisis forestal: lectura del GeoTIFF, segmentación de copas,
clasificación de especie, cálculo de métricas.
Sin machine learning: OBIA + watershed + reglas de color.
"""
import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling
from rasterio.crs import CRS
import cv2
from shapely.geometry import shape, mapping, Polygon
from shapely.ops import transform as shapely_transform
import pyproj
from typing import List, Dict, Any, Callable
import math

from app.services.allometric import (
    classify_species,
    estimate_biomass,
    estimate_age,
    get_allometric_source,
)


def load_raster(filepath: str) -> Dict[str, Any]:
    """
    Carga el GeoTIFF y reproyecta a EPSG:4326 si es necesario.
    Retorna dict con array RGB, transform, crs, bounds.
    """
    MAX_DIM = 6000  # máx 6000px por lado para no reventar RAM

    with rasterio.open(filepath) as src:
        orig_w, orig_h = src.width, src.height
        scale = min(MAX_DIM / orig_w, MAX_DIM / orig_h, 1.0)

        out_w = max(1, int(orig_w * scale))
        out_h = max(1, int(orig_h * scale))

        # Leer las 3 bandas RGB con resampling si es necesario
        if src.count >= 3:
            r = src.read(1, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
            g = src.read(2, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
            b = src.read(3, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
        else:
            gray = src.read(1, out_shape=(out_h, out_w), resampling=Resampling.average).astype(np.float32)
            r = g = b = gray

        crs = src.crs
        bounds = src.bounds

        # Recalcular transform ajustado al nuevo tamaño
        from rasterio.transform import from_bounds
        transform = from_bounds(bounds.left, bounds.bottom, bounds.right, bounds.top, out_w, out_h)

        # Resolución en metros por píxel (basada en tamaño real del bounds)
        width_m = bounds.right - bounds.left
        height_m_geo = bounds.top - bounds.bottom

        if crs and crs.is_geographic:
            center_lat = (bounds.top + bounds.bottom) / 2
            width_m = width_m * 111319 * math.cos(math.radians(center_lat))
            height_m_geo = height_m_geo * 111319

        resolution_m = (width_m / out_w + height_m_geo / out_h) / 2

        return {
            "r": r, "g": g, "b": b,
            "crs": crs,
            "transform": transform,
            "bounds": bounds,
            "resolution_m": resolution_m,
            "width": out_w,
            "height": out_h,
        }


def segment_crowns(raster: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Segmenta las copas individuales usando watershed en OpenCV.
    Retorna lista de regiones detectadas con polígonos pixel-space.
    """
    r, g, b = raster["r"], raster["g"], raster["b"]

    # Normalizar a uint8
    def norm(band):
        mn, mx = band.min(), band.max()
        if mx == mn:
            return np.zeros_like(band, dtype=np.uint8)
        return ((band - mn) / (mx - mn) * 255).astype(np.uint8)

    r8, g8, b8 = norm(r), norm(g), norm(b)
    img_rgb = cv2.merge([b8, g8, r8])  # BGR para OpenCV

    # Canal de vegetación: VARI (Visible Atmospherically Resistant Index)
    # VARI = (G - R) / (G + R - B), simplificado para RGB drone
    g_f = g.astype(np.float32)
    r_f = r.astype(np.float32)
    b_f = b.astype(np.float32)
    denom = g_f + r_f - b_f
    denom[denom == 0] = 1
    vari = (g_f - r_f) / denom
    vari = np.clip(vari, -1, 1)
    vari_norm = ((vari + 1) / 2 * 255).astype(np.uint8)

    # Umbral adaptativo de vegetación usando Otsu sobre VARI
    # Esto funciona aunque toda la imagen sea "verde" — encuentra la separación natural
    otsu_thresh, thresh = cv2.threshold(vari_norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Si Otsu deja más del 90% como vegetación, usar percentil 40 como umbral
    # Percentil más bajo = más selectivo = mejor separación árboles vs pasto denso
    veg_fraction = thresh.sum() / (255 * thresh.size)
    if veg_fraction > 0.90:
        percentile_thresh = int(np.percentile(vari_norm, 40))
        _, thresh = cv2.threshold(vari_norm, percentile_thresh, 255, cv2.THRESH_BINARY)

    # Limpieza morfológica
    kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_DILATE, kernel, iterations=1)

    # Distance transform para separar árboles
    dist_transform = cv2.distanceTransform(thresh, cv2.DIST_L2, 5)
    # Factor fijo: 0.40 es el punto de equilibrio entre separar árboles tocantes
    # y no perder árboles pequeños. No varía por densidad de verde — eso causaba
    # que en silvopastoral (mucho pasto verde) se detectaran menos árboles.
    dt_factor = 0.40
    _, sure_fg = cv2.threshold(dist_transform, dt_factor * dist_transform.max(), 255, 0)
    sure_fg = sure_fg.astype(np.uint8)

    # Watershed
    sure_bg = cv2.dilate(thresh, kernel, iterations=3)
    unknown = cv2.subtract(sure_bg, sure_fg)

    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0

    markers_ws = markers.copy()
    cv2.watershed(img_rgb, markers_ws)

    # Resolución para convertir px² → m²
    resolution_check = raster["resolution_m"]

    # Extraer contornos por región con filtros de árbol vs pasto
    crowns = []
    unique_labels = np.unique(markers_ws)

    for label in unique_labels:
        if label <= 1:  # fondo y borde
            continue

        mask = (markers_ws == label).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            continue

        cnt = max(contours, key=cv2.contourArea)
        area_px = cv2.contourArea(cnt)

        # --- Filtro 1: Área en m² (INTA: copa mín 2m², máx 80m²) ---
        area_m2_check = area_px * (resolution_check ** 2)
        if area_m2_check < 2.0 or area_m2_check > 80.0:
            continue

        # --- Filtro 2: Circularidad ---
        # Árbol visto desde arriba ≈ círculo (copa redonda).
        # Pasto y arbustos rastreros son elongados o muy irregulares.
        # Circularidad = 4π * área / perímetro² → 1.0 es círculo perfecto
        # Umbral: > 0.15 — permisivo para copas asimétricas pero rechaza manchas largas
        perimeter = cv2.arcLength(cnt, True)
        if perimeter < 1:
            continue
        circularity = (4 * math.pi * area_px) / (perimeter ** 2)
        if circularity < 0.15:
            continue

        # Filtro de textura removido — demasiado restrictivo para copas irregulares.
        # Solo se usa circularity como filtro de forma.
        mask_bool = mask > 0
        g_vals_local = g[mask_bool]
        if len(g_vals_local) < 4:
            continue
        local_variance = float(np.var(g_vals_local))

        r_vals = r[mask_bool]
        b_vals = b[mask_bool]

        crowns.append({
            "contour": cnt,
            "area_px": area_px,
            "circularity": round(circularity, 3),
            "local_variance": round(local_variance, 1),
            "r_mean": float(np.mean(r_vals)),
            "g_mean": float(np.mean(g_vals_local)),
            "b_mean": float(np.mean(b_vals)),
        })

    return crowns


def compute_texture(contour: np.ndarray, raster: Dict[str, Any]) -> float:
    """Calcula score de textura (rugosidad de la copa) via LBP simplificado."""
    # Proxy simple: varianza del canal verde normalizada
    mask = np.zeros((raster["height"], raster["width"]), dtype=np.uint8)
    cv2.drawContours(mask, [contour], -1, 255, -1)
    g_vals = raster["g"][mask > 0]
    if len(g_vals) == 0:
        return 0.5
    variance = float(np.var(g_vals))
    # Normalizar a 0-1
    return float(min(variance / 2000.0, 1.0))


def pixel_to_geo(contour: np.ndarray, transform) -> List[tuple]:
    """Convierte contorno en píxeles a coordenadas geográficas."""
    coords = []
    for point in contour[:, 0, :]:
        px, py = int(point[0]), int(point[1])
        lon, lat = transform * (px, py)
        coords.append((lon, lat))
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])  # cerrar polígono
    return coords


def reproject_coords_to_wgs84(coords: List[tuple], src_crs) -> List[tuple]:
    """Reproyecta coordenadas de cualquier CRS a EPSG:4326."""
    if src_crs is None or str(src_crs) == "EPSG:4326":
        return coords

    try:
        transformer = pyproj.Transformer.from_crs(src_crs, "EPSG:4326", always_xy=True)
        reprojected = [transformer.transform(x, y) for x, y in coords]
        return reprojected
    except Exception:
        return coords


def analyze_ortophoto(filepath: str, progress_callback: Callable = None) -> List[Dict[str, Any]]:
    """
    Pipeline completo de análisis forestal.
    Retorna lista de árboles detectados con todas sus métricas.
    """
    results = []

    # Paso 1: Cargar raster (25%)
    if progress_callback:
        progress_callback(10, "Cargando ortofoto...")
    raster = load_raster(filepath)
    if progress_callback:
        progress_callback(25, "Ortofoto cargada. Segmentando copas...")

    # Paso 2: Segmentar copas (50%)
    crowns = segment_crowns(raster)
    if progress_callback:
        progress_callback(50, f"{len(crowns)} copas detectadas. Clasificando especies...")

    # Paso 3: Clasificar y calcular métricas (75%)
    resolution = raster["resolution_m"]

    for idx, crown in enumerate(crowns):
        contour = crown["contour"]

        # Área en m²
        area_px = crown["area_px"]
        area_m2 = area_px * (resolution ** 2)

        # Altura estimada desde el radio de la copa
        # Relación empírica: height ≈ 2.5 * sqrt(area_m2 / pi)
        # Caps realistas INTA: mín 1m, máx 16m (árbol forestal adulto Argentina)
        # Con copa máx 80m²: radio=5m, altura=2.5*5=12.5m (razonable para adulto)
        radius_m = math.sqrt(area_m2 / math.pi)
        height_m = round(2.5 * radius_m, 2)
        height_m = max(1.0, min(height_m, 16.0))

        # Textura
        texture = compute_texture(contour, raster)

        # Clasificar especie
        species, confidence = classify_species(
            crown["r_mean"], crown["g_mean"], crown["b_mean"], texture
        )

        # Biomasa y edad
        biomass_kg = estimate_biomass(species, height_m, area_m2)
        age_years = estimate_age(species, height_m)
        allometric_source = get_allometric_source(species)

        # Convertir contorno a coordenadas geográficas
        coords_px = pixel_to_geo(contour, raster["transform"])
        coords_geo = reproject_coords_to_wgs84(coords_px, raster["crs"])

        # Calcular centroide
        if len(coords_geo) >= 3:
            lons = [c[0] for c in coords_geo]
            lats = [c[1] for c in coords_geo]
            centroid_lon = float(np.mean(lons))
            centroid_lat = float(np.mean(lats))
            polygon_coords = coords_geo
        else:
            # Fallback si el polígono es inválido
            centroid_lon = centroid_lat = 0.0
            polygon_coords = []

        results.append({
            "tree_id": f"tree-{idx+1:04d}",
            "species": species,
            "crown_area_m2": round(area_m2, 2),
            "height_m": round(height_m, 2),
            "biomass_kg": biomass_kg,
            "age_years": age_years,
            "confidence": confidence,
            "centroid_lat": centroid_lat,
            "centroid_lon": centroid_lon,
            "allometric_source": allometric_source,
            "r_mean": round(crown["r_mean"], 2),
            "g_mean": round(crown["g_mean"], 2),
            "b_mean": round(crown["b_mean"], 2),
            "texture_score": round(texture, 3),
            "polygon_coords": polygon_coords,
        })

    if progress_callback:
        progress_callback(75, f"Métricas calculadas. Construyendo GeoJSON...")

    return results
