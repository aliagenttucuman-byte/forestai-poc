import { useQuery } from "@tanstack/react-query";
import { forestApi, type Analysis } from "../api/client";

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const statusConfig = {
  pending:    { label: "Pendiente",   dot: "bg-yellow-400 forest-pulse", text: "text-yellow-400" },
  processing: { label: "Procesando",  dot: "bg-blue-400 forest-pulse",   text: "text-blue-400"   },
  completed:  { label: "Completado",  dot: "bg-green-400",               text: "text-green-400"  },
  failed:     { label: "Error",       dot: "bg-red-400",                 text: "text-red-400"    },
};

export default function SidePanel({ selectedId, onSelect }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: forestApi.listAnalyses,
    refetchInterval: 4000,
  });

  const analyses: Analysis[] = data?.items || [];

  return (
    <aside className="w-72 flex flex-col overflow-hidden" style={{ background: "#0f1710", borderRight: "1px solid #1e2d22" }}>
      {/* Header sidebar */}
      <div className="px-4 py-4" style={{ borderBottom: "1px solid #1e2d22" }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4ade80" }}>
          Análisis
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
          {analyses.length} ortofoto{analyses.length !== 1 ? "s" : ""} cargada{analyses.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="px-4 py-8 text-center">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs" style={{ color: "#6b7280" }}>Cargando...</p>
          </div>
        ) : analyses.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-4xl mb-3">🌲</div>
            <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>Sin análisis</p>
            <p className="text-xs mt-1" style={{ color: "#4b5563" }}>Subí una ortofoto para comenzar</p>
          </div>
        ) : (
          analyses.map((a) => {
            const st = statusConfig[a.status as keyof typeof statusConfig] || statusConfig.pending;
            const isSelected = a.analysis_id === selectedId;
            return (
              <button
                key={a.analysis_id}
                onClick={() => onSelect(a.analysis_id)}
                className="w-full text-left px-4 py-3 card-hover transition-all"
                style={{
                  background: isSelected ? "#1e2d22" : "transparent",
                  borderLeft: isSelected ? "3px solid #4ade80" : "3px solid transparent",
                }}
              >
                {/* Nombre */}
                <p className="text-sm font-medium truncate" style={{ color: isSelected ? "#4ade80" : "#e2e8f0" }}>
                  {a.name || a.filename}
                </p>
                {/* Status row */}
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                  <span className={`text-xs ${st.text}`}>{st.label}</span>
                  {a.status === "completed" && a.tree_count !== undefined && (
                    <span className="ml-auto text-xs font-semibold" style={{ color: "#4ade80" }}>
                      {a.tree_count} árboles
                    </span>
                  )}
                </div>
                {/* Filename */}
                <p className="text-xs mt-0.5 truncate" style={{ color: "#4b5563" }}>{a.filename}</p>
              </button>
            );
          })
        )}
      </div>

      {/* Stats footer */}
      {analyses.filter(a => a.status === "completed").length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: "1px solid #1e2d22" }}>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg p-2" style={{ background: "#162018" }}>
              <p className="text-xs" style={{ color: "#6b7280" }}>Completados</p>
              <p className="text-lg font-bold" style={{ color: "#4ade80" }}>
                {analyses.filter(a => a.status === "completed").length}
              </p>
            </div>
            <div className="rounded-lg p-2" style={{ background: "#162018" }}>
              <p className="text-xs" style={{ color: "#6b7280" }}>Total árboles</p>
              <p className="text-lg font-bold" style={{ color: "#4ade80" }}>
                {analyses.filter(a => a.status === "completed").reduce((s, a) => s + (a.tree_count || 0), 0)}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
