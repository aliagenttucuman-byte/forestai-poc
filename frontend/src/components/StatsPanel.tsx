import { useQuery } from "@tanstack/react-query";
import { forestApi, type Summary } from "../api/client";

interface Props {
  analysisId: string | null;
  onExport: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function StatsPanel({ analysisId }: Props) {
  const { data: summary, isLoading } = useQuery({
    queryKey: ["summary", analysisId],
    queryFn: () => forestApi.getSummary(analysisId!),
    enabled: !!analysisId,
  });

  if (!analysisId) return null;

  if (isLoading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 0", gap: 8 }}>
      <div style={{ width: 16, height: 16, border: "2px solid #10b981", borderTopColor: "transparent",
        borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: 12, color: "#94a3b8" }}>Cargando métricas...</span>
    </div>
  );

  if (!summary) return null;

  const metrics = [
    { label: "Árboles",  value: summary.total_trees,                    unit: "",      icon: "🌲" },
    { label: "Biomasa",  value: summary.total_biomass_tons?.toFixed(2), unit: "ton",   icon: "⚖️" },
    { label: "Altura",   value: summary.average_height_m?.toFixed(1),   unit: "m",     icon: "📏" },
    { label: "Edad",     value: summary.average_age_years?.toFixed(0),  unit: "años",  icon: "🌱" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Métricas grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ borderRadius: 12, padding: "10px 12px", background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>{m.icon}</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{m.label}</span>
            </div>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>
              {m.value ?? "—"}
              <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 4 }}>{m.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Distribución de especies */}
      {summary.species_distribution?.length > 0 && (
        <div style={{ borderRadius: 12, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Por especie
          </p>
          {summary.species_distribution.map((sp: { species: string; count: number; percentage: number; total_biomass_kg: number }) => (
            <div key={sp.species} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: "#374151", textTransform: "capitalize" }}>{sp.species}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#059669" }}>{sp.percentage?.toFixed(0)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${sp.percentage}%`,
                  background: "linear-gradient(90deg, #10b981, #34d399)" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Export links */}
      <div style={{ display: "flex", gap: 8 }}>
        <a
          href={`${API_BASE}/api/analyses/${analysisId}/geojson`}
          target="_blank" rel="noreferrer"
          style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid #e2e8f0",
            background: "white", color: "#475569", fontSize: 12, fontWeight: 600,
            textAlign: "center", textDecoration: "none", transition: "background 0.15s" }}
        >
          ↓ GeoJSON
        </a>
        <a
          href={`${API_BASE}/api/analyses/${analysisId}/csv`}
          target="_blank" rel="noreferrer"
          style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid #e2e8f0",
            background: "white", color: "#475569", fontSize: 12, fontWeight: 600,
            textAlign: "center", textDecoration: "none", transition: "background 0.15s" }}
        >
          ↓ CSV
        </a>
      </div>
    </div>
  );
}
