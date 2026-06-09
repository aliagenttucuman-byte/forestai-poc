"""
Servicio de clasificación por Vision LLM (claude-haiku-4-5 via OpenCode API).

Recibe una imagen RGB (numpy array o PIL) + lista de árboles con bbox,
devuelve los mismos árboles enriquecidos con vlm_species, vlm_health,
vlm_confidence y vlm_notes.

Usa asyncio para procesar en paralelo con un semáforo de concurrencia
configurable. Claude Haiku es rápido (~2s/req) y no rechaza imágenes de vegetación.
"""

import asyncio
import base64
import json
import os
import re
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

import aiohttp
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

OPENCODE_API_URL = "https://opencode.ai/zen/v1/chat/completions"
VLM_MODEL = "claude-haiku-4-5"

# OpenAI — modelo principal (gpt-4o-mini: mejor costo/beneficio para copas)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_VLM_MODEL = "gpt-4o-mini"

# Azure Anthropic — fallback si no hay OpenAI key
AZURE_ANTHROPIC_BASE_URL = os.getenv("AZURE_ANTHROPIC_BASE_URL", "")
AZURE_ANTHROPIC_API_KEY  = os.getenv("AZURE_ANTHROPIC_API_KEY", "")
AZURE_ANTHROPIC_MODEL    = os.getenv("AZURE_ANTHROPIC_MODEL", "claude-sonnet-4-6")

SYSTEM_PROMPT = (
    "You are an expert remote sensing analyst specializing in South American forestry. "
    "You analyze aerial/drone RGB crop images of individual tree canopies (top-down view) "
    "from Tucumán, Argentina (subtropical region). "
    "Your task: classify the visible tree canopy by species and health status. "
    "Common species in Tucumán urban parks and reforestation areas: "
    "Eucalipto (Eucalyptus), Pino (Pinus), Sauce (Salix), Álamo (Populus), "
    "Tipa (Tipuana tipu), Lapacho (Handroanthus), Jacarandá, Cedro (Cedrela), "
    "Quebracho, Algarrobo (Prosopis), Fresno (Fraxinus), Acacia. "
    "IMPORTANT: Always make your BEST ESTIMATE — never respond with 'dudoso' or 'unknown'. "
    "If uncertain, pick the most likely species and set confidence to 0.3-0.5. "
    "Use canopy shape, color, texture, and shadow pattern to identify. "
    "ALWAYS respond with ONLY a valid JSON object — no prose, no markdown. "
    'Exact JSON format: {"species": "best estimate species name in Spanish", '
    '"health": "saludable|estresado|enfermo", '
    '"confidence": 0.6, "notes": "brief observation max 8 words"}'
)

MIN_CROP_PX = 16   # Ignora copas de menos de 16px de lado
TARGET_SIZE = 224  # Escala crops pequeños a este tamaño mínimo
PADDING = 12       # Padding alrededor del bbox


def _crop_tree_b64(img: Image.Image, tree: Dict[str, Any]) -> Optional[str]:
    """Recorta el bbox del árbol con padding y devuelve base64 JPEG. None si muy pequeño."""
    xmin = max(0, tree["xmin"] - PADDING)
    ymin = max(0, tree["ymin"] - PADDING)
    xmax = min(img.width,  tree["xmax"] + PADDING)
    ymax = min(img.height, tree["ymax"] + PADDING)

    w = xmax - xmin
    h = ymax - ymin

    if w < MIN_CROP_PX or h < MIN_CROP_PX:
        return None  # Copa demasiado pequeña

    crop = img.crop((xmin, ymin, xmax, ymax))
    if crop.width < TARGET_SIZE or crop.height < TARGET_SIZE:
        crop = crop.resize((TARGET_SIZE, TARGET_SIZE), Image.LANCZOS)

    buf = BytesIO()
    crop.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


async def _classify_one(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    api_key: str,
    tree_idx: int,
    crop_b64: str,
) -> Dict[str, Any]:
    """Clasifica un único recorte con el VLM. Prioridad: OpenAI gpt-4o-mini → Azure Claude → OpenCode."""

    # ── Elegir backend ──────────────────────────────────────────────────────
    if OPENAI_API_KEY:
        api_url = OPENAI_API_URL
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model": OPENAI_VLM_MODEL,
            "max_tokens": 120,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{crop_b64}", "detail": "high"}},
                        {"type": "text", "text": "Classify this tree canopy. Respond with JSON only."},
                    ],
                },
            ],
        }
        use_azure = False

    elif AZURE_ANTHROPIC_BASE_URL and AZURE_ANTHROPIC_API_KEY:
        api_url = f"{AZURE_ANTHROPIC_BASE_URL.rstrip('/')}/v1/messages"
        headers = {
            "x-api-key":         AZURE_ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        }
        payload = {
            "model": AZURE_ANTHROPIC_MODEL,
            "max_tokens": 120,
            "system": SYSTEM_PROMPT,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": crop_b64}},
                        {"type": "text", "text": "Classify this tree canopy. Respond with JSON only."},
                    ],
                }
            ],
        }
        use_azure = True

    else:
        # Fallback OpenCode
        api_url = OPENCODE_API_URL
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        }
        payload = {
            "model": VLM_MODEL,
            "max_tokens": 120,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{crop_b64}"}},
                        {"type": "text", "text": "Classify this tree canopy. Respond with JSON only."},
                    ],
                },
            ],
        }
        use_azure = False

    content = ""
    async with semaphore:
        try:
            async with session.post(
                api_url,
                headers=headers,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.warning(f"VLM tree {tree_idx}: HTTP {resp.status} — {body[:300]}")
                    return {"tree_idx": tree_idx, "vlm_ok": False}

                data = await resp.json()

                # Extraer texto según backend
                if use_azure:
                    content = data["content"][0]["text"].strip()
                else:
                    content = data["choices"][0]["message"]["content"].strip()

                # Limpiar posible markdown
                if "```" in content:
                    content = content.split("```")[1].replace("json", "").strip()

                # Extraer JSON con regex
                match = re.search(r'\{[^}]+\}', content, re.DOTALL)
                if match:
                    content = match.group(0)

                result = json.loads(content)
                return {
                    "tree_idx":       tree_idx,
                    "vlm_ok":         True,
                    "vlm_species":    str(result.get("species", "Desconocida")),
                    "vlm_health":     str(result.get("health", "dudoso")),
                    "vlm_confidence": float(result.get("confidence", 0.5)),
                    "vlm_notes":      str(result.get("notes", "")),
                }

        except (json.JSONDecodeError, KeyError) as e:
            logger.warning(f"VLM tree {tree_idx}: parse error — {e} | content: {content[:200] if content else 'N/A'}")
            return {"tree_idx": tree_idx, "vlm_ok": False}
        except Exception as e:
            logger.warning(f"VLM tree {tree_idx}: error — {type(e).__name__}: {e}")
            return {"tree_idx": tree_idx, "vlm_ok": False}


async def classify_trees_vlm(
    image: np.ndarray,
    trees: List[Dict[str, Any]],
    api_key: str,
    concurrency: int = 4,   # gpt-4o-mini soporta más concurrencia
    max_trees: int = 30,    # Top 30 por tamaño de copa
) -> List[Dict[str, Any]]:
    """
    Clasifica una lista de árboles con Vision LLM en paralelo.

    Args:
        image:       Array numpy RGB (H, W, 3) uint8.
        trees:       Lista de dicts con xmin/ymin/xmax/ymax (coords pixel).
        api_key:     OpenCode API key.
        concurrency: Máximo de requests simultáneos.
        max_trees:   Máximo de árboles a clasificar (los más grandes por copa).

    Returns:
        Lista de dicts con campos vlm_* por árbol.
    """
    pil_img = Image.fromarray(image).convert("RGB")
    semaphore = asyncio.Semaphore(concurrency)

    # Priorizar árboles más grandes (mayor área de copa)
    indexed = list(enumerate(trees))
    indexed.sort(
        key=lambda x: (x[1].get("xmax", 0) - x[1].get("xmin", 0)) *
                      (x[1].get("ymax", 0) - x[1].get("ymin", 0)),
        reverse=True,
    )
    indexed = indexed[:max_trees]

    tasks_data = []
    for idx, tree in indexed:
        crop_b64 = _crop_tree_b64(pil_img, tree)
        if crop_b64 is not None:
            tasks_data.append((idx, crop_b64))
        else:
            logger.debug(f"Tree {idx} omitido: bbox muy pequeño")

    if not tasks_data:
        logger.info("VLM: ningún árbol con copa suficientemente grande")
        return [{"tree_idx": i, "vlm_ok": False} for i in range(len(trees))]

    logger.info(f"VLM: clasificando {len(tasks_data)}/{len(trees)} árboles con {VLM_MODEL}")

    async with aiohttp.ClientSession() as session:
        coros = [
            _classify_one(session, semaphore, api_key, idx, crop_b64)
            for idx, crop_b64 in tasks_data
        ]
        results_list = await asyncio.gather(*coros, return_exceptions=False)

    # Indexar por tree_idx
    results_by_idx = {r["tree_idx"]: r for r in results_list}

    # Completar árboles no procesados (bbox chico o fuera del top N)
    full_results = []
    for idx in range(len(trees)):
        if idx in results_by_idx:
            full_results.append(results_by_idx[idx])
        else:
            full_results.append({"tree_idx": idx, "vlm_ok": False})

    ok_count = sum(1 for r in full_results if r.get("vlm_ok"))
    logger.info(f"VLM: {ok_count}/{len(trees)} árboles clasificados exitosamente")

    return full_results
