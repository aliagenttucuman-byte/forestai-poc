/**
 * DemoReforestLatam — Vista simplificada para demo ReforestLatam
 * Hover tooltip + selección bidireccional tabla ↔ canvas
 * Acceso: http://[host]:3010/demo
 */
import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface TreeBox {
  xmin: number; ymin: number; xmax: number; ymax: number;
  score: number; polygon?: number[][];
  sam_score?: number; stability_score?: number;
  vlm_species?: string | null; vlm_health?: string | null;
  vlm_confidence?: number | null; vlm_notes?: string | null;
}

interface DetectionResult {
  tree_count: number; trees: TreeBox[];
  image_width: number; image_height: number;
  annotated_image_b64: string;
  used_sample: boolean; sam_used: boolean; vlm_used: boolean; sample_name: string;
}

// ─── Tooltip flotante ─────────────────────────────────────────────────────────
function Tooltip({ tree, x, y }: { tree: TreeBox; x: number; y: number }) {
  const healthColor = tree.vlm_health === "saludable" ? "#059669"
    : tree.vlm_health === "estresado" ? "#d97706" : "#dc2626";
  return (
    <div style={{
      position: "fixed", left: x + 14, top: y - 10, zIndex: 9999,
      background: "white", borderRadius: 10, border: "1px solid #e2e8f0",
      boxShadow: "0 4px 20px rgba(0,0,0,0.12)", padding: "10px 14px",
      fontSize: 12, minWidth: 160, pointerEvents: "none",
    }}>
      <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
        {tree.vlm_species ?? "Árbol detectado"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span style={{ color: "#94a3b8" }}>Confianza</span>
          <span style={{ fontWeight: 700, color: "#2563eb" }}>{(tree.score * 100).toFixed(1)}%</span>
        </div>
        {tree.vlm_health && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#94a3b8" }}>Salud</span>
            <span style={{ fontWeight: 700, color: healthColor }}>{tree.vlm_health}</span>
          </div>
        )}
        {tree.sam_score != null && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: "#94a3b8" }}>SAM score</span>
            <span style={{ fontWeight: 700, color: "#7c3aed" }}>{(tree.sam_score * 100).toFixed(1)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Canvas con polígonos SAM, hover y selección ──────────────────────────────
function PolygonCanvas({
  result, selectedIdx, onHover, onSelect,
}: {
  result: DetectionResult;
  selectedIdx: number | null;
  onHover: (idx: number | null, x: number, y: number) => void;
  onSelect: (idx: number | null) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0, scaleX: 1, scaleY: 1 });
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const updateDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    setDims({ w: rect.width, h: rect.height, scaleX: rect.width / result.image_width, scaleY: rect.height / result.image_height });
  }, [result.image_width, result.image_height]);

  useEffect(() => {
    if (imgLoaded) updateDims();
    window.addEventListener("resize", updateDims);
    return () => window.removeEventListener("resize", updateDims);
  }, [imgLoaded, updateDims]);

  // Redibujar cuando cambia hover o selección
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.w === 0) return;
    canvas.width = dims.w; canvas.height = dims.h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, dims.w, dims.h);

    result.trees.forEach((tree, idx) => {
      const isHovered = idx === hoveredIdx;
      const isSelected = idx === selectedIdx;
      const highlight = isSelected || isHovered;

      const fill   = isSelected ? "rgba(251,191,36,0.35)"
                   : isHovered  ? "rgba(16,185,129,0.4)"
                   :              "rgba(16,185,129,0.15)";
      const stroke = isSelected ? "rgba(245,158,11,1)"
                   : isHovered  ? "rgba(16,185,129,1)"
                   :              "rgba(5,150,105,0.8)";
      const lw = highlight ? 2.5 : 1.5;

      const poly = tree.polygon;
      if (poly && poly.length >= 3) {
        const scaled = poly.map(([x, y]) => [x * dims.scaleX, y * dims.scaleY]);
        ctx.beginPath();
        ctx.moveTo(scaled[0][0], scaled[0][1]);
        scaled.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
      } else {
        const x1 = tree.xmin * dims.scaleX, y1 = tree.ymin * dims.scaleY;
        const w = (tree.xmax - tree.xmin) * dims.scaleX;
        const h = (tree.ymax - tree.ymin) * dims.scaleY;
        ctx.fillStyle = fill; ctx.fillRect(x1, y1, w, h);
        ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x1, y1, w, h);
      }

      // Label en el árbol seleccionado
      if (isSelected && tree.vlm_species) {
        const cx = ((tree.xmin + tree.xmax) / 2) * dims.scaleX;
        const cy = tree.ymin * dims.scaleY - 6;
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillStyle = "rgba(245,158,11,1)";
        ctx.textAlign = "center";
        ctx.fillText(tree.vlm_species, cx, cy);
      }
    });
  }, [result.trees, dims, hoveredIdx, selectedIdx]);

  // Hit-test polígono
  const pointInPoly = (poly: number[][], px: number, py: number, sx: number, sy: number) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0] * sx, yi = poly[i][1] * sy;
      const xj = poly[j][0] * sx, yj = poly[j][1] * sy;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const findTree = (px: number, py: number) => {
    for (let i = result.trees.length - 1; i >= 0; i--) {
      const t = result.trees[i];
      if (t.polygon && t.polygon.length >= 3) {
        if (pointInPoly(t.polygon, px, py, dims.scaleX, dims.scaleY)) return i;
      } else {
        if (px >= t.xmin * dims.scaleX && px <= t.xmax * dims.scaleX &&
            py >= t.ymin * dims.scaleY && py <= t.ymax * dims.scaleY) return i;
      }
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const idx = findTree(e.clientX - rect.left, e.clientY - rect.top);
    setHoveredIdx(idx);
    onHover(idx, e.clientX, e.clientY);
    canvasRef.current!.style.cursor = idx !== null ? "pointer" : "default";
  };

  const handleMouseLeave = () => { setHoveredIdx(null); onHover(null, 0, 0); };
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const idx = findTree(e.clientX - rect.left, e.clientY - rect.top);
    onSelect(idx === selectedIdx ? null : idx);
  };

  return (
    <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
      <img ref={imgRef} src={`data:image/png;base64,${result.annotated_image_b64}`}
        alt="Detección" style={{ width: "100%", display: "block", borderRadius: 8 }}
        onLoad={() => { setImgLoaded(true); updateDims(); }} />
      {imgLoaded && dims.w > 0 && (
        <canvas ref={canvasRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%", borderRadius: 8,
        }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />
      )}
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────
export default function DemoReforestLatam() {
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ tree: TreeBox; x: number; y: number } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  // Índices de árboles con VLM (para mapear tabla ↔ canvas)
  const vlmTrees = result?.trees
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.vlm_species && t.vlm_species !== "dudoso") ?? [];

  const runUpload = async (file: File) => {
    setLoading(true); setError(null); setResult(null); setSelectedIdx(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/tree-detection/upload`, { method: "POST", body: form });
      if (!res.ok) {
        let msg = "Error en el servidor";
        try { const e = await res.json(); msg = e.detail || msg; } catch { msg = await res.text().catch(() => msg); }
        throw new Error(msg);
      }
      const queued = await res.json();
      const taskId = queued.task_id;
      if (!taskId) throw new Error("No se recibió task_id");
      const poll = async (): Promise<void> => {
        const s = await fetch(`${API_BASE}/api/tree-detection/status/${taskId}`);
        const d = await s.json();
        if (d.status === "SUCCESS") { setResult(d); setLoading(false); }
        else if (d.status === "FAILURE") throw new Error(d.error || "Falló la detección");
        else setTimeout(() => poll().catch(e => { setError(e.message); setLoading(false); }), 5000);
      };
      await poll();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) runUpload(file);
  };

  // Cuando se selecciona desde la tabla, scrollear a la fila
  const handleTableSelect = (globalIdx: number, rowIdx: number) => {
    setSelectedIdx(globalIdx === selectedIdx ? null : globalIdx);
    setTimeout(() => {
      rowRefs.current[rowIdx]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  const samCount = result?.trees.filter(t => t.polygon && t.polygon.length > 0).length ?? 0;
  const avgScore = result
    ? (result.trees.reduce((s, t) => s + t.score, 0) / (result.trees.length || 1) * 100).toFixed(1)
    : null;

  return (
    <div style={{
      height: "100dvh", display: "flex", flexDirection: "column",
      background: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; } body { margin: 0; }
        .tree-row { cursor: pointer; transition: background 0.15s; }
        .tree-row:hover { background: #f0fdf4 !important; }
        .tree-row.selected { background: #fefce8 !important; }
      `}</style>

      {/* Tooltip */}
      {tooltip && <Tooltip tree={tooltip.tree} x={tooltip.x} y={tooltip.y} />}

      {/* Header */}
      <header style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "0 24px", height: 60, display: "flex",
        alignItems: "center", justifyContent: "center",
        flexShrink: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg,#10b981,#34d399)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
          }}>🌲</div>
          <h1 style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", margin: 0 }}>
            ForestAI — Detección de Árboles
          </h1>
        </div>
      </header>

      {/* Contenido */}
      <div style={{ flex: 1, overflow: "auto", padding: "32px 40px", display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>

        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12,
            padding: 16, color: "#991b1b", fontSize: 13, width: "100%", maxWidth: 900,
          }}>⚠️ {error}</div>
        )}

        {/* Upload */}
        {!loading && (
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            style={{
              width: "100%", maxWidth: 900,
              background: dragging ? "#ecfdf5" : "white", borderRadius: 16,
              border: `2px dashed ${dragging ? "#10b981" : "#cbd5e1"}`,
              padding: "32px 24px", cursor: "pointer", textAlign: "center", transition: "all 0.2s",
            }}
          >
            <input type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) runUpload(f); }} />
            <div style={{ fontSize: 36, marginBottom: 10 }}>📁</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#374151", margin: 0 }}>
              {result ? "Subir nueva imagen" : "Subir imagen"}
            </p>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>PNG, JPG o GeoTIFF · Arrastrá o hacé clic</p>
          </label>
        )}

        {/* Loading */}
        {loading && (
          <div style={{
            background: "white", borderRadius: 16, border: "1px solid #e2e8f0",
            padding: "80px 40px", width: "100%", maxWidth: 900,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
          }}>
            <div style={{ position: "relative", width: 80, height: 80 }}>
              <div style={{ position: "absolute", inset: 0, border: "3px solid #d1fae5", borderTopColor: "#10b981", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
              <div style={{ position: "absolute", inset: 8, border: "2px solid #a7f3d0", borderTopColor: "#059669", borderRadius: "50%", animation: "spin 1.5s linear infinite reverse" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🌲</div>
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#64748b", margin: 0 }}>Procesando...</p>
          </div>
        )}

        {/* Resultados */}
        {result && (
          <div style={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Stats */}
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { label: "Árboles detectados", value: result.tree_count, icon: "🌲", color: "#059669" },
                { label: "Confianza promedio",  value: `${avgScore}%`,   icon: "🎯", color: "#2563eb" },
                { label: "Copas segmentadas",   value: samCount,          icon: "✦",  color: "#7c3aed" },
              ].map(({ label, value, icon, color }) => (
                <div key={label} style={{ flex: 1, background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "14px 16px" }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Canvas + tabla lado a lado si hay VLM */}
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

              {/* Canvas */}
              <div style={{ flex: 1, background: "white", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden", padding: 16 }}>
                <PolygonCanvas
                  result={result}
                  selectedIdx={selectedIdx}
                  onHover={(idx, x, y) => setTooltip(idx !== null ? { tree: result.trees[idx], x, y } : null)}
                  onSelect={setSelectedIdx}
                />
                <p style={{ fontSize: 11, color: "#94a3b8", margin: "8px 0 0", textAlign: "center" }}>
                  Hover para ver info · Click para seleccionar
                </p>
              </div>

              {/* Tabla de especies */}
              {vlmTrees.length > 0 && (
                <div ref={tableRef} style={{
                  width: 280, flexShrink: 0, background: "white", borderRadius: 16,
                  border: "1px solid #e2e8f0", overflow: "hidden", maxHeight: 520, display: "flex", flexDirection: "column",
                }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>Clasificación</p>
                    <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>{vlmTrees.length} árboles identificados</p>
                  </div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                          {["Especie", "Salud"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 700, color: "#64748b", fontSize: 11 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {vlmTrees.map(({ t, i }, rowIdx) => {
                          const isSelected = i === selectedIdx;
                          const healthColor = t.vlm_health === "saludable" ? "#059669"
                            : t.vlm_health === "estresado" ? "#d97706" : "#dc2626";
                          const healthBg = t.vlm_health === "saludable" ? "#f0fdf4"
                            : t.vlm_health === "estresado" ? "#fffbeb" : "#fef2f2";
                          return (
                            <tr
                              key={rowIdx}
                              ref={el => { rowRefs.current[rowIdx] = el; }}
                              className={`tree-row${isSelected ? " selected" : ""}`}
                              style={{ borderTop: "1px solid #f1f5f9" }}
                              onClick={() => handleTableSelect(i, rowIdx)}
                            >
                              <td style={{ padding: "8px 12px", fontWeight: 600, color: "#1e293b" }}>
                                {isSelected && <span style={{ color: "#f59e0b", marginRight: 4 }}>▶</span>}
                                {t.vlm_species}
                              </td>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                                  background: healthBg, color: healthColor,
                                }}>{t.vlm_health}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Estado inicial */}
        {!loading && !result && !error && (
          <div style={{
            background: "white", borderRadius: 16, border: "1px dashed #cbd5e1",
            padding: 60, width: "100%", maxWidth: 900,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          }}>
            <div style={{ fontSize: 52 }}>🌳</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "#374151", margin: 0 }}>Listo para detectar árboles</p>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: 0, textAlign: "center" }}>Subí un ortomosaico para comenzar</p>
          </div>
        )}

      </div>
    </div>
  );
}
