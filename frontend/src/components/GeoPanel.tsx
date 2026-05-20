import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

// ── Tipos ────────────────────────────────────────────────────────────────────

interface BBox {
  min_lon: number; min_lat: number;
  max_lon: number; max_lat: number;
}

interface CategoriaOTBN {
  categoria: string;
  nombre: string;
  descripcion: string;
  color: string;
  provincia: string;
  clase: string;
  area_ha: number | null;
}

interface BosquesResult {
  lat: number; lon: number; radius_km: number;
  tiene_bosque_nativo: boolean;
  area_bosque_features: number;
  categorias_otbn: CategoriaOTBN[];
  deforestacion_registrada: boolean;
  raw: Record<string, { available: boolean; count: number }>;
  fuente: string;
  mas_info: string;
  error?: string;
}

interface SentinelResult {
  available: boolean;
  date: string | null;
  cloud_coverage: number | null;
  source: string;
  product_name?: string;
  message?: string;
  error?: string;
  bbox?: BBox;
  ndvi_mean?: number | null;
  ndvi_min?: number | null;
  ndvi_max?: number | null;
  ndvi_error?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "white", borderRadius: 14, border: "1px solid #e2e8f0",
      padding: "20px 22px", marginBottom: 16, ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
      letterSpacing: "0.08em", marginBottom: 10 }}>
      {children}
    </p>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "32px 0" }}>
      <div style={{ width: 20, height: 20, border: "2px solid #10b981", borderTopColor: "transparent",
        borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: 13, color: "#94a3b8" }}>Consultando servicios externos...</span>
    </div>
  );
}

// ── Solapa Bosques Nativos ────────────────────────────────────────────────────

function BosquesTab({ lat, lon, radius }: { lat: number; lon: number; radius: number }) {
  const { data, isLoading, error } = useQuery<BosquesResult>({
    queryKey: ["bosques", lat, lon, radius],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo/bosques?lat=${lat}&lon=${lon}&radius_km=${radius}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <Spinner />;
  if (error) return (
    <Card><p style={{ color: "#ef4444", fontSize: 13 }}>Error: {String(error)}</p></Card>
  );
  if (!data) return null;

  // Deduplica categorias por categoria+provincia
  const uniq = data.categorias_otbn.filter((c, i, arr) =>
    arr.findIndex(x => x.categoria === c.categoria && x.provincia === c.provincia) === i
  );

  return (
    <div>
      {/* Estado general */}
      <Card>
        <Label>Cobertura Bosque Nativo</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span style={{ fontSize: 36 }}>{data.tiene_bosque_nativo ? "🌳" : "🌾"}</span>
          <div>
            <p style={{ fontSize: 18, fontWeight: 700, color: data.tiene_bosque_nativo ? "#059669" : "#64748b" }}>
              {data.tiene_bosque_nativo ? "Bosque Nativo Presente" : "Sin Bosque Nativo Detectado"}
            </p>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Radio {radius} km · {lat.toFixed(4)}, {lon.toFixed(4)}
            </p>
          </div>
        </div>

        {data.deforestacion_registrada && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10,
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <span style={{ fontSize: 13, color: "#9a3412", fontWeight: 600 }}>
              Se registraron eventos de deforestación en esta zona
            </span>
          </div>
        )}
      </Card>

      {/* Categorías OTBN */}
      {uniq.length > 0 && (
        <Card>
          <Label>Ordenamiento Territorial de Bosques Nativos (OTBN)</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {uniq.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 14, padding: "12px 14px",
                borderRadius: 10, background: `${c.color}18`, border: `1.5px solid ${c.color}40`,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, background: c.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontWeight: 800, fontSize: 14, color: "white",
                }}>
                  {c.categoria}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                    Categoría {c.categoria} — {c.nombre}
                  </p>
                  <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{c.descripcion}</p>
                  <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                    {c.provincia} · {c.clase}
                    {c.area_ha != null ? ` · ${c.area_ha.toFixed(1)} ha` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Fuente */}
      <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
        Fuente: {data.fuente} ·{" "}
        <a href={data.mas_info} target="_blank" rel="noopener noreferrer"
          style={{ color: "#10b981" }}>Más información</a>
      </p>
    </div>
  );
}

// ── Solapa Sentinel-2 ─────────────────────────────────────────────────────────

function SentinelTab({ lat, lon, radius }: { lat: number; lon: number; radius: number }) {
  const [previewLayer, setPreviewLayer] = React.useState<"TRUE_COLOR" | "NDVI">("TRUE_COLOR");
  const [showPreview, setShowPreview] = React.useState(true);

  const { data, isLoading, error } = useQuery<SentinelResult>({
    queryKey: ["sentinel", lat, lon, radius],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo/sentinel?lat=${lat}&lon=${lon}&radius_km=${radius}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });

  const previewUrl = `${API_BASE}/api/geo/sentinel/preview?lat=${lat}&lon=${lon}&radius_km=${radius}&layer=${previewLayer}`;

  if (isLoading) return <Spinner />;
  if (error) return (
    <Card><p style={{ color: "#ef4444", fontSize: 13 }}>Error: {String(error)}</p></Card>
  );
  if (!data) return null;

  return (
    <div>
      <Card>
        <Label>Imagen Sentinel-2 más reciente</Label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <span style={{ fontSize: 40 }}>🛰️</span>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: data.available ? "#1e293b" : "#94a3b8" }}>
              {data.available ? `Imagen disponible — ${data.date}` : "Sin imagen disponible"}
            </p>
            {data.cloud_coverage != null && (
              <p style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                ☁️ {data.cloud_coverage}% nubosidad · {data.source}
              </p>
            )}
          </div>
        </div>

        {data.message && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10,
            padding: "10px 14px", fontSize: 13, color: "#166534" }}>
            {data.message}
          </div>
        )}
      </Card>

      {/* Preview de imagen satelital */}
      {data.available && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Label>Vista satelital</Label>
            <div style={{ display: "flex", gap: 6 }}>
              {(["TRUE_COLOR", "NDVI"] as const).map(l => (
                <button key={l} onClick={() => setPreviewLayer(l)}
                  style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: previewLayer === l ? "#10b981" : "#e2e8f0",
                    color: previewLayer === l ? "#fff" : "#475569",
                    fontWeight: previewLayer === l ? 700 : 400,
                  }}>
                  {l === "TRUE_COLOR" ? "Color Real" : "NDVI"}
                </button>
              ))}
              <button onClick={() => setShowPreview(p => !p)}
                style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "none",
                  cursor: "pointer", background: "#f1f5f9", color: "#64748b" }}>
                {showPreview ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          {showPreview && (
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden",
              background: "#e2e8f0", minHeight: 200 }}>
              <img
                key={previewUrl}
                src={previewUrl}
                alt={`Sentinel-2 ${previewLayer}`}
                style={{ width: "100%", display: "block", borderRadius: 10 }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div style={{ position: "absolute", bottom: 8, left: 8, background: "rgba(0,0,0,0.55)",
                color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 4 }}>
                Sentinel-2 L2A · {data.date} · {previewLayer === "TRUE_COLOR" ? "Color Real" : "NDVI"}
              </div>
            </div>
          )}
        </Card>
      )}

      {data.available && (
        <Card>
          <Label>Producto</Label>
          <p style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace", wordBreak: "break-all" }}>
            {data.product_name}
          </p>
        </Card>
      )}

      {data.ndvi_mean != null ? (
        <Card style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
          <Label>🌿 NDVI — Índice de Vegetación</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 8 }}>
            {[
              { label: "Medio", value: data.ndvi_mean },
              { label: "Mínimo", value: data.ndvi_min },
              { label: "Máximo", value: data.ndvi_max },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: "center", background: "#dcfce7",
                borderRadius: 8, padding: "10px 6px" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#15803d" }}>
                  {value?.toFixed(3)}
                </div>
                <div style={{ fontSize: 11, color: "#166534", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#166534", marginTop: 8 }}>
            Rango: -1 (agua/suelo) → 0 (sin vegetación) → 1 (vegetación densa)
          </p>
        </Card>
      ) : (
        <Card style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ fontSize: 18 }}>💡</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#92400e", marginBottom: 6 }}>
                NDVI no disponible para esta zona
              </p>
              <p style={{ fontSize: 12, color: "#78350f" }}>
                {data.ndvi_error || "No se encontraron imágenes con menos del 30% de nubes en los últimos 30 días."}
              </p>
            </div>
          </div>
        </Card>
      )}

      <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
        Fuente: ESA Copernicus Data Space · Sentinel-2 L2A
      </p>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────

const ARGENTINA_CENTER = { lat: -38.0, lon: -63.0 };

export default function GeoPanel() {
  const [lat, setLat] = useState(ARGENTINA_CENTER.lat);
  const [lon, setLon] = useState(ARGENTINA_CENTER.lon);
  const [radius, setRadius] = useState(10);
  const [inputLat, setInputLat] = useState(String(ARGENTINA_CENTER.lat));
  const [inputLon, setInputLon] = useState(String(ARGENTINA_CENTER.lon));
  const [activeTab, setActiveTab] = useState<"bosques" | "sentinel">("bosques");
  const [submitted, setSubmitted] = useState(false);

  const handleConsultar = () => {
    const parsedLat = parseFloat(inputLat);
    const parsedLon = parseFloat(inputLon);
    if (isNaN(parsedLat) || isNaN(parsedLon)) return;
    setLat(parsedLat);
    setLon(parsedLon);
    setSubmitted(true);
  };

  const tabs = [
    { key: "bosques", label: "🌳 Bosques Nativos", desc: "Ley 26.331 · OTBN" },
    { key: "sentinel", label: "🛰️ Sentinel-2", desc: "ESA Copernicus" },
  ] as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f8fafc" }}>

      {/* ── Buscador ── */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0", padding: "20px 28px" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
          letterSpacing: "0.08em", marginBottom: 14 }}>
          Consultar zona por coordenadas
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Latitud</p>
            <input
              type="number" step="0.0001" value={inputLat}
              onChange={e => setInputLat(e.target.value)}
              placeholder="-26.8"
              style={{ width: 130, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0",
                fontSize: 14, outline: "none" }}
            />
          </div>
          <div>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Longitud</p>
            <input
              type="number" step="0.0001" value={inputLon}
              onChange={e => setInputLon(e.target.value)}
              placeholder="-60.4"
              style={{ width: 130, padding: "8px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0",
                fontSize: 14, outline: "none" }}
            />
          </div>
          <div>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>
              Radio: {radius} km
            </p>
            <input
              type="range" min={1} max={100} value={radius}
              onChange={e => setRadius(Number(e.target.value))}
              style={{ width: 160, accentColor: "#10b981" }}
            />
          </div>
          <button
            onClick={handleConsultar}
            style={{ padding: "9px 22px", borderRadius: 10, background: "#10b981",
              color: "white", border: "none", cursor: "pointer", fontWeight: 700,
              fontSize: 14, whiteSpace: "nowrap" }}>
            Consultar
          </button>
        </div>

        {/* Quick access — zonas conocidas */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Acceso rápido:</span>
          {[
            { label: "Chaco Norte", lat: -26.8, lon: -60.4 },
            { label: "Misiones", lat: -26.9, lon: -54.6 },
            { label: "Salta", lat: -24.2, lon: -65.0 },
            { label: "Patagonia", lat: -41.0, lon: -71.0 },
          ].map(z => (
            <button key={z.label} onClick={() => {
              setInputLat(String(z.lat)); setInputLon(String(z.lon));
              setLat(z.lat); setLon(z.lon); setSubmitted(true);
            }} style={{ padding: "4px 12px", borderRadius: 20, border: "1px solid #e2e8f0",
              background: "white", cursor: "pointer", fontSize: 12, color: "#374151",
              fontWeight: 500 }}>
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ background: "white", borderBottom: "1px solid #e2e8f0",
        padding: "0 28px", display: "flex", gap: 0 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "12px 20px", border: "none", background: "none", cursor: "pointer",
            fontWeight: activeTab === t.key ? 700 : 500,
            color: activeTab === t.key ? "#059669" : "#64748b",
            borderBottom: activeTab === t.key ? "2px solid #10b981" : "2px solid transparent",
            fontSize: 14, transition: "all 0.15s",
          }}>
            {t.label}
            <span style={{ fontSize: 10, display: "block", color: "#94a3b8", fontWeight: 400 }}>
              {t.desc}
            </span>
          </button>
        ))}
      </div>

      {/* ── Contenido ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {!submitted ? (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🌍</div>
            <p style={{ fontSize: 16, fontWeight: 600, color: "#64748b" }}>
              Ingresá coordenadas y consultá los servicios
            </p>
            <p style={{ fontSize: 13, marginTop: 6 }}>
              O usá los accesos rápidos para zonas forestales conocidas
            </p>
          </div>
        ) : activeTab === "bosques" ? (
          <BosquesTab lat={lat} lon={lon} radius={radius} />
        ) : (
          <SentinelTab lat={lat} lon={lon} radius={radius} />
        )}
      </div>
    </div>
  );
}
