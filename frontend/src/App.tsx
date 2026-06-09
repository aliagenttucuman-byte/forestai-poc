import { useState, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { forestApi, type Analysis } from "./api/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import MapPanel from "./components/MapPanel";
import StatsPanel from "./components/StatsPanel";
import GeoPanel from "./components/GeoPanel";
import TreeDetectionPanel from "./components/TreeDetectionPanel";
import Forest3DView from "./components/Forest3DView";
import NetFloraPanel from "./components/NetFloraPanel";

const qc = new QueryClient();
const API_BASE = import.meta.env.VITE_API_URL || "";

// ─── Hook mobile ──────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return isMobile;
}

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
function UploadZone({ onSuccess, compact }: { onSuccess: (id: string) => void; compact?: boolean }) {
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
        gap: compact ? 8 : 12, width: "100%", borderRadius: 16, cursor: "pointer",
        padding: compact ? "20px 16px" : "32px 24px",
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
          <div style={{ width: 36, height: 36, border: "3px solid #10b981", borderTopColor: "transparent",
            borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Subiendo ortofoto...</span>
        </>
      ) : (
        <>
          <div style={{ width: compact ? 40 : 56, height: compact ? 40 : 56, borderRadius: 12, background: "#d1fae5",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: compact ? 20 : 26 }}>🛰️</div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: compact ? 13 : 14, fontWeight: 600, color: "#1e293b" }}>
              {compact ? "Subir ortofoto" : "Arrastrá tu ortofoto aquí"}
            </p>
            {!compact && (
              <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>o hacé clic para seleccionar · GeoTIFF (.tif / .tiff)</p>
            )}
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

    const el = document.createElement("div");
    el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid white;box-shadow:0 0 6px rgba(16,185,129,0.6)";
    new maplibregl.Marker({ element: el }).setLngLat([centerLon, centerLat]).addTo(map);
    map.flyTo({ center: [centerLon, centerLat], zoom: 12 });
  }, [trees]);

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

// ─── Sidebar de detalle (desktop) / Bottom Sheet (mobile) ─────────────────────
function DetailSidebar({ a, onClose, onViewMap, onReprocess, isMobile }: {
  a: Analysis; onClose: () => void; onViewMap: () => void; onReprocess: () => void; isMobile: boolean;
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

  const innerContent = (
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

      {/* Mini mapa */}
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

      {/* Extra padding en mobile para que el contenido no quede detrás del bottom nav */}
      {isMobile && <div style={{ height: 16 }} />}
    </div>
  );

  // ── MOBILE: bottom sheet ──
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.4)",
            animation: "fadeIn 0.2s ease",
          }}
        />
        {/* Sheet */}
        <div style={{
          position: "fixed", bottom: 64, left: 0, right: 0, zIndex: 201,
          background: "white", borderRadius: "20px 20px 0 0",
          boxShadow: "0 -4px 30px rgba(0,0,0,0.15)",
          maxHeight: "72vh", overflowY: "auto",
          animation: "slideUp 0.3s ease",
        }}>
          {/* Handle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 0 4px" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0" }} />
          </div>
          {/* Header */}
          <div style={{ padding: "4px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
              {a.name || a.filename}
            </span>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "#94a3b8", lineHeight: 1 }}>×</button>
          </div>
          {innerContent}
        </div>
      </>
    );
  }

  // ── DESKTOP: aside lateral ──
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
      {innerContent}
    </aside>
  );
}

// ─── Bottom Navigation (mobile) ───────────────────────────────────────────────
const TABS = [
  { key: "grid",  icon: "⊞",  label: "Ortofotos" },
  { key: "map",   icon: "🗺", label: "Mapa" },
  { key: "geo",   icon: "🌍", label: "Geo" },
  { key: "trees", icon: "🌲", label: "Detección" },
  { key: "3d",       icon: "🔮", label: "Vista 3D" },
  { key: "netflora", icon: "🔬", label: "NetFlora" },
] as const;

function BottomNav({ view, setView }: { view: string; setView: (v: "grid"|"map"|"geo"|"trees"|"3d"|"netflora") => void }) {
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
      background: "white", borderTop: "1px solid #e2e8f0",
      boxShadow: "0 -2px 12px rgba(0,0,0,0.08)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      display: "grid",
      gridTemplateColumns: "repeat(6, 1fr)",
    }}>
      {TABS.map(t => {
        const active = view === t.key;
        return (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 2, border: "none", cursor: "pointer",
              background: active ? "#f0fdf4" : "transparent",
              padding: "8px 2px 6px",
              color: active ? "#10b981" : "#94a3b8",
              transition: "all 0.15s",
              position: "relative",
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 8.5, fontWeight: active ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", padding: "0 2px" }}>{t.label}</span>
            {active && (
              <div style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
                width: 20, height: 3, background: "#10b981", borderRadius: "2px 2px 0 0" }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ─── ForestApp ────────────────────────────────────────────────────────────────
function ForestApp() {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "map" | "geo" | "trees" | "3d" | "netflora">("grid");
  const [mapSidebarOpen, setMapSidebarOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: forestApi.listAnalyses,
    refetchInterval: 5000,
  });

  const analyses: Analysis[] = data?.items || [];
  const totalTrees = analyses.filter(a => a.status === "completed").reduce((s, a) => s + (a.tree_count || 0), 0);
  const selected = analyses.find(a => a.analysis_id === selectedId) ?? null;

  // Cerrar bottom sheet al cambiar de vista en mobile
  useEffect(() => {
    if (isMobile) setSelectedId(null);
  }, [view, isMobile]);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ── CSS animations ── */}
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        background: "white", borderBottom: "1px solid #e2e8f0",
        padding: isMobile ? "0 16px" : "0 24px",
        height: isMobile ? 52 : 60,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0, position: "sticky", top: 0, zIndex: 50,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12 }}>
          <div style={{
            width: isMobile ? 32 : 38, height: isMobile ? 32 : 38,
            borderRadius: 10, background: "linear-gradient(135deg,#10b981,#34d399)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: isMobile ? 16 : 20, boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
          }}>🌲</div>
          <div>
            <h1 style={{ fontSize: isMobile ? 15 : 16, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>ForestAI</h1>
            {!isMobile && (
              <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, lineHeight: 1 }}>Inventario forestal con drones</p>
            )}
          </div>
        </div>

        {/* Tabs — solo desktop */}
        {!isMobile && (
          <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setView(t.key)} style={{
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
        )}

        {/* Stats rápidas */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 20 }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>{analyses.length}</p>
            <p style={{ fontSize: 10, color: "#94a3b8" }}>fotos</p>
          </div>
          <div style={{ width: 1, height: 28, background: "#e2e8f0" }} />
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color: "#059669", lineHeight: 1 }}>{totalTrees}</p>
            <p style={{ fontSize: 10, color: "#94a3b8" }}>árboles</p>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", paddingBottom: isMobile ? 64 : 0 }}>

        {view === "grid" ? (
          <>
            {/* Columna principal */}
            <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 12 : 24 }}>
              <UploadZone onSuccess={(id) => { setSelectedId(id); }} compact={isMobile} />

              <div style={{ marginTop: isMobile ? 20 : 28 }}>
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
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "repeat(auto-fill, minmax(160px, 1fr))"
                      : "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: isMobile ? 10 : 16,
                  }}>
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

            {/* Sidebar detalle — desktop aside / mobile bottom sheet */}
            {selected && (
              <DetailSidebar
                a={selected}
                onClose={() => setSelectedId(null)}
                onViewMap={() => setView("map")}
                onReprocess={() => {}}
                isMobile={isMobile}
              />
            )}
          </>
        ) : view === "map" ? (
          /* ── Vista mapa ── */
          <>
            {/* Sidebar lista — desktop siempre visible / mobile toggle */}
            {(!isMobile || mapSidebarOpen) && (
              <>
                {/* Overlay en mobile */}
                {isMobile && mapSidebarOpen && (
                  <div
                    onClick={() => setMapSidebarOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.3)", animation: "fadeIn 0.2s" }}
                  />
                )}
                <aside style={{
                  width: isMobile ? "80vw" : 240,
                  maxWidth: isMobile ? 300 : undefined,
                  background: "white", borderRight: "1px solid #e2e8f0",
                  overflowY: "auto", flexShrink: 0,
                  position: isMobile ? "fixed" : "relative",
                  left: isMobile ? 0 : undefined,
                  top: isMobile ? 52 : undefined,
                  bottom: isMobile ? 64 : undefined,
                  zIndex: isMobile ? 91 : undefined,
                  boxShadow: isMobile ? "4px 0 20px rgba(0,0,0,0.12)" : undefined,
                  animation: isMobile ? "slideInLeft 0.25s ease" : undefined,
                }}>
                  <style>{`@keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {isMobile ? (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>Ortofotos</span>
                        <button onClick={() => setMapSidebarOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8" }}>×</button>
                      </>
                    ) : (
                      <button onClick={() => setView("grid")} style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 13, color: "#64748b", fontWeight: 600, display: "flex", alignItems: "center", gap: 4,
                      }}>← Ortofotos</button>
                    )}
                  </div>
                  <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {analyses.filter(a => a.status === "completed").map(a => (
                      <button key={a.analysis_id} onClick={() => { setSelectedId(a.analysis_id); if (isMobile) setMapSidebarOpen(false); }} style={{
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
              </>
            )}

            {/* Mapa + botón flotante en mobile */}
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {/* Botón abrir sidebar en mobile */}
              {isMobile && !mapSidebarOpen && (
                <button
                  onClick={() => setMapSidebarOpen(true)}
                  style={{
                    position: "absolute", top: 12, left: 12, zIndex: 10,
                    background: "white", border: "none", borderRadius: 10,
                    padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#374151",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.15)", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  ☰ Ortofotos
                </button>
              )}
              <MapPanel analysisId={selectedId} onSelectAnalysis={(id) => { setSelectedId(id); }} />
            </div>
          </>
        ) : view === "geo" ? (
          /* ── Vista Geo Servicios ── */
          <div style={{ flex: 1, overflow: "hidden" }}>
            <GeoPanel />
          </div>
        ) : view === "trees" ? (
          /* ── Vista Detección IA ── */
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TreeDetectionPanel />
          </div>
        ) : view === "3d" ? (
          /* ── Vista 3D Three.js ── */
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Forest3DView />
          </div>
        ) : view === "netflora" ? (
          /* ── Vista NetFlora — Detección de Especies ── */
          <div style={{ flex: 1, overflow: "hidden" }}>
            <NetFloraPanel />
          </div>
        ) : (
          /* ── Vista Detección IA (fallback) ── */
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TreeDetectionPanel />
          </div>
        )}
      </div>

      {/* ── Bottom Navigation (mobile) ── */}
      {isMobile && <BottomNav view={view} setView={setView} />}
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
