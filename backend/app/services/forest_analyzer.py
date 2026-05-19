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
    with rasterio.open(filepath) as src:
        # Leer las 3 bandas RGB
        if src.count >= 3:
            r = src.read(1).astype(np.float32)
            g = src.read(2).astype(np.float32)
            b = src.read(3).astype(np.float32)
        else:
            # Grayscale → triplicar
            gray = src.read(1).astype(np.float32)
            r = g = b = gray

        crs = src.crs
        transform = src.transform
        bounds = src.bounds
        resolution = abs(src.transform.e)  # metros por pixel

        return {
            "r": r, "g": g, "b": b,
            "crs": crs,
            "transform": transform,
            "bounds": bounds,
            "resolution_m": resolution,
            "width": src.width,
            "height": src.height,
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

    # Umbral de vegetación
    _, thresh = cv2.threshold(vari_norm, 100, 255, cv2.THRESH_BINARY)

    # Limpieza morfológica
    kernel = np.ones((3, 3), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_DILATE, kernel, iterations=1)

    # Distance transform para separar árboles
    dist_transform = cv2.distanceTransform(thresh, cv2.DIST_L2, 5)
    _, sure_fg = cv2.threshold(dist_transform, 0.4 * dist_transform.max(), 255, 0)
    sure_fg = sure_fg.astype(np.uint8)

    # Watershed
    sure_bg = cv2.dilate(thresh, kernel, iterations=3)
    unknown = cv2.subtract(sure_bg, sure_fg)

    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0

    markers_ws = markers.copy()
    cv2.watershed(img_rgb, markers_ws)

    # Extraer contornos por región
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

        # Filtrar regiones muy pequeñas o muy grandes (ruido)
        min_area_px = 15
        max_area_px = raster["width"] * raster["height"] * 0.15  # máx 15% de la imagen
        if area_px < min_area_px or area_px > max_area_px:
            continue

        # Métricas de color en la región
        mask_bool = mask > 0
        r_vals = r[mask_bool]
        g_vals = g[mask_bool]
        b_vals = b[mask_bool]

        crowns.append({
            "contour": cnt,
            "area_px": area_px,
            "r_mean": float(np.mean(r_vals)),
            "g_mean": float(np.mean(g_vals)),
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
        radius_m = math.sqrt(area_m2 / math.pi)
        height_m = round(2.5 * radius_m, 2)
        height_m = max(height_m, 1.0)

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
