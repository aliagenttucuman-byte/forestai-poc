import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { forestApi, type Analysis } from "../api/client";
import { useForestStore } from "../store/useForestStore";
import MapPanel from "../components/MapPanel";
import UploadPanel from "../components/UploadPanel";
import SidePanel from "../components/SidePanel";

export default function HomePage() {
  const qc = useQueryClient();
  const { selectedAnalysisId, setSelectedAnalysis } = useForestStore();

  const { data, isLoading } = useQuery({
    queryKey: ["analyses"],
    queryFn: forestApi.listAnalyses,
    refetchInterval: 5000, // polling cada 5s
  });

  const analyses = data?.items || [];

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌲</span>
          <h1 className="text-xl font-bold text-green-400">ForestAI</h1>
          <span className="text-sm text-gray-400">Inventario forestal con drones</span>
        </div>
        <UploadPanel onUploadSuccess={(id) => { qc.invalidateQueries({ queryKey: ["analyses"] }); setSelectedAnalysis(id); }} />
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: lista de análisis */}
        <aside className="w-72 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-300">Análisis recientes</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading && <p className="p-4 text-sm text-gray-500">Cargando...</p>}
            {analyses.map((a) => (
              <AnalysisRow
                key={a.analysis_id}
                analysis={a}
                selected={a.analysis_id === selectedAnalysisId}
                onClick={() => setSelectedAnalysis(a.analysis_id)}
              />
            ))}
            {!isLoading && analyses.length === 0 && (
              <p className="p-4 text-sm text-gray-500">Aún no hay análisis. Subí tu primera ortofoto.</p>
            )}
          </div>
        </aside>

        {/* Mapa central */}
        <main className="flex-1 relative">
          <MapPanel />
        </main>

        {/* Panel derecho: resumen e info */}
        {selectedAnalysisId && (
          <aside className="w-80 bg-gray-900 border-l border-gray-800 overflow-y-auto">
            <SidePanel analysisId={selectedAnalysisId} />
          </aside>
        )}
      </div>
    </div>
  );
}

function AnalysisRow({ analysis, selected, onClick }: { analysis: Analysis; selected: boolean; onClick: () => void }) {
  const statusColor: Record<string, string> = {
    pending: "text-yellow-400",
    processing: "text-blue-400",
    completed: "text-green-400",
    failed: "text-red-400",
  };
  const statusIcon: Record<string, string> = {
    pending: "⏳", processing: "⚙️", completed: "✅", failed: "❌",
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800 transition-colors ${selected ? "bg-gray-800 border-l-2 border-l-green-400" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-gray-500 truncate max-w-[160px]">
          {analysis.name || analysis.filename}
        </span>
        <span className="text-sm">{statusIcon[analysis.status]}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`text-xs ${statusColor[analysis.status]}`}>{analysis.status}</span>
        {analysis.tree_count && (
          <span className="text-xs text-gray-400">{analysis.tree_count} árboles</span>
        )}
      </div>
    </button>
  );
}
