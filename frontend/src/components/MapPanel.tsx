import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forestApi, type Analysis, type TreeResult } from "../api/client";

interface Props {
  analysisId: string | null;
  onSelectAnalysis: (id: string) => void;
}

const SPECIES_COLORS: Record<string, string> = {
  eucalipto:   "#10b981",
  pino:        "#34d399",
  quebracho:   "#f59e0b",
  algarrobo:   "#a78bfa",
  araucaria:   "#38bdf8",
  desconocida: "#94a3b8",
};
function getColor(species: string) {
  return SPECIES_COLORS[species?.toLowerCase()] ?? SPECIES_COLORS.desconocida;
}

export default function MapPanel({ analysisId, onSelectAnalysis }: Props) {
  const mapRef     = useRef<HTMLDivElement>(null);
  const mapInst    = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeResult | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const { data: allAnalyses } = useQuery({
    queryKey: ["analyses"],
    queryFn: () => forestApi.listAnalyses(),
    refetchInterval: 4000,
  });

  const { data: trees, isLoading } = useQuery({
    queryKey: ["trees", analysisId],
    queryFn: () => forestApi.getTrees(analysisId!),
    enabled: !!analysisId,
  });

  const { data: bounds } = useQuery({
    queryKey: ["bounds", analysisId],
    queryFn: async () => {
      const r = await fetch(`/api/analyses/${analysisId}/bounds`);
      if (!r.ok) throw new Error("no bounds");
      return r.json() as Promise<{ west:number; south:number; east:number; north:number }>;
    },
    enabled: !!analysisId,
  });

  // ── Init mapa ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    mapInst.current = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OSM" },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [-55, -35],
      zoom: 3,
    });
    mapInst.current.addControl(new maplibregl.NavigationControl(), "top-right");
    mapInst.current.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  }, []);

  // ── Overlay ortofoto ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    if (!map || !bounds || !analysisId) return;

    const sourceId = `ortho-${analysisId}`;
    const layerId  = `ortho-layer-${analysisId}`;
    const imgUrl   = `/api/analyses/${analysisId}/thumbnail?t=${Date.now()}`;

    const addLayer = () => {
      // Limpiar capas anteriores
      map.getStyle().layers?.forEach(l => { if (l.id.startsWith("ortho-layer-")) { try { map.removeLayer(l.id); } catch(_){} } });
      Object.keys((map.getStyle().sources || {})).forEach(s => { if (s.startsWith("ortho-")) { try { map.removeSource(s); } catch(_){} } });

      if (showOverlay) {
        map.addSource(sourceId, {
          type: "image",
          url: imgUrl,
          coordinates: [
            [bounds.west, bounds.north],
            [bounds.east, bounds.north],
            [bounds.east, bounds.south],
            [bounds.west, bounds.south],
          ],
        });
        map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": 0.85 } });
      }
    };

    if (map.isStyleLoaded()) addLayer();
    else map.once("load", addLayer);
  }, [bounds, analysisId, showOverlay]);

  // ── Plotear árboles ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapInst.current;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    setSelectedTree(null);
    if (!map || !trees?.length) return;

    const valid = trees.filter(t => t.lat !== 0 && t.lon !== 0);
    if (!valid.length) return;

    const lons = valid.map(t => t.lon);
    const lats = valid.map(t => t.lat);
    map.fitBounds(
      [[Math.min(...lons) - 0.001, Math.min(...lats) - 0.001],
       [Math.max(...lons) + 0.001, Math.max(...lats) + 0.001]],
      { padding: 60, maxZoom: 18 }
    );

    valid.forEach(tree => {
      const color = getColor(tree.species);
      const size  = Math.max(12, Math.min(28, (tree.crown_area_m2 || 4) * 3));
      const el    = document.createElement("div");
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${color}44;border:2px solid ${color};cursor:pointer;transition:box-shadow 0.15s;box-shadow:0 0 8px ${color}66;`;
      el.onmouseenter = () => { el.style.boxShadow = `0 0 0 8px ${color}33, 0 0 16px ${color}88`; el.style.zIndex = "10"; };
      el.onmouseleave = () => { el.style.boxShadow = `0 0 8px ${color}66`; el.style.zIndex = ""; };
      el.onclick = (e) => { e.stopPropagation(); setSelectedTree(tree); };
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([tree.lon, tree.lat]).addTo(map)
      );
    });
  }, [trees]);

  // ── Conteo por especie ─────────────────────────────────────────────────────
  const speciesCounts = (trees || []).reduce((acc: Record<string, number>, t) => {
    const sp = t.species || "desconocida";
    acc[sp] = (acc[sp] || 0) + 1;
    return acc;
  }, {});

  const completed = (allAnalyses?.items || []).filter(a => a.status === "completed");
  const selected  = completed.find(a => a.analysis_id === analysisId);

  return (
    <div style={{ position: "relative", flex: 1, height: "100%", display: "flex", flexDirection: "column" }}>

      {/* ── Barra superior ── */}
      <div style={{
        position: "absolute", top: 16, left: 16, zIndex: 10,
        display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      }}>
        {/* Selector de análisis */}
        <select
          value={analysisId || ""}
          onChange={e => e.target.value && onSelectAnalysis(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0",
            background: "white", fontSize: 13, fontWeight: 600, color: "#1e293b",
            cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <option value="">— Seleccioná una ortofoto —</option>
          {completed.map((a: Analysis) => (
            <option key={a.analysis_id} value={a.analysis_id}>
              {a.name || a.filename} ({a.tree_count || 0} árboles)
            </option>
          ))}
        </select>

        {/* Toggle overlay */}
        {analysisId && bounds && (
          <button
            onClick={() => setShowOverlay(v => !v)}
            style={{
              padding: "7px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0",
              background: showOverlay ? "#ecfdf5" : "white", fontSize: 12, fontWeight: 600,
              color: showOverlay ? "#059669" : "#64748b", cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            {showOverlay ? "🛰 Ortofoto ON" : "🛰 Ortofoto OFF"}
          </button>
        )}

        {/* Badge total árboles */}
        {(trees?.length || 0) > 0 && (
          <div style={{
            background: "white", border: "1.5px solid #a7f3d0", borderRadius: 20,
            padding: "6px 14px", display: "flex", alignItems: "center", gap: 8,
            boxShadow: "0 2px 8px rgba(16,185,129,0.15)",
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>
              {trees!.length} árboles detectados
            </span>
          </div>
        )}
      </div>

      {/* ── Mapa ── */}
      <div ref={mapRef} style={{ width: "100%", flex: 1 }} />

      {/* ── Sin análisis ── */}
      {!analysisId && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", background: "rgba(248,250,252,0.92)",
          flexDirection: "column", gap: 12, pointerEvents: "none",
        }}>
          <div style={{ fontSize: 56 }}>🛸</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>ForestAI · Mapa</h2>
          <p style={{ fontSize: 14, color: "#64748b", textAlign: "center", maxWidth: 260 }}>
            Seleccioná una ortofoto en el menú de arriba para ver los árboles detectados
          </p>
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && analysisId && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", background: "rgba(248,250,252,0.8)",
          flexDirection: "column", gap: 10,
        }}>
          <div style={{ width: 36, height: 36, border: "3px solid #10b981",
            borderTopColor: "transparent", borderRadius: "50%",
            animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Cargando...</p>
        </div>
      )}

      {/* ── Leyenda especies ── */}
      {Object.keys(speciesCounts).length > 0 && (
        <div style={{
          position: "absolute", bottom: 40, left: 16, borderRadius: 14,
          background: "rgba(255,255,255,0.95)", border: "1px solid #e2e8f0",
          backdropFilter: "blur(8px)", padding: "12px 14px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Especies</p>
          {Object.entries(speciesCounts).map(([sp, count]) => (
            <div key={sp} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%",
                background: getColor(sp), flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: "#374151", textTransform: "capitalize", flex: 1 }}>{sp}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: getColor(sp) }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Panel árbol seleccionado ── */}
      {selectedTree && (
        <div style={{
          position: "absolute", top: 70, right: 60, background: "white",
          borderRadius: 16, padding: 16, width: 220,
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)", border: "1px solid #e2e8f0",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%",
                background: getColor(selectedTree.species), flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1e293b",
                textTransform: "capitalize" }}>{selectedTree.species}</span>
            </div>
            <button onClick={() => setSelectedTree(null)} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 18, color: "#94a3b8", lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { icon: "📏", label: "Altura",  value: `${selectedTree.height_m?.toFixed(1) ?? "—"} m` },
              { icon: "⬤",  label: "Copa",    value: `${selectedTree.crown_area_m2?.toFixed(1) ?? "—"} m²` },
              { icon: "🌱", label: "Edad",    value: `${selectedTree.age_years?.toFixed(0) ?? "—"} años` },
              { icon: "⚖️", label: "Biomasa", value: `${((selectedTree.biomass_kg || 0) / 1000).toFixed(2)} ton` },
            ].map(m => (
              <div key={m.label} style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 10px" }}>
                <p style={{ fontSize: 10, color: "#94a3b8", marginBottom: 2 }}>{m.icon} {m.label}</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
