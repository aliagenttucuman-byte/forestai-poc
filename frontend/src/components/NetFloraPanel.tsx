/**
 * NetFloraPanel — Tab de evaluación de especies (NetFlora / Embrapa)
 * Conectado al backend real: FastAPI + Celery + YOLOv7
 */

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { forestApi } from "../api/client";

// ─── API helpers ──────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${API_BASE}${path}`, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function postDetect(payload: {
  analysis_id?: string;
  category: string;
  conf_threshold: number;
}) {
  return apiFetch("/api/netflora/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getJobStatus(jobId: string) {
  return apiFetch(`/api/netflora/jobs/${jobId}`);
}

// ─── Catálogo de categorías ───────────────────────────────────────────────────
const CATEGORIES: Record<string, { emoji: string; desc: string; speciesCount: number }> = {
  "Açaí":       { emoji: "🌴", desc: "Euterpe precatoria — açaí solteiro y productivo", speciesCount: 2 },
  "Palmeiras":  { emoji: "🌿", desc: "11 especies de palmeras: Paxiúba, Burití, Jací, Tucumã...", speciesCount: 11 },
  "PFNMs":      { emoji: "🌳", desc: "Prod. Florestais Não Madeireiros: Castanheira, Cedro, Copaíba...", speciesCount: 23 },
  "PMFS":       { emoji: "🪵", desc: "Plan de Manejo Forestal Sustentable: maderables + ecológicas", speciesCount: 23 },
  "Castanheira":{ emoji: "🥜", desc: "Bertholletia excelsa — sin modelo público aún", speciesCount: 1 },
  "Ecológico":  { emoji: "🍃", desc: "Árvore morta, Cipó, Corte seletivo — sin modelo público aún", speciesCount: 3 },
  "Ambiental":  { emoji: "🗺️",  desc: "Trilha, Clareira, Exploração — sin modelo público aún", speciesCount: 3 },
};

const CAT_COLORS: Record<string, string> = {
  "Açaí":       "#7c3aed",
  "Palmeiras":  "#059669",
  "PFNMs":      "#d97706",
  "PMFS":       "#0369a1",
  "Castanheira":"#92400e",
  "Ecológico":  "#374151",
  "Ambiental":  "#be123c",
};

const AVAILABLE_CATS = new Set(["Açaí", "Palmeiras", "PFNMs", "PMFS"]);

// Colores para las especies en tabla
const SPECIES_PALETTE = ["#059669","#10b981","#34d399","#6ee7b7","#0369a1","#3b82f6","#7c3aed","#a78bfa","#d97706","#fbbf24"];

// ─── Componente principal ─────────────────────────────────────────────────────
export default function NetFloraPanel() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [conf, setConf] = useState(0.25);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<any | null>(null);
  const [polling, setPolling] = useState(false);
  const [expandSpecies, setExpandSpecies] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Cargar lista de análisis completados
  const { data: analysesData } = useQuery({
    queryKey: ["analyses"],
    queryFn: forestApi.listAnalyses,
    refetchInterval: 0,
  });
  const completedAnalyses = (analysesData?.items || []).filter((a: any) => a.status === "completed");

  // Polling del job
  useEffect(() => {
    if (!jobId || !polling) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await getJobStatus(jobId);
        setJobData(data);
        if (data.status === "completed" || data.status === "failed") {
          setPolling(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, polling]);

  const handleDetect = async () => {
    if (!selectedCategory) return;
    try {
      setJobData(null);
      const payload: any = { category: selectedCategory, conf_threshold: conf };
      if (uploadedFileId) payload.file_id = uploadedFileId;
      else if (selectedAnalysisId) payload.analysis_id = selectedAnalysisId;
      const res = await postDetect(payload);
      setJobId(res.job_id);
      setPolling(true);
      setJobData({ status: "queued", progress: 0, current_step: "En cola..." });
    } catch (e: any) {
      setJobData({ status: "failed", error: e.message });
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.name.endsWith(".tif") && !file.name.endsWith(".tiff")) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.(tif|tiff)$/i, ""));
      const r = await fetch(`${API_BASE}/api/netflora/upload`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setUploadedFileId(data.file_id);
      setSelectedAnalysisId(null); // limpiar análisis previo
    } catch (e: any) {
      setJobData({ status: "failed", error: `Upload: ${e.message}` });
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setJobId(null);
    setJobData(null);
    setPolling(false);
    setUploadedFileId(null);
    setSelectedAnalysisId(null);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const isRunning = jobData && (jobData.status === "queued" || jobData.status === "processing");
  const isDone    = jobData && jobData.status === "completed";
  const isFailed  = jobData && jobData.status === "failed";
  const result    = jobData?.result;
  const catColor  = selectedCategory ? (CAT_COLORS[selectedCategory] || "#059669") : "#059669";

  return (
    <div style={{
      height: "100%", overflowY: "auto", padding: "24px 28px",
      fontFamily: "Inter, system-ui, sans-serif", background: "#f8fafc",
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .nf-card { animation: fadeIn 0.3s ease; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, #065f46, #059669)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 2px 8px rgba(5,150,105,0.3)",
          }}>🔬</div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", margin: 0 }}>
              NetFlora — Detección de Especies
            </h2>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, marginTop: 2 }}>
              Embrapa Acre · JBS Fundo Amazônia · YOLOv7 · 72 especies · +50.000 ha mapeadas
            </p>
          </div>
        </div>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "8px 14px" }}>
          <p style={{ fontSize: 12, color: "#166534", margin: 0 }}>
            ℹ️ Detección con modelos YOLOv7 reales de Embrapa. Sin ortofoto, usa imagen de muestra del repo oficial.
          </p>
        </div>
      </div>

      {/* ── Selector de Categoría ── */}
      {!isRunning && !isDone && !isFailed && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            1. Categoría de detección
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
            {Object.entries(CATEGORIES).map(([cat, info]) => {
              const selected = selectedCategory === cat;
              const available = AVAILABLE_CATS.has(cat);
              const color = CAT_COLORS[cat];
              return (
                <button
                  key={cat}
                  onClick={() => available && setSelectedCategory(cat)}
                  style={{
                    textAlign: "left", borderRadius: 12, padding: "10px 12px",
                    border: `2px solid ${selected ? color : available ? "#e2e8f0" : "#f1f5f9"}`,
                    background: selected ? `${color}12` : available ? "white" : "#fafafa",
                    cursor: available ? "pointer" : "not-allowed",
                    opacity: available ? 1 : 0.55,
                    transition: "all 0.15s",
                    boxShadow: selected ? `0 0 0 3px ${color}20` : "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 17 }}>{info.emoji}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                      background: available ? "#d1fae5" : "#f1f5f9",
                      color: available ? "#059669" : "#94a3b8",
                    }}>
                      {available ? "✓ Modelo" : "Sin modelo"}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: selected ? color : "#1e293b", margin: 0 }}>{cat}</p>
                  <p style={{ fontSize: 10, color: "#94a3b8", margin: "1px 0 0" }}>{info.speciesCount} especies</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Upload de ortofoto + selector de análisis existentes ── */}
      {selectedCategory && !isRunning && !isDone && !isFailed && (
        <div className="nf-card" style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "12px 16px", marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>
            2. Ortofoto
          </p>

          {/* Upload directo */}
          <input
            ref={fileRef}
            type="file"
            accept=".tif,.tiff"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleUpload(f);
            }}
            style={{
              border: uploadedFileId ? "2px solid #059669" : "2px dashed #cbd5e1",
              borderRadius: 10,
              padding: "14px",
              textAlign: "center",
              cursor: "pointer",
              background: uploadedFileId ? "#f0fdf4" : "#fafafa",
              transition: "all 0.2s",
              marginBottom: 10,
            }}
          >
            {uploading ? (
              <span style={{ fontSize: 13, color: "#059669" }}>⏳ Subiendo ortofoto...</span>
            ) : uploadedFileId ? (
              <div>
                <span style={{ fontSize: 16 }}>✅</span>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#166534", margin: "4px 0 0" }}>
                  Ortofoto subida — lista para detectar
                </p>
                <p style={{ fontSize: 11, color: "#059669", margin: 0 }}>{uploadedFileId.slice(0,8)}...</p>
              </div>
            ) : (
              <div>
                <span style={{ fontSize: 20 }}>📤</span>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#475569", margin: "4px 0 0" }}>
                  Subí tu ortofoto
                </p>
                <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>
                  GeoTIFF .tif / .tiff — o arrastrá aquí
                </p>
              </div>
            )}
          </div>

          {/* O usar análisis existente */}
          {completedAnalyses.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 10, color: "#94a3b8", margin: "0 0 6px" }}>O usá una ortofoto ya cargada:</p>
              <select
                value={selectedAnalysisId || ""}
                onChange={e => {
                  setSelectedAnalysisId(e.target.value || null);
                  if (e.target.value) setUploadedFileId(null); // limpiar upload
                }}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0",
                  fontSize: 13, color: "#1e293b", background: "white", cursor: "pointer" }}
              >
                <option value="">— Ninguna (usar imagen de muestra) —</option>
                {completedAnalyses.map((a: any) => (
                  <option key={a.analysis_id} value={a.analysis_id}>
                    🌲 {a.name || a.filename} ({a.tree_count} árboles)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── Configuración ── */}
      {selectedCategory && !isRunning && !isDone && !isFailed && (
        <div className="nf-card" style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "12px 16px", marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>
            3. Confianza mínima: <strong style={{ color: "#1e293b" }}>{(conf * 100).toFixed(0)}%</strong>
          </p>
          <input type="range" min={0.1} max={0.9} step={0.05} value={conf}
            onChange={e => setConf(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: catColor }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
            <span>10% (más detecciones)</span><span>90% (más precisión)</span>
          </div>
        </div>
      )}

      {/* ── Botón detectar ── */}
      {selectedCategory && !isRunning && !isDone && !isFailed && (
        <div className="nf-card" style={{ marginBottom: 16 }}>
          <button onClick={handleDetect} style={{
            width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
            background: `linear-gradient(135deg, ${catColor}, ${catColor}cc)`,
            color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer",
            boxShadow: `0 4px 16px ${catColor}40`,
          }}>
            🔬 Detectar especies · {selectedCategory}
          </button>
        </div>
      )}

      {/* ── Progreso ── */}
      {isRunning && (
        <div className="nf-card" style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "24px 20px", marginBottom: 16, textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #059669", borderTopColor: "transparent",
            borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }} />
          <p style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", margin: 0 }}>Procesando con YOLOv7...</p>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 14px" }}>
            {jobData?.current_step || "Inicializando..."}
          </p>
          <div style={{ background: "#f1f5f9", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 999,
              background: `linear-gradient(90deg, ${catColor}, #10b981)`,
              width: `${jobData?.progress || 0}%`, transition: "width 0.5s ease",
            }} />
          </div>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>{jobData?.progress || 0}%</p>
        </div>
      )}

      {/* ── Error ── */}
      {isFailed && (
        <div className="nf-card" style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#991b1b", margin: "0 0 6px" }}>⚠️ Error en la detección</p>
          <p style={{ fontSize: 12, color: "#b91c1c", margin: 0 }}>{jobData?.error || "Error desconocido"}</p>
          <button onClick={handleReset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "none",
            background: "#fee2e2", color: "#991b1b", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            🔄 Reintentar
          </button>
        </div>
      )}

      {/* ── Resultado ── */}
      {isDone && result && (
        <div className="nf-card" style={{ marginBottom: 16 }}>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
            {[
              { label: "Detectados",       value: result.total_detected,                              emoji: "🌿", color: "#059669" },
              { label: "Área procesada",   value: result.area_ha > 0 ? `${result.area_ha} ha` : "—", emoji: "📐", color: "#0369a1" },
              { label: "Tiempo",           value: `${result.processing_time_s}s`,                     emoji: "⚡", color: "#d97706" },
              { label: "Tiles",            value: result.tiles_processed,                              emoji: "🔲", color: "#7c3aed" },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: "white", borderRadius: 12, padding: "12px 14px",
                border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <span style={{ fontSize: 20 }}>{kpi.emoji}</span>
                <p style={{ fontSize: 18, fontWeight: 800, color: kpi.color, margin: "4px 0 2px", lineHeight: 1 }}>{kpi.value}</p>
                <p style={{ fontSize: 10, color: "#94a3b8", margin: 0 }}>{kpi.label}</p>
              </div>
            ))}
          </div>

          {/* Tabla de especies */}
          {result.species && result.species.length > 0 ? (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 12 }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9",
                display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#475569", margin: 0 }}>
                  Distribución por especie · {result.category}
                </p>
                <button onClick={() => setExpandSpecies(!expandSpecies)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#94a3b8" }}>
                  {expandSpecies ? "▲ Menos" : "▼ Todas"}
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Especie", "Científico", "N", "Conf", ""].map(h => (
                      <th key={h} style={{ padding: "7px 14px", textAlign: "left", fontSize: 10, fontWeight: 700,
                        color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em",
                        borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(expandSpecies ? result.species : result.species.slice(0, 6)).map((sp: any, i: number) => {
                    const color = SPECIES_PALETTE[i % SPECIES_PALETTE.length];
                    return (
                      <tr key={sp.species_id} style={{ borderBottom: "1px solid #f8fafc" }}>
                        <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{sp.common_name}</td>
                        <td style={{ padding: "9px 14px", fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{sp.scientific_name || "—"}</td>
                        <td style={{ padding: "9px 14px", fontSize: 15, fontWeight: 800, color }}>{sp.count}</td>
                        <td style={{ padding: "9px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 999, height: 5, minWidth: 40, overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 999, background: color, width: `${(sp.conf_avg || 0) * 100}%` }} />
                            </div>
                            <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>{((sp.conf_avg || 0) * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                        <td style={{ padding: "9px 14px" }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: "16px 20px", marginBottom: 12, textAlign: "center" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#92400e", margin: 0 }}>
                No se detectaron especies con confianza ≥ {(conf * 100).toFixed(0)}%
              </p>
              <p style={{ fontSize: 12, color: "#b45309", margin: "4px 0 0" }}>
                Probá bajar el umbral de confianza o usar una ortofoto real de la zona.
              </p>
            </div>
          )}

          {/* Barra de composición */}
          {result.species && result.species.length > 1 && (
            <div style={{ background: "white", borderRadius: 12, border: "1px solid #e2e8f0", padding: "12px 16px", marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Composición del inventario
              </p>
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 16 }}>
                {result.species.map((sp: any, i: number) => (
                  <div key={sp.species_id} title={`${sp.common_name}: ${sp.count}`}
                    style={{ flex: sp.count, background: SPECIES_PALETTE[i % SPECIES_PALETTE.length] }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6 }}>
                {result.species.map((sp: any, i: number) => (
                  <div key={sp.species_id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: SPECIES_PALETTE[i % SPECIES_PALETTE.length] }} />
                    <span style={{ fontSize: 10, color: "#475569" }}>{sp.common_name} ({sp.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acciones */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleReset} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid #e2e8f0",
              background: "white", color: "#475569", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              🔄 Nueva detección
            </button>
            <button onClick={() => {
              if (!result) return;
              const csv = ["especie,cientifico,cantidad,confianza_promedio",
                ...(result.species || []).map((s: any) =>
                  `"${s.common_name}","${s.scientific_name || ""}",${s.count},${s.conf_avg}`)
              ].join("\n");
              const blob = new Blob([csv], { type: "text/csv" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `netflora_${result.category}_${Date.now()}.csv`;
              a.click();
            }} style={{ flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg, #1e293b, #334155)",
              color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ⬇ Exportar CSV
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ textAlign: "center", padding: "12px 0 4px", borderTop: "1px solid #f1f5f9" }}>
        <p style={{ fontSize: 11, color: "#cbd5e1", margin: 0 }}>
          Modelos YOLOv7 entrenados por <strong>Embrapa Acre</strong> · <strong>Fundo JBS Amazônia</strong>
          {" · "}
          <a href="https://github.com/NetFlora/Netflora" target="_blank" rel="noreferrer"
            style={{ color: "#94a3b8", textDecoration: "none" }}>github.com/NetFlora/Netflora</a>
        </p>
      </div>
    </div>
  );
}

