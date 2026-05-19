import { useQuery } from "@tanstack/react-query";
import { forestApi } from "../api/client";
import { useForestStore } from "../store/useForestStore";

interface Props { analysisId: string; }

export default function SidePanel({ analysisId }: Props) {
  const { selectedTreeId } = useForestStore();

  const { data: status } = useQuery({
    queryKey: ["status", analysisId],
    queryFn: () => forestApi.getStatus(analysisId),
    refetchInterval: (q) => (q.state.data?.status === "processing" || q.state.data?.status === "pending") ? 2000 : false,
  });

  const { data: summary } = useQuery({
    queryKey: ["summary", analysisId],
    queryFn: () => forestApi.getSummary(analysisId),
    enabled: status?.status === "completed",
  });

  const exportCSV = () => window.open(forestApi.exportCSV(analysisId), "_blank");
  const exportGeoJSON = () => window.open(forestApi.exportGeoJSON(analysisId), "_blank");

  return (
    <div className="p-4 space-y-4 text-sm">
      {/* Estado del análisis */}
      <div className="bg-gray-800 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-gray-200">Estado del análisis</h3>
        {status ? (
          <>
            <div className="flex items-center gap-2">
              <StatusBadge status={status.status} />
              {status.tree_count && (
                <span className="text-green-400 font-bold">{status.tree_count} árboles</span>
              )}
            </div>
            {(status.status === "processing" || status.status === "pending") && (
              <div className="space-y-1">
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${status.progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400">{status.current_step}</p>
              </div>
            )}
            {status.error && <p className="text-xs text-red-400">{status.error}</p>}
          </>
        ) : (
          <p className="text-gray-500">Cargando...</p>
        )}
      </div>

      {/* Resumen del inventario */}
      {summary && (
        <div className="bg-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-gray-200">Inventario</h3>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Árboles totales" value={summary.total_trees.toString()} />
            <Stat label="Biomasa total" value={`${summary.total_biomass_tons} t`} />
            <Stat label="Área copa" value={`${summary.total_crown_area_ha} ha`} />
            <Stat label="Altura media" value={`${summary.average_height_m} m`} />
            <Stat label="Edad media" value={`${summary.average_age_years} años`} />
          </div>

          {/* Distribución por especie */}
          <div className="space-y-2 pt-2 border-t border-gray-700">
            <p className="text-xs text-gray-400 font-medium">Por especie</p>
            {summary.species_distribution.map((sp) => (
              <div key={sp.species} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="capitalize text-gray-300">{sp.species}</span>
                  <span className="text-gray-400">{sp.count} ({sp.percentage}%)</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-green-500 h-1.5 rounded-full"
                    style={{ width: `${sp.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Exportar */}
          <div className="flex gap-2 pt-2 border-t border-gray-700">
            <button
              onClick={exportCSV}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs py-1.5 rounded-lg transition-colors"
            >
              📥 CSV
            </button>
            <button
              onClick={exportGeoJSON}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs py-1.5 rounded-lg transition-colors"
            >
              🗺️ GeoJSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900 rounded-lg p-2 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-900 text-yellow-300",
    processing: "bg-blue-900 text-blue-300",
    completed: "bg-green-900 text-green-300",
    failed: "bg-red-900 text-red-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || "bg-gray-700"}`}>
      {status}
    </span>
  );
}
