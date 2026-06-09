# ForestAI — Sesión de Debug y Análisis del Pipeline
**Fecha:** 09 de junio de 2026  
**Equipo:** Tony Stark (Nelson) + JARVIS  
**Imagen procesada:** Parque 9 de Julio, Tucumán

---

## 1. Problema inicial — Modelo DeepForest nunca descargaba

### Síntoma
Cada vez que se enviaba una imagen a detectar, el pipeline tardaba demasiado o se colgaba en la carga del modelo.

### Causa raíz
El archivo `model.safetensors` (124MB) de HuggingFace estaba en estado `.incomplete` en el cache del contenedor `celery_worker`. El protocolo **xet** (nuevo sistema de chunks de HuggingFace) fallaba sin token de autenticación, dejando el archivo en 0 bytes cada vez.

```
/root/.cache/huggingface/hub/models--weecology--deepforest-tree/blobs/
  d37a7af...incomplete  ← 0 bytes, nunca terminaba
```

### Solución aplicada
1. Eliminar el `.incomplete`
2. Forzar descarga con `HF_HUB_DISABLE_XET=1` (HTTP clásico sin xet)
3. Crear el symlink faltante en el snapshot de HuggingFace

```bash
# Dentro del contenedor celery_worker
python3 -c "
import os
os.environ['HF_HUB_DISABLE_XET'] = '1'
from huggingface_hub import hf_hub_download
path = hf_hub_download(repo_id='weecology/deepforest-tree', filename='model.safetensors', local_dir='/tmp/deepforest_dl')
import shutil
shutil.copy(path, '/root/.cache/huggingface/hub/models--weecology--deepforest-tree/blobs/d37a7af...')
"

# Crear symlink del snapshot
ln -sf '../../blobs/d37a7af...' \
  /root/.cache/huggingface/hub/models--weecology--deepforest-tree/snapshots/cc21436.../model.safetensors
```

### Resultado
Modelo carga en modo offline desde cache local. Sin acceso a red en cada procesamiento.

---

## 2. Problema — Nginx bloqueaba uploads grandes (413)

### Síntoma
Al subir la imagen del Parque 9 de Julio (61MB), la UI devolvía "Error en el servidor".

### Causa raíz
El nginx del contenedor frontend no tenía configurado `client_max_body_size`. El límite default de nginx es 1MB.

```
[error] client intended to send too large body: 61062424 bytes → 413
```

### Solución aplicada
`frontend/nginx.conf`:
```nginx
server {
    client_max_body_size 500m;

    location /api {
        proxy_pass http://backend:8000/api;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        client_max_body_size 500m;
    }
}
```

Aplicado en caliente con `docker cp` + `nginx -s reload` sin reiniciar el contenedor.

---

## 3. Pipeline ejecutado — Parque 9 de Julio

### Imagen
| Propiedad | Valor |
|-----------|-------|
| Dimensiones | 17094 × 11327 px |
| Píxeles totales | 193,623,738 px |
| Bandas | 4 (RGBA — cámara RGB estándar) |
| Dtype | uint8 |
| CRS | EPSG:32721 |
| Tamaño archivo | ~61 MB |

### Flujo del pipeline
```
Upload TIFF → FastAPI → Celery Task → DeepForest → SAM → VLM → Resultado
```

#### Paso 1: DeepForest — Detección de bboxes
- Modo tiling automático activado (193M px > umbral de 20M px)
- Tile size: 4096px con overlap de 256px
- Total tiles procesados: 15
- Score threshold: 0.15 (calibrado para ortomosaicos Tucumán)
- ExG (Excess Green Index) aplicado por tile para resaltar vegetación
- **Resultado: 257 árboles antes de NMS**
- Tras NMS (IoU > 0.5): **257 árboles únicos**

Distribución por tile:
| Tile | Árboles |
|------|---------|
| (0,0) | 15 |
| (3840,0) | 28 |
| (7680,0) | 6 |
| (11520,0) | 5 |
| (15360,0) borde | 6 |
| (0,3840) | 39 |
| (3840,3840) | 31 |
| (7680,3840) | 30 |
| (11520,3840) | 9 |
| (15360,3840) borde | 14 |
| (0,7680) | 11 |
| (3840,7680) | 19 |
| (7680,7680) | 30 |
| (11520,7680) | 8 |
| (15360,7680) borde | 14 |

#### Paso 2: SAM — Refinamiento de máscaras de copa
- Modelo: SAM ViT-B (`/tmp/sam_models/sam_vit_b.pth`)
- Imagen cargada completa en RAM (193M px — warning DecompressionBomb ignorado)
- Procesamiento: 257 bboxes → 257 máscaras poligonales
- Duración: ~4 minutos en CPU
- **Resultado: 257 copas con polígono + sam_score + stability_score**

#### Paso 3: VLM — Clasificación de especie y salud
- Modelo: claude-haiku-4-5
- Thumbnail generado: 17094×11327 → 8000×5301 (scale=0.468)
- Árboles clasificados: **30/257** (muestra representativa)
- Duración: ~45 segundos

### Tiempos totales
| Fase | Tiempo |
|------|--------|
| Carga modelo DeepForest | ~6 seg |
| Tiling + detección | ~1 min 40 seg |
| SAM refinamiento | ~4 min |
| VLM clasificación | ~45 seg |
| **Total pipeline** | **~7 minutos (425 seg)** |

---

## 4. Análisis técnico — Las 4 bandas de la imagen

La imagen tiene 4 bandas pero son **RGBA** (no multiespectral):
- Banda 1: Rojo
- Banda 2: Verde  
- Banda 3: Azul
- Banda 4: Alpha (transparencia) — **no aporta información espectral**

Para mejorar la detección de especies con datos espectrales se necesitaría un drone con sensor **NIR (Near Infrared)** que permita calcular NDVI.

---

## 5. ExG — Excess Green Index

Técnica de realce de vegetación implementada en el pipeline, aplicada por tile antes de DeepForest.

**Fórmula:**
```
ExG = 2×Verde - Rojo - Azul
```

**Lógica:** Las copas tienen mucho verde y poco rojo/azul. ExG resalta zonas verdes y atenúa suelo, asfalto, agua y sombras. Permite a DeepForest detectar más copas con mejor score sin necesidad de NIR.

**Implementado en:** `backend/app/services/tree_detection.py` → función `_apply_exg()`

---

## 6. Análisis — Tile size y GPU requerida

### Impacto de reducir tile size de 4096 a 1024 px

| Métrica | 4096px (actual) | 1024px (propuesto) |
|---------|-----------------|---------------------|
| Tiles totales | 15 | ~345 |
| Árboles detectados | 257 | Más (arboles chicos visibles) |
| Tiempo en CPU | 7 min | ~2.5-3 horas |
| Tiempo con GPU | ~1 min | ~20 min |

### GPU necesaria para procesar en 20 minutos con tiles de 1024px

| GPU | VRAM | Factor aceleración | Tiempo estimado |
|-----|------|-------------------|-----------------|
| RTX 3060/3070 | 8-12 GB | 10-15x | ~15-20 min ✅ |
| RTX 3090 / A10 | 24 GB | 20x+ | ~8-10 min ✅ |

**Recomendación:** RTX 3070 (8GB VRAM) es suficiente para tiles de 1024px. Costo cloud (~A10): $0.75/hora → centavos por imagen.

### Por qué más árboles con tiles chicos
Con 1024px cada árbol pequeño ocupa mayor proporción del tile, DeepForest los detecta mejor. Con 4096px los árboles pequeños son puntos y pueden saltarse.

### Por qué tiles chicos NO mejoran clasificación de especies
La clasificación de especie la hace el VLM (claude-haiku) sobre crops individuales de cada copa. La calidad depende de la resolución del crop y la claridad del follaje, no del tile size de DeepForest.

---

## 7. Próximos pasos sugeridos

- [ ] Persistir el modelo DeepForest en un volumen Docker para sobrevivir rebuilds
- [ ] Probar tile size 2048px como punto intermedio (estimado ~45 tiles, ~25 min CPU)
- [ ] Evaluar drone con sensor NIR para habilitar NDVI y mejorar clasificación de especies
- [ ] GPU on-premise (RTX 3070) para habilitar tiles de 1024px en tiempo razonable
- [ ] Aumentar muestra VLM de 30 a más árboles por procesamiento

---

*Documentado por JARVIS — AlegentAI I+D+I*
