import { useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { forestApi, type Analysis } from "./api/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapPanel from "./components/MapPanel";
import StatsPanel from "./components/StatsPanel";

const qc = new QueryClient();

const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending:    { label: "En cola",    bg: "#fef9c3", color: "#92400e", border: "#fde68a" },
  processing: { label: "Analizando", bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
  completed:  { label: "Listo",      bg: "#d1fae5", color: "#065f46", border: "#a7f3d0" },
  failed:     { label: "Error",      bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status as keyof typeof STATUS_MAP] || STATUS_MAP.pending;
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
      display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
    }}>
      {status === "processing" && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", animation: "pulse 1.5s infinite" }} />
      )}
      {s.label}
    </span>
  );
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────
function Thumbnail({ id }: { id: string }) {
  const [err, setErr] = useState(false);
  if (err) return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", background: "#f1f5f9", borderRadius: 10 }}>
      <span style={{ fontSize: 28, marginBottom: 4 }}>🛸</span>
      <span style={{ fontSize: 11, color: "#94a3b8" }}>Sin previa</span>
    </div>
  );
  return (
    <img
      src={`${API_BASE}/api/analyses/${id}/thumbnail`}
      alt="preview ortofoto"
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }}
      onError={() => setErr(true)}
    />
  );
}

// ─── UploadZone ───────────────────────────────────────────────────────────────
function UploadZone({ onSuccess }: { onSuccess: (id: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const qc2 = useQueryClient();
  const { mutate, isPending, error } = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.(tif|tiff)$/i, ""));
      return forestApi.createAnalysis(form);
    },
    onSuccess: (data) => {
      qc2.invalidateQueries({ queryKey: ["analyses"] });
      onSuccess(data.analysis_id);
    },
  });
  const handle = (file: File) => { if (/\.(tif|tiff)$/i.test(file.name)) mutate(file); };

  return (
    <label
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 12, width: "100%", borderRadius: 16, cursor: "pointer", padding: "32px 24px",
        border: `2px dashed ${dragging ? "#10b981" : "#cbd5e1"}`,
        background: dragging ? "#ecfdf5" : "#f8fafc",
        transition: "all 0.2s",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
    >
      <input type="file" accept=".tif,.tiff" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      {isPending ? (
        <>
          <div style={{ width: 40, height: 40, border: "3px solid #10b981", borderTopColor: "transparent",
            borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#059669" }}>Subiendo ortofoto...</span>
        </>
      ) : (
        <>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#d1fae5",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>🛰️</div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>Arrastrá tu ortofoto aquí</p>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>o hacé clic para seleccionar · GeoTIFF (.tif / .tiff)</p>
          </div>
          {error && <p style={{ fontSize: 12, color: "#ef4444" }}>Error al subir. Verificá el formato.</p>}
        </>
      )}
    </label>
  );
}

// ─── Card de análisis ─────────────────────────────────────────────────────────
function AnalysisCard({ a, selected, onSelect }: { a: Analysis; selected: boolean; onSelect: () => void }) {
  const date = new Date(a.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <button onClick={onSelect} style={{
      width: "100%", textAlign: "left", borderRadius: 16, padding: 12, cursor: "pointer",
      border: `2px solid ${selected ? "#10b981" : "#e2e8f0"}`,
      background: selected ? "#ecfdf5" : "white",
      boxShadow: selected ? "0 4px 16px rgba(16,185,129,0.15)" : "0 1px 4px rgba(0,0,0,0.05)",
      transition: "all 0.15s", display: "block",
    }}>
      {/* Thumbnail */}
      <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 10, overflow: "hidden", background: "#f1f5f9", marginBottom: 10 }}>
        <Thumbnail id={a.analysis_id} />
      </div>
      {/* Info row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.name || a.filename}
          </p>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{date}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>
      {/* Árbol count */}
      {a.status === "completed" && a.tree_count !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 16 }}>🌲</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#059669" }}>{a.tree_count}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>árboles detectados</span>
        </div>
      )}
    </button>
  );
}

// ─── Mini mapa de ubicación ───────────────────────────────────────────────────
function LocationMiniMap({ analysisId }: { analysisId: string }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInst = useRef<maplibregl.Map | null>(null);

  const { data: trees } = useQuery({
    queryKey: ["trees", analysisId],
    queryFn: () => forestApi.getTrees(analysisId),
    enabled: !!analysisId,
  });

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    mapInst.current = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OSM" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [0, 0], zoom: 2,
      interactive: false,
    });
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map || !trees?.length) return;
    const valid = trees.filter(t => t.lat !== 0 && t.lon !== 0);
    if (!valid.length) return;
    const lons = valid.map(t => t.lon);
    const lats = valid.map(t => t.lat);
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;

    // Marcador de ubicación
    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid white;box-shadow:0 0 6px rgba(16,185,129,0.6)";
    new maplibregl.Marker({ element: el }).setLngLat([centerLon, centerLat]).addTo(map);
    map.flyTo({ center: [centerLon, centerLat], zoom: 12 });
  }, [trees]);

  // País/región aproximada usando lat/lon
  const valid = (trees || []).filter(t => t.lat !== 0 && t.lon !== 0);
  const centerLat = valid.length ? (valid.reduce((s,t) => s+t.lat, 0)/valid.length).toFixed(4) : null;
  const centerLon = valid.length ? (valid.reduce((s,t) => s+t.lon, 0)/valid.length).toFixed(4) : null;

  return (
    <div>
      <div ref={mapRef} style={{ width: "100%", height: 160, borderRadius: 12, overflow: "hidden", marginBottom: 6 }} />
      {centerLat && (
        <p style={{ fontSize: 11, color: "#64748b", textAlign: "center" }}>
          📍 {centerLat}°, {centerLon}°
        </p>
      )}
    </div>
  );
}

// ─── Sidebar de detalle ───────────────────────────────────────────────────────
function DetailSidebar({ a, onClose, onViewMap, onReprocess }: {
  a: Analysis; onClose: () => void; onViewMap: () => void; onReprocess: () => void;
}) {
  const qc2 = useQueryClient();
  const { mutate: reprocess, isPending: reprocessing } = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/analyses/${a.analysis_id}/reprocess`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc2.invalidateQueries({ queryKey: ["analyses"] });
      onReprocess();
    },
  });

  return (
    <aside style={{
      width: 300, borderLeft: "1px solid #e2e8f0", background: "white",
      overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>Detalle</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
      </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Thumbnail */}
        <div style={{ aspectRatio: "16/9", borderRadius: 12, overflow: "hidden", background: "#f1f5f9" }}>
          <Thumbnail id={a.analysis_id} />
        </div>

        {/* Meta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "Nombre", value: a.name || a.filename },
            { label: "Archivo", value: a.filename },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", textAlign: "right",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{value}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Estado</span>
            <StatusBadge status={a.status} />
          </div>
        </div>

        {/* Mini mapa de ubicación (solo si completado y tiene coords) */}
        {a.status === "completed" && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
              letterSpacing: "0.06em", marginBottom: 8 }}>Ubicación</p>
            <LocationMiniMap analysisId={a.analysis_id} />
          </div>
        )}

        {/* Stats */}
        {a.status === "completed" && (
          <StatsPanel analysisId={a.analysis_id} onExport={() => {}} />
        )}

        {/* Botones acción */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {a.status === "completed" && (
            <button onClick={onViewMap} style={{
              width: "100%", padding: "10px 0", borderRadius: 12, border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #10b981, #34d399)", color: "white",
              fontSize: 13, fontWeight: 700,
            }}>
              🗺 Ver árboles en mapa
            </button>
          )}

          {/* Botón reprocesar */}
          <button
            onClick={() => reprocess()}
            disabled={reprocessing || a.status === "processing" || a.status === "pending"}
            style={{
              width: "100%", padding: "9px 0", borderRadius: 12, cursor: reprocessing ? "wait" : "pointer",
              border: "1px solid #e2e8f0", background: reprocessing ? "#f1f5f9" : "white",
              color: reprocessing ? "#94a3b8" : "#475569", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              opacity: (a.status === "processing" || a.status === "pending") ? 0.5 : 1,
            }}
          >
            {reprocessing ? (
              <>
                <div style={{ width: 14, height: 14, border: "2px solid #94a3b8", borderTopColor: "transparent",
                  borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Encolando...
              </>
            ) : (
              <> 🔄 Reprocesar</>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── ForestApp ────────────────────────────────────────────────────────────────
function ForestApp() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "map">("grid");

  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: forestApi.listAnalyses,
    refetchInterval: 5000,
  });

  const analyses: Analysis[] = data?.items || [];
  const totalTrees = analyses.filter(a => a.status === "completed").reduce((s, a) => s + (a.tree_count || 0), 0);
  const selected = analyses.find(a => a.analysis_id === selectedId) ?? null;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        background: "white", borderBottom: "1px solid #e2e8f0", padding: "0 24px",
        height: 60, display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, position: "sticky", top: 0, zIndex: 50,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "linear-gradient(135deg,#10b981,#34d399)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 2px 8px rgba(16,185,129,0.3)" }}>🌲</div>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>ForestAI</h1>
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, lineHeight: 1 }}>Inventario forestal con drones</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
          {[{ key: "grid", icon: "⊞", label: "Ortofotos" }, { key: "map", icon: "🗺", label: "Mapa" }].map(t => (
            <button key={t.key} onClick={() => setView(t.key as "grid" | "map")} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
              borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: view === t.key ? "white" : "transparent",
              color: view === t.key ? "#1e293b" : "#64748b",
              boxShadow: view === t.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
              transition: "all 0.15s",
            }}>
              <span>{t.icon}</span><span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Stats rápidas */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>{analyses.length}</p>
            <p style={{ fontSize: 11, color: "#94a3b8" }}>ortofotos</p>
          </div>
          <div style={{ width: 1, height: 32, background: "#e2e8f0" }} />
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#059669", lineHeight: 1 }}>{totalTrees}</p>
            <p style={{ fontSize: 11, color: "#94a3b8" }}>árboles</p>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {view === "grid" ? (
          <>
            {/* Columna principal */}
            <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
              <UploadZone onSuccess={(id) => { setSelectedId(id); }} />

              <div style={{ marginTop: 28 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
                  Ortofotos cargadas
                </p>

                {isLoading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 12 }}>
                    <div style={{ width: 24, height: 24, border: "2px solid #10b981", borderTopColor: "transparent",
                      borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>Cargando...</span>
                  </div>
                ) : analyses.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🛸</div>
                    <p style={{ fontSize: 14 }}>Todavía no subiste ninguna ortofoto</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
                    {analyses.map(a => (
                      <AnalysisCard
                        key={a.analysis_id}
                        a={a}
                        selected={a.analysis_id === selectedId}
                        onSelect={() => setSelectedId(a.analysis_id === selectedId ? null : a.analysis_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar detalle */}
            {selected && (
              <DetailSidebar
                a={selected}
                onClose={() => setSelectedId(null)}
                onViewMap={() => setView("map")}
                onReprocess={() => {}}
              />
            )}
          </>
        ) : (
          /* ── Vista mapa ── */
          <>
            {/* Mini sidebar lista */}
            <aside style={{ width: 240, background: "white", borderRight: "1px solid #e2e8f0", overflowY: "auto", flexShrink: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                <button onClick={() => setView("grid")} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 13, color: "#64748b", fontWeight: 600, display: "flex", alignItems: "center", gap: 4,
                }}>← Ortofotos</button>
              </div>
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {analyses.filter(a => a.status === "completed").map(a => (
                  <button key={a.analysis_id} onClick={() => setSelectedId(a.analysis_id)} style={{
                    width: "100%", textAlign: "left", borderRadius: 10, padding: "10px 12px",
                    border: `1px solid ${a.analysis_id === selectedId ? "#a7f3d0" : "transparent"}`,
                    background: a.analysis_id === selectedId ? "#ecfdf5" : "transparent",
                    cursor: "pointer", transition: "all 0.15s",
                  }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: a.analysis_id === selectedId ? "#059669" : "#374151",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.name || a.filename}
                    </p>
                    <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>🌲 {a.tree_count} árboles</p>
                  </button>
                ))}
              </div>
            </aside>

            {/* Mapa */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <MapPanel analysisId={selectedId} onSelectAnalysis={(id) => { setSelectedId(id); }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ForestApp />
    </QueryClientProvider>
  );
}
