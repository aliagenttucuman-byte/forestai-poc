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


def run_tree_detection(image_path: Optional[str] = None) -> dict:
    """
    Pipeline completo: DeepForest detecta copas → SAM refina en máscaras poligonales.

    Args:
        image_path: ruta a imagen local (PNG/TIFF). Si es None, usa imagen de prueba.

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
    logger.info(f"Corriendo detección sobre: {image_path}")
    predictions = model.predict_image(path=image_path)

    with Image.open(image_path) as img_pil:
        w, h = img_pil.size

    if predictions is None or len(predictions) == 0:
        return {
            "tree_count": 0, "trees": [], "image_width": w, "image_height": h,
            "annotated_image_bytes": open(image_path, "rb").read(),
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

    return {
        "tree_count": len(trees),
        "trees": trees,
        "image_width": w,
        "image_height": h,
        "annotated_image_bytes": annotated,
        "used_sample": used_sample,
        "sam_used": sam_used,
    }
