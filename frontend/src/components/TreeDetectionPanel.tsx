import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface TreeBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  score: number;
  polygon?: number[][];
  sam_score?: number;
  stability_score?: number;
}

interface DetectionResult {
  tree_count: number;
  trees: TreeBox[];
  image_width: number;
  image_height: number;
  annotated_image_b64: string;
  used_sample: boolean;
  sam_used: boolean;
  sample_name: string;
}

// ─── Canvas interactivo con polígonos SAM ────────────────────────────────────
function PolygonCanvas({
  result,
  onHover,
  thresholdDeep,
  thresholdSam,
  thresholdStability,
}: {
  result: DetectionResult;
  onHover: (tree: TreeBox | null) => void;
  thresholdDeep: number;
  thresholdSam: number;
  thresholdStability: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0, scaleX: 1, scaleY: 1 });

  // Calcular escala cuando la imagen carga o el contenedor cambia
  const updateDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setDims({
      w: rect.width,
      h: rect.height,
      scaleX: rect.width / result.image_width,
      scaleY: rect.height / result.image_height,
    });
  }, [result.image_width, result.image_height]);

  useEffect(() => {
    if (imgLoaded) updateDims();
    window.addEventListener("resize", updateDims);
    return () => window.removeEventListener("resize", updateDims);
  }, [imgLoaded, updateDims]);

  // Dibujar polígonos en canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    canvas.width = dims.w;
    canvas.height = dims.h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, dims.w, dims.h);

    result.trees.forEach((tree, idx) => {
      const isHovered = idx === hoveredIdx;

      // Determinar si pasa los thresholds
      const passDeep = tree.score >= thresholdDeep;
      const passSam = !tree.sam_score || tree.sam_score >= thresholdSam;
      const passStab = !tree.stability_score || tree.stability_score >= thresholdStability;
      const isReliable = passDeep && passSam && passStab;

      // Colores: verde = confiable, amarillo = dudosa, gris = descartada
      const fillColor = isHovered
        ? "rgba(16, 185, 129, 0.5)"
        : isReliable
          ? "rgba(16, 185, 129, 0.2)"
          : "rgba(245, 158, 11, 0.15)";
      const strokeColor = isHovered
        ? "rgba(16, 185, 129, 1)"
        : isReliable
          ? "rgba(5, 150, 105, 0.9)"
          : "rgba(245, 158, 11, 0.8)";
      const lineWidth = isHovered ? 2.5 : isReliable ? 1.5 : 1;

      const poly = tree.polygon;
      if (poly && poly.length >= 3) {
        const scaled = poly.map(([x, y]) => [x * dims.scaleX, y * dims.scaleY]);
        ctx.beginPath();
        ctx.moveTo(scaled[0][0], scaled[0][1]);
        scaled.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      } else {
        const x1 = tree.xmin * dims.scaleX;
        const y1 = tree.ymin * dims.scaleY;
        const w = (tree.xmax - tree.xmin) * dims.scaleX;
        const h = (tree.ymax - tree.ymin) * dims.scaleY;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x1, y1, w, h);
        if (isHovered) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(x1, y1, w, h);
        }
      }
    });
  }, [result.trees, hoveredIdx, dims, thresholdDeep, thresholdSam, thresholdStability]);

  // Hit-test: ¿el punto (px, py) está dentro del polígono?
  const pointInPolygon = (
    poly: number[][],
    px: number,
    py: number,
    sx: number,
    sy: number
  ) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0] * sx,
        yi = poly[i][1] * sy;
      const xj = poly[j][0] * sx,
        yj = poly[j][1] * sy;
      const intersect =
        yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    let found: number | null = null;
    for (let i = result.trees.length - 1; i >= 0; i--) {
      const tree = result.trees[i];
      const poly = tree.polygon;
      if (poly && poly.length >= 3) {
        if (pointInPolygon(poly, px, py, dims.scaleX, dims.scaleY)) {
          found = i;
          break;
        }
      } else {
        const x1 = tree.xmin * dims.scaleX;
        const y1 = tree.ymin * dims.scaleY;
        const x2 = tree.xmax * dims.scaleX;
        const y2 = tree.ymax * dims.scaleY;
        if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
          found = i;
          break;
        }
      }
    }
    setHoveredIdx(found);
    onHover(found !== null ? result.trees[found] : null);
    canvas.style.cursor = found !== null ? "pointer" : "default";
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
    onHover(null);
  };

  return (
    <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <img
        ref={imgRef}
        src={`data:image/png;base64,${result.annotated_image_b64}`}
        alt="Detección de árboles"
        style={{ width: "100%", display: "block", borderRadius: 8 }}
        onLoad={() => {
          setImgLoaded(true);
          updateDims();
        }}
      />
      {imgLoaded && dims.w > 0 && (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            borderRadius: 8,
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      )}
    </div>
  );
}

// ─── Panel lateral de detalle de copa (hover) ────────────────────────────────
function TreeDetailPanel({ tree }: { tree: TreeBox | null }) {
  const w = tree ? tree.xmax - tree.xmin : 0;
  const h = tree ? tree.ymax - tree.ymin : 0;
  const area = w * h;
  const score = tree ? tree.score * 100 : 0;
  const scoreColor = score > 80 ? "#10b981" : score > 60 ? "#f59e0b" : "#ef4444";

  // SVG arco semi-circular de progreso
  const r = 32, cx = 40, cy = 44;
  const circumference = Math.PI * r;
  const dash = (score / 100) * circumference;

  return (
    <div style={{
      background: "white",
      borderRadius: 16,
      border: `1.5px solid ${tree ? "#a7f3d0" : "#e2e8f0"}`,
      padding: 20,
      transition: "border-color 0.2s",
      width: 220,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 16 }}>🌲</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Copa seleccionada
        </span>
        {tree?.sam_score !== undefined && (
          <span style={{
            background: "#f0fdf4", color: "#059669", fontSize: 10,
            fontWeight: 700, padding: "1px 6px", borderRadius: 10, border: "1px solid #a7f3d0",
          }}>SAM</span>
        )}
      </div>

      {tree ? (
        <>
          {/* Gauge semi-circular */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 16 }}>
            <svg width="80" height="50" viewBox="0 0 80 50">
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none" stroke="#e2e8f0" strokeWidth="8" strokeLinecap="round"
              />
              <path
                d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
                fill="none" stroke={scoreColor} strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference}`}
                style={{ transition: "stroke-dasharray 0.4s ease" }}
              />
              <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="800" fill={scoreColor}>
                {score.toFixed(1)}%
              </text>
            </svg>
            <span style={{ fontSize: 11, color: "#94a3b8", marginTop: -4 }}>Confianza DeepForest</span>
          </div>

          {/* Métricas */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Ancho", value: `${w} px` },
              { label: "Alto", value: `${h} px` },
              { label: "Área bbox", value: `${area.toLocaleString()} px²` },
              ...(tree.polygon && tree.polygon.length > 0
                ? [{ label: "Polígono SAM", value: `${tree.polygon.length} pts` }]
                : []),
              ...(tree.sam_score !== undefined
                ? [{ label: "Score SAM", value: `${(tree.sam_score * 100).toFixed(1)}%` }]
                : []),
              ...(tree.stability_score !== undefined
                ? [{ label: "Stability SAM", value: `${(tree.stability_score * 100).toFixed(1)}%` }]
                : []),
            ].map(({ label, value }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "6px 10px", background: "#f8fafc", borderRadius: 8,
              }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Barra gradiente */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#cbd5e1" }}>Baja</span>
              <span style={{ fontSize: 10, color: "#cbd5e1" }}>Alta</span>
            </div>
            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 4 }}>
              <div style={{
                height: "100%", width: `${score}%`,
                background: `linear-gradient(90deg, #f59e0b, ${scoreColor})`,
                borderRadius: 4, transition: "width 0.4s ease",
              }} />
            </div>
          </div>
        </>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "20px 0", gap: 8,
        }}>
          <div style={{ fontSize: 32, opacity: 0.25 }}>🌿</div>
          <p style={{ fontSize: 11, color: "#cbd5e1", textAlign: "center", margin: 0, lineHeight: 1.5 }}>
            Pasá el mouse<br />sobre una copa
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────
export default function TreeDetectionPanel() {
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredTree, setHoveredTree] = useState<TreeBox | null>(null);
  const [thresholdDeep, setThresholdDeep] = useState(0.4);
  const [thresholdSam, setThresholdSam] = useState(0.85);
  const [thresholdStability, setThresholdStability] = useState(0.9);

  const runSample = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/tree-detection/run`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Error en el servidor");
      }
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const runUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/tree-detection/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Error en el servidor");
      }
      setResult(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) runUpload(file);
  };

  const avgScore = result
    ? (result.trees.reduce((s, t) => s + t.score, 0) / (result.trees.length || 1) * 100).toFixed(1)
    : null;

  const samCount = result?.trees.filter(t => t.polygon && t.polygon.length > 0).length ?? 0;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%", background: "#f8fafc",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 28px", background: "white", borderBottom: "1px solid #e2e8f0",
        display: "flex", alignItems: "center", gap: 16, flexShrink: 0,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: "linear-gradient(135deg, #059669, #10b981)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}>🌲</div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
            Detección de Árboles — IA
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0, marginTop: 2 }}>
            DeepForest + SAM · Detección y segmentación de copas
          </p>
        </div>
        {result?.sam_used && (
          <div style={{
            background: "linear-gradient(135deg, #059669, #10b981)",
            color: "white", fontSize: 11, fontWeight: 700,
            padding: "4px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>✦</span> SAM activo
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 28, display: "flex", gap: 24, flexWrap: "wrap" }}>

        {/* Left — controles */}
        <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>

          <div style={{ background: "white", borderRadius: 16, border: "1px solid #e2e8f0", padding: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 12 }}>Imagen de prueba</p>
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 16, lineHeight: 1.5 }}>
              Bosque de Florida (NEON). Imagen RGB aérea de alta resolución.
            </p>
            <button
              onClick={runSample}
              disabled={loading}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
                background: loading ? "#d1fae5" : "linear-gradient(135deg, #059669, #10b981)",
                color: "white", fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 16, height: 16, border: "2px solid white",
                    borderTopColor: "transparent", borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }} />
                  Analizando...
                </>
              ) : "▶ Correr demo"}
            </button>
          </div>

          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
              background: dragging ? "#ecfdf5" : "white", borderRadius: 16,
              border: `2px dashed ${dragging ? "#10b981" : "#cbd5e1"}`,
              padding: 20, cursor: "pointer", textAlign: "center", transition: "all 0.2s",
            }}
          >
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.tif,.tiff"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) runUpload(f); }}
            />
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: 0 }}>Subir imagen propia</p>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
              PNG, JPG o GeoTIFF<br />Arrastrá o hacé clic
            </p>
          </label>

          {/* Cómo funciona */}
          <div style={{ background: "#f0fdf4", borderRadius: 16, border: "1px solid #a7f3d0", padding: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginBottom: 10,
              textTransform: "uppercase", letterSpacing: "0.08em" }}>Pipeline</p>
            {[
              { step: "1", text: "DeepForest detecta copas con RetinaNet" },
              { step: "2", text: "SAM refina cada copa en máscara poligonal" },
              { step: "3", text: "Polígonos interactivos con score de confianza" },
            ].map(({ step, text }) => (
              <div key={step} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", background: "#10b981",
                  color: "white", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{step}</div>
                <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.4 }}>{text}</p>
              </div>
            ))}
          </div>

          {/* Sliders de confianza */}
          <div style={{ background: "white", borderRadius: 16, border: "1px solid #e2e8f0", padding: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 4,
              textTransform: "uppercase", letterSpacing: "0.08em" }}>Filtros de confianza</p>
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 14, lineHeight: 1.5 }}>
              Verde = pasa los 3 filtros.<br />Amarillo = copa dudosa.
            </p>

            {[
              {
                label: "DeepForest score",
                key: "deep" as const,
                value: thresholdDeep,
                setter: setThresholdDeep,
                min: 0.1, max: 0.9, step: 0.05,
                tip: "Confianza del detector de copas (RetinaNet). Subir = menos pero más seguras.",
                color: "#2563eb",
              },
              {
                label: "SAM predicted IoU",
                key: "sam" as const,
                value: thresholdSam,
                setter: setThresholdSam,
                min: 0.5, max: 1.0, step: 0.05,
                tip: "Calidad estimada de la máscara SAM. Mide qué tan bien delimita la copa.",
                color: "#7c3aed",
              },
              {
                label: "SAM stability",
                key: "stab" as const,
                value: thresholdStability,
                setter: setThresholdStability,
                min: 0.5, max: 1.0, step: 0.05,
                tip: "Estabilidad de la máscara ante variaciones. Alta = polígono robusto.",
                color: "#059669",
              },
            ].map(({ label, value, setter, min, max, step, tip, color }) => (
              <div key={label} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{label}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 800, color,
                    background: `${color}15`, padding: "1px 8px", borderRadius: 8,
                  }}>{value.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={min} max={max} step={step} value={value}
                  onChange={e => setter(parseFloat(e.target.value))}
                  style={{ width: "100%", accentColor: color, cursor: "pointer" }}
                />
                <p style={{ fontSize: 10, color: "#94a3b8", margin: "3px 0 0", lineHeight: 1.4 }}>{tip}</p>
              </div>
            ))}

            {result && (() => {
              const reliable = result.trees.filter(t =>
                t.score >= thresholdDeep &&
                (!t.sam_score || t.sam_score >= thresholdSam) &&
                (!t.stability_score || t.stability_score >= thresholdStability)
              ).length;
              const pct = Math.round((reliable / result.tree_count) * 100);
              return (
                <div style={{
                  background: "#f8fafc", borderRadius: 10, padding: "10px 12px",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderTop: "1px solid #e2e8f0", marginTop: 4,
                }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Copas confiables</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#059669" }}>
                    {reliable} / {result.tree_count}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 4 }}>({pct}%)</span>
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right — resultados */}
        <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 16 }}>

          {error && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
              padding: 16, color: "#991b1b", fontSize: 13,
            }}>⚠️ {error}</div>
          )}

          {loading && !result && (
            <div style={{
              background: "white", borderRadius: 16, border: "1px solid #e2e8f0",
              padding: 60, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 16,
            }}>
              <div style={{
                width: 48, height: 48, border: "3px solid #10b981",
                borderTopColor: "transparent", borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }} />
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#0f172a", margin: 0 }}>
                  DeepForest + SAM analizando...
                </p>
                <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0" }}>
                  Primera vez ~60 seg · descarga de modelos
                </p>
              </div>
            </div>
          )}

          {result && (
            <>
              {/* Stats */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[
                  { label: "Árboles detectados", value: result.tree_count, icon: "🌲", color: "#059669" },
                  { label: "Confianza promedio", value: `${avgScore}%`, icon: "🎯", color: "#2563eb" },
                  { label: "Copas segmentadas", value: samCount, icon: "✦", color: "#7c3aed" },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} style={{
                    flex: 1, minWidth: 130, background: "white", borderRadius: 12,
                    border: "1px solid #e2e8f0", padding: "14px 16px",
                  }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Mapa interactivo con polígonos */}
              <div style={{
                background: "white", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden",
              }}>
                <div style={{
                  padding: "14px 18px", borderBottom: "1px solid #f1f5f9",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      Mapa de copas — hover para detalle
                    </p>
                    <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>
                      {result.sample_name}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {result.sam_used && (
                      <span style={{
                        background: "#f0fdf4", color: "#059669", fontSize: 10, fontWeight: 700,
                        padding: "3px 8px", borderRadius: 20, border: "1px solid #a7f3d0",
                      }}>SAM</span>
                    )}
                    {result.used_sample && (
                      <span style={{
                        background: "#eff6ff", color: "#2563eb", fontSize: 10, fontWeight: 700,
                        padding: "3px 8px", borderRadius: 20, border: "1px solid #bfdbfe",
                      }}>DEMO</span>
                    )}
                  </div>
                </div>
                <div style={{ padding: 16 }}>
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <PolygonCanvas
                        result={result}
                        onHover={setHoveredTree}
                        thresholdDeep={thresholdDeep}
                        thresholdSam={thresholdSam}
                        thresholdStability={thresholdStability}
                      />
                      <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, textAlign: "center" }}>
                        Pasá el mouse sobre las copas para ver detalles individuales
                      </p>
                    </div>
                    <TreeDetailPanel tree={hoveredTree} />
                  </div>
                </div>
              </div>

              {/* Top 10 tabla */}
              {result.trees.length > 0 && (
                <div style={{
                  background: "white", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden",
                }}>
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>
                      Top 10 detecciones (mayor confianza)
                    </p>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {["#", "Confianza", "Polígono", "Área bbox"].map(h => (
                            <th key={h} style={{
                              padding: "8px 14px", textAlign: "left", fontWeight: 700,
                              color: "#64748b", fontSize: 11, textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...result.trees]
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 10)
                          .map((t, i) => (
                            <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "8px 14px", color: "#94a3b8", fontWeight: 600 }}>{i + 1}</td>
                              <td style={{ padding: "8px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ height: 6, width: 60, background: "#e2e8f0", borderRadius: 3 }}>
                                    <div style={{
                                      height: "100%", width: `${t.score * 100}%`,
                                      background: t.score > 0.8 ? "#10b981" : t.score > 0.6 ? "#f59e0b" : "#ef4444",
                                      borderRadius: 3,
                                    }} />
                                  </div>
                                  <span style={{ fontWeight: 600, color: "#374151" }}>
                                    {(t.score * 100).toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td style={{ padding: "8px 14px" }}>
                                {t.polygon && t.polygon.length > 0 ? (
                                  <span style={{
                                    background: "#f0fdf4", color: "#059669", fontSize: 10,
                                    fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                                  }}>
                                    {t.polygon.length} pts
                                  </span>
                                ) : (
                                  <span style={{ color: "#cbd5e1", fontSize: 11 }}>bbox</span>
                                )}
                              </td>
                              <td style={{ padding: "8px 14px", color: "#64748b" }}>
                                {((t.xmax - t.xmin) * (t.ymax - t.ymin)).toLocaleString()}px²
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && !result && !error && (
            <div style={{
              background: "white", borderRadius: 16, border: "1px dashed #cbd5e1",
              padding: 60, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 12,
            }}>
              <div style={{ fontSize: 52 }}>🌳</div>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#374151", margin: 0 }}>
                Listo para detectar árboles
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, textAlign: "center" }}>
                Hacé clic en "Correr demo" para ver el pipeline completo<br />
                DeepForest + SAM en acción
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
