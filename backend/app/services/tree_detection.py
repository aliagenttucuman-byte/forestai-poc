"""
Tree Detection Service
Pipeline: DeepForest detecta copas (bboxes) → SAM refina cada bbox en máscara poligonal.
"""
import os
import io
import logging
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

SAM_CHECKPOINT = "/tmp/sam_models/sam_vit_b.pth"
SAM_MODEL_TYPE = "vit_b"


def _get_sample_image() -> str:
    """Devuelve la imagen de prueba incluida en el paquete DeepForest."""
    import deepforest
    pkg_dir = os.path.dirname(deepforest.__file__)
    for name in ["SOAP_031.png", "2019_YELL_2_541000_4977000_image_crop.png"]:
        path = os.path.join(pkg_dir, "data", name)
        if os.path.exists(path):
            logger.info(f"Usando imagen de prueba incluida: {path}")
            return path
    raise FileNotFoundError("No se encontró imagen de prueba en el paquete DeepForest")


def _sam_available() -> bool:
    """Verifica si SAM y su checkpoint están disponibles."""
    try:
        import segment_anything  # noqa
        return os.path.exists(SAM_CHECKPOINT)
    except ImportError:
        return False


def _refine_with_sam(image_np: np.ndarray, predictions) -> list[dict]:
    """
    Usa SAM para refinar cada bounding box de DeepForest en una máscara de copa.
    Devuelve lista de dicts con bbox + polygon (contorno de la copa).
    """
    from segment_anything import sam_model_registry, SamPredictor

    logger.info("Cargando SAM para refinamiento de copas...")
    sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT)
    sam.eval()
    predictor = SamPredictor(sam)
    predictor.set_image(image_np)

    results = []
    for _, row in predictions.iterrows():
        x1, y1, x2, y2 = int(row["xmin"]), int(row["ymin"]), int(row["xmax"]), int(row["ymax"])
        score = round(float(row.get("score", 1.0)), 3)

        box = np.array([x1, y1, x2, y2])
        masks, scores_sam, logits = predictor.predict(
            box=box,
            multimask_output=True,
        )
        # Elegir la máscara con mayor score de SAM
        best_idx = int(np.argmax(scores_sam))
        mask = masks[best_idx]  # bool array H×W

        # Stability score: re-thresholdear con ±delta y medir IoU
        def _stability(mask_logits: np.ndarray, delta: float = 1.0) -> float:
            high = mask_logits > delta
            low  = mask_logits > -delta
            intersection = (high & low).sum()
            union = (high | low).sum()
            return float(intersection / union) if union > 0 else 0.0

        stability = _stability(logits[best_idx])

        # Convertir máscara a polígono (contorno exterior simplificado)
        polygon = _mask_to_polygon(mask)

        results.append({
            "xmin": x1, "ymin": y1, "xmax": x2, "ymax": y2,
            "score": score,
            "polygon": polygon,
            "sam_score": round(float(scores_sam[best_idx]), 3),
            "stability_score": round(stability, 3),
        })

    logger.info(f"SAM refinó {len(results)} copas")
    return results


def _mask_to_polygon(mask: np.ndarray) -> list[list[int]]:
    """
    Convierte una máscara binaria H×W en un polígono simplificado (contorno).
    Devuelve lista de puntos [[x,y], ...].
    """
    try:
        import cv2
        mask_u8 = mask.astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return []
        # Mayor contorno
        c = max(contours, key=cv2.contourArea)
        # Simplificar con epsilon ~1% del perímetro
        epsilon = 0.01 * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, True)
        return approx.reshape(-1, 2).tolist()
    except ImportError:
        # Fallback sin cv2: extraer borde de la máscara con numpy
        rows = np.any(mask, axis=1)
        cols = np.any(mask, axis=0)
        if not rows.any():
            return []
        rmin, rmax = np.where(rows)[0][[0, -1]]
        cmin, cmax = np.where(cols)[0][[0, -1]]
        # Polígono elíptico aproximado inscrito en la máscara
        cx, cy = (cmin + cmax) / 2, (rmin + rmax) / 2
        rx, ry = (cmax - cmin) / 2, (rmax - rmin) / 2
        points = []
        for i in range(16):
            angle = 2 * np.pi * i / 16
            px = int(cx + rx * np.cos(angle))
            py = int(cy + ry * np.sin(angle))
            points.append([px, py])
        return points


def _draw_results_sam(image_path: str, trees: list[dict]) -> bytes:
    """
    Dibuja máscaras SAM (polígonos de copa) sobre la imagen.
    Si no hay polígono, dibuja el bbox como fallback.
    """
    img = Image.open(image_path).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw_o = ImageDraw.Draw(overlay)
    draw_b = ImageDraw.Draw(img)

    for tree in trees:
        score = tree.get("score", 1.0)
        green = int(100 + 155 * score)
        poly = tree.get("polygon", [])

        if poly and len(poly) >= 3:
            flat = [(p[0], p[1]) for p in poly]
            # Relleno semitransparente verde
            draw_o.polygon(flat, fill=(0, green, 80, 60))
            # Contorno sólido
            draw_o.polygon(flat, outline=(0, green, 80, 220))
        else:
            # Fallback: bbox
            x1, y1, x2, y2 = tree["xmin"], tree["ymin"], tree["xmax"], tree["ymax"]
            for off in range(2):
                draw_b.rectangle(
                    [x1 - off, y1 - off, x2 + off, y2 + off],
                    outline=(0, green, 80)
                )

    img = Image.alpha_composite(img, overlay).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _draw_results_bbox(image_path: str, predictions) -> bytes:
    """Fallback: dibuja bounding boxes simples (sin SAM)."""
    img = Image.open(image_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for _, row in predictions.iterrows():
        x1, y1, x2, y2 = int(row["xmin"]), int(row["ymin"]), int(row["xmax"]), int(row["ymax"])
        score = float(row.get("score", 1.0))
        green = int(100 + 155 * score)
        for off in range(2):
            draw.rectangle([x1 - off, y1 - off, x2 + off, y2 + off], outline=(0, green, 80))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


PIL_MAX_PIXELS = 178_956_970  # límite PIL para decompression bomb
TILING_THRESHOLD = 20_000_000  # >20M px → siempre tile (ortomosaicos de drone)
TILE_SIZE = 1024               # px por tile
TILE_OVERLAP = 128             # px de overlap entre tiles para no perder copas en bordes
VEG_THRESHOLD = 0.12           # mínimo 12% de píxeles con vegetación para procesar un tile


def _tile_has_vegetation(rgb: np.ndarray, threshold: float = VEG_THRESHOLD) -> bool:
    """
    Retorna True si el tile tiene suficiente vegetación para procesar.
    Usa ExG (2G - R - B) > 0 como indicador de píxel verde.
    threshold: fracción mínima de píxeles verdes (default 12%).
    """
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)
    exg = 2.0 * g - r - b
    veg_pixels = np.sum(exg > 20)  # ExG > 20 = verde significativo
    total_pixels = rgb.shape[0] * rgb.shape[1]
    return (veg_pixels / total_pixels) >= threshold


def _apply_exg(rgb: np.ndarray) -> np.ndarray:
    """
    Excess Green Index (ExG = 2G - R - B) sobre imagen RGB.
    Resalta vegetación (copas verdes) antes de pasarla a DeepForest.
    Devuelve imagen RGB donde el canal verde domina en zonas con vegetación.
    """
    r = rgb[:, :, 0].astype(np.float32)
    g = rgb[:, :, 1].astype(np.float32)
    b = rgb[:, :, 2].astype(np.float32)

    exg = 2.0 * g - r - b  # rango típico: -255 a +510

    # Normalizar a 0-255
    exg_min, exg_max = exg.min(), exg.max()
    if exg_max > exg_min:
        exg_norm = ((exg - exg_min) / (exg_max - exg_min) * 255).astype(np.uint8)
    else:
        exg_norm = np.zeros_like(r, dtype=np.uint8)

    # Reconstruir RGB: G aumentado por ExG, R/B atenuados
    enhanced = rgb.copy()
    enhanced[:, :, 1] = np.clip(rgb[:, :, 1].astype(np.float32) * 0.6 + exg_norm * 0.4, 0, 255).astype(np.uint8)
    enhanced[:, :, 0] = np.clip(rgb[:, :, 0].astype(np.float32) * 0.7, 0, 255).astype(np.uint8)
    enhanced[:, :, 2] = np.clip(rgb[:, :, 2].astype(np.float32) * 0.7, 0, 255).astype(np.uint8)
    return enhanced


def _tile_and_detect(image_path: str, model) -> tuple:
    """
    Para TIFFs grandes (> TILING_THRESHOLD): divide en tiles de TILE_SIZE×TILE_SIZE
    con TILE_OVERLAP px de solapamiento entre tiles.
    Aplica ExG (Excess Green) en cada tile para resaltar vegetación.
    Consolida predicciones con NMS para eliminar duplicados en bordes.
    Devuelve (predictions_df_global, w, h) donde w/h son las dimensiones originales.
    """
    import pandas as pd
    import rasterio
    from rasterio.windows import Window
    from PIL import Image as PILImage

    all_rows = []
    step = TILE_SIZE - TILE_OVERLAP  # paso con overlap

    with rasterio.open(image_path) as src:
        W, H = src.width, src.height

    total_tiles = len(range(0, H, step)) * len(range(0, W, step))
    logger.info(f"Tiling: {W}×{H} → tiles {TILE_SIZE}px, overlap {TILE_OVERLAP}px, total ~{total_tiles} tiles")

    for y0 in range(0, H, step):
        for x0 in range(0, W, step):
            tw = min(TILE_SIZE, W - x0)
            th = min(TILE_SIZE, H - y0)

            # Ignorar tiles demasiado chicos (borde residual < 128px)
            if tw < 128 or th < 128:
                continue

            with rasterio.open(image_path) as src:
                window = Window(x0, y0, tw, th)
                data = src.read(list(range(1, min(src.count, 3) + 1)), window=window)  # C×H×W

            rgb = np.transpose(data, (1, 2, 0)).astype(np.uint8)  # H×W×C
            if rgb.shape[2] == 1:
                rgb = np.repeat(rgb, 3, axis=2)
            elif rgb.shape[2] == 2:
                rgb = np.concatenate([rgb, rgb[:, :, :1]], axis=2)

            # Filtro de vegetación — saltear tiles urbanos/sin verde
            if not _tile_has_vegetation(rgb):
                logger.info(f"  Tile ({x0},{y0})+{tw}×{th} → saltado (sin vegetación)")
                continue

            # Aplicar ExG para resaltar vegetación
            rgb_enhanced = _apply_exg(rgb)

            # Guardar tile temporalmente como PNG
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
                tile_path = t.name
            try:
                PILImage.fromarray(rgb_enhanced).save(tile_path)
                preds = model.predict_image(path=tile_path)
            finally:
                os.unlink(tile_path)

            if preds is not None and len(preds) > 0:
                preds = preds.copy()
                # Trasladar coordenadas al espacio global
                preds["xmin"] += x0
                preds["xmax"] += x0
                preds["ymin"] += y0
                preds["ymax"] += y0
                all_rows.append(preds)
            logger.info(f"  Tile ({x0},{y0})+{tw}×{th} → {len(preds) if preds is not None else 0} árboles")

    if not all_rows:
        return None, W, H

    combined = pd.concat(all_rows, ignore_index=True)

    # NMS simple para eliminar duplicados de tiles solapados
    # Dos bboxes son duplicado si IoU > 0.5 y mismo label
    combined = _nms_dataframe(combined, iou_threshold=0.5)
    logger.info(f"Total tras NMS: {len(combined)} árboles")

    return combined, W, H


def _nms_dataframe(df, iou_threshold: float = 0.5):
    """
    Non-Maximum Suppression simple sobre DataFrame de predicciones.
    Elimina bboxes duplicados generados por tiles solapados.
    """
    if df is None or len(df) == 0:
        return df

    # Ordenar por score descendente
    df = df.sort_values("score", ascending=False).reset_index(drop=True)

    keep = []
    suppressed = set()

    for i in range(len(df)):
        if i in suppressed:
            continue
        keep.append(i)
        x1i, y1i, x2i, y2i = df.at[i, "xmin"], df.at[i, "ymin"], df.at[i, "xmax"], df.at[i, "ymax"]
        area_i = max(0, x2i - x1i) * max(0, y2i - y1i)

        for j in range(i + 1, len(df)):
            if j in suppressed:
                continue
            x1j, y1j, x2j, y2j = df.at[j, "xmin"], df.at[j, "ymin"], df.at[j, "xmax"], df.at[j, "ymax"]

            # Intersección
            ix1 = max(x1i, x1j)
            iy1 = max(y1i, y1j)
            ix2 = min(x2i, x2j)
            iy2 = min(y2i, y2j)
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            if inter == 0:
                continue

            area_j = max(0, x2j - x1j) * max(0, y2j - y1j)
            union = area_i + area_j - inter
            iou = inter / union if union > 0 else 0.0

            if iou > iou_threshold:
                suppressed.add(j)

    return df.iloc[keep].reset_index(drop=True)


def run_tree_detection(image_path: Optional[str] = None) -> dict:
    """
    Pipeline completo: DeepForest detecta copas → SAM refina en máscaras poligonales.
    Para TIFFs grandes (> 178M px) hace tiling automático transparente.

    Args:
        image_path: ruta a imagen local (PNG/JPG/TIFF). Si es None, usa imagen de prueba.

    Returns:
        dict con tree_count, trees (con polygon si SAM disponible),
        image_width, image_height, annotated_image_bytes, used_sample, sam_used.
    """
    try:
        from deepforest import main as df_main
    except ImportError:
        raise RuntimeError("DeepForest no está instalado. Ejecutá: pip install deepforest")

    used_sample = image_path is None
    if used_sample:
        image_path = _get_sample_image()

    if not os.path.exists(image_path):
        raise FileNotFoundError(f"No se encontró la imagen: {image_path}")

    # ── 1. DeepForest: detección de bboxes ──────────────────────────────────
    logger.info("Cargando modelo DeepForest...")
    model = df_main.deepforest()
    model.load_model(model_name="weecology/deepforest-tree", revision="main")
    # Ortomosaicos de alta resolución (6 cm/px) tienen scores bajos por diferencia
    # de dominio con el dataset de entrenamiento (NEON, bosques EEUU).
    # Bajamos el threshold a 0.15 para detectar correctamente.
    model.config["score_thresh"] = 0.15

    logger.info(f"Corriendo detección sobre: {image_path}")

    # Chequear si el TIFF es demasiado grande para PIL directo
    Image.MAX_IMAGE_PIXELS = None  # desactivar el check para poder leer dimensiones
    with Image.open(image_path) as img_check:
        w, h = img_check.size
    Image.MAX_IMAGE_PIXELS = PIL_MAX_PIXELS  # restaurar

    needs_tiling = (w * h) > TILING_THRESHOLD
    if needs_tiling:
        logger.info(f"Ortomosaico ({w}×{h}={w*h:,}px > {TILING_THRESHOLD:,}) → tiling automático ({TILE_SIZE}px tiles)")
        predictions, w, h = _tile_and_detect(image_path, model)
    else:
        predictions = model.predict_image(path=image_path)

    if predictions is None or len(predictions) == 0:
        # Generar thumbnail para preview aunque no haya árboles
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(image_path) as img_thumb:
            img_thumb = img_thumb.convert("RGB")
            img_thumb.thumbnail((2048, 2048), Image.LANCZOS)
            buf = io.BytesIO()
            img_thumb.save(buf, format="PNG")
        Image.MAX_IMAGE_PIXELS = PIL_MAX_PIXELS
        return {
            "tree_count": 0, "trees": [], "image_width": w, "image_height": h,
            "annotated_image_bytes": buf.getvalue(),
            "used_sample": used_sample, "sam_used": False,
        }

    # ── 2. SAM: refinar bboxes en máscaras de copa ───────────────────────────
    sam_used = False
    if _sam_available():
        try:
            image_np = np.array(Image.open(image_path).convert("RGB"))
            trees = _refine_with_sam(image_np, predictions)
            annotated = _draw_results_sam(image_path, trees)
            sam_used = True
        except Exception as e:
            logger.warning(f"SAM falló ({e}), usando solo bboxes de DeepForest")
            trees = [
                {"xmin": int(r["xmin"]), "ymin": int(r["ymin"]),
                 "xmax": int(r["xmax"]), "ymax": int(r["ymax"]),
                 "score": round(float(r.get("score", 1.0)), 3), "polygon": []}
                for _, r in predictions.iterrows()
            ]
            annotated = _draw_results_bbox(image_path, predictions)
    else:
        logger.info("SAM no disponible, usando solo bboxes")
        trees = [
            {"xmin": int(r["xmin"]), "ymin": int(r["ymin"]),
             "xmax": int(r["xmax"]), "ymax": int(r["ymax"]),
             "score": round(float(r.get("score", 1.0)), 3), "polygon": []}
            for _, r in predictions.iterrows()
        ]
        annotated = _draw_results_bbox(image_path, predictions)

    logger.info(f"Pipeline completado: {len(trees)} árboles | SAM={'sí' if sam_used else 'no'}")

    # ── 3. VLM: clasificar especie y salud de cada copa ──────────────────────
    vlm_used = False
    # Prioridad de API key: OpenAI (gpt-4o-mini) → Azure Claude → OpenCode → NVIDIA
    api_key = (
        os.getenv("OPENAI_API_KEY", "")
        or os.getenv("AZURE_ANTHROPIC_API_KEY", "")
        or os.getenv("OPENCODE_API_KEY", "")
        or os.getenv("NVIDIA_API_KEY", "")
    )
    if api_key and len(trees) > 0:
        try:
            from app.services.vlm_classifier import classify_trees_vlm
            import asyncio

            # Construir lista de dicts con bbox para vlm_classifier
            trees_for_vlm = [
                {
                    "xmin": t["xmin"], "ymin": t["ymin"],
                    "xmax": t["xmax"], "ymax": t["ymax"],
                }
                for t in trees
            ]
            # Para TIFFs grandes (tiling), las coords son globales pero la imagen
            # es demasiado grande para cargar entera. Generamos un thumbnail
            # manteniendo proporciones para que los crops sean válidos.
            Image.MAX_IMAGE_PIXELS = None
            with Image.open(image_path) as img_full:
                full_w, full_h = img_full.size
                # Si >6000px en algún lado, reducir para el VLM crop
                max_dim = 8000
                if full_w > max_dim or full_h > max_dim:
                    scale = min(max_dim / full_w, max_dim / full_h)
                    thumb_w = int(full_w * scale)
                    thumb_h = int(full_h * scale)
                    img_thumb = img_full.resize((thumb_w, thumb_h), Image.LANCZOS)
                    # Escalar coords de los bboxes al thumbnail
                    trees_for_vlm = [
                        {
                            "xmin": int(t["xmin"] * scale),
                            "ymin": int(t["ymin"] * scale),
                            "xmax": int(t["xmax"] * scale),
                            "ymax": int(t["ymax"] * scale),
                        }
                        for t in trees
                    ]
                    logger.info(f"VLM: thumbnail {full_w}×{full_h} → {thumb_w}×{thumb_h} (scale={scale:.3f})")
                else:
                    img_thumb = img_full.copy()
            image_np_vlm = np.array(img_thumb.convert("RGB"))

            # asyncio.run() falla si ya hay un event loop activo (FastAPI/uvicorn).
            # Corremos el VLM en un thread separado con su propio loop.
            import concurrent.futures

            def _run_vlm():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    return loop.run_until_complete(
                        classify_trees_vlm(image_np_vlm, trees_for_vlm, api_key, concurrency=2)
                    )
                finally:
                    loop.close()

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                vlm_results = pool.submit(_run_vlm).result(timeout=180)

            # Merge VLM results back into trees list
            vlm_map = {r["tree_idx"]: r for r in vlm_results if r.get("vlm_ok")}
            for idx, tree in enumerate(trees):
                if idx in vlm_map:
                    r = vlm_map[idx]
                    tree["vlm_species"]    = r.get("vlm_species")
                    tree["vlm_health"]     = r.get("vlm_health")
                    tree["vlm_confidence"] = r.get("vlm_confidence")
                    tree["vlm_notes"]      = r.get("vlm_notes")
                    vlm_used = True
                else:
                    tree["vlm_species"]    = None
                    tree["vlm_health"]     = None
                    tree["vlm_confidence"] = None
                    tree["vlm_notes"]      = None

            ok_count = len(vlm_map)
            logger.info(f"VLM: {ok_count}/{len(trees)} árboles clasificados")
        except Exception as e:
            logger.warning(f"VLM classification failed (non-fatal): {e}")
    else:
        # Sin API key — inicializar campos vacíos igual
        for tree in trees:
            tree["vlm_species"]    = None
            tree["vlm_health"]     = None
            tree["vlm_confidence"] = None
            tree["vlm_notes"]      = None

    logger.info(f"Pipeline completado: {len(trees)} árboles | SAM={'sí' if sam_used else 'no'} | VLM={'sí' if vlm_used else 'no'}")

    return {
        "tree_count": len(trees),
        "trees": trees,
        "image_width": w,
        "image_height": h,
        "annotated_image_bytes": annotated,
        "used_sample": used_sample,
        "sam_used": sam_used,
        "vlm_used": vlm_used,
    }
