import { create } from "zustand";

interface ForestStore {
  selectedAnalysisId: string | null;
  selectedTreeId: string | null;
  mapCenter: [number, number];
  mapZoom: number;
  setSelectedAnalysis: (id: string | null) => void;
  setSelectedTree: (id: string | null) => void;
  setMapView: (center: [number, number], zoom: number) => void;
}

export const useForestStore = create<ForestStore>((set) => ({
  selectedAnalysisId: null,
  selectedTreeId: null,
  mapCenter: [-65, -35], // Argentina
  mapZoom: 4,
  setSelectedAnalysis: (id) => set({ selectedAnalysisId: id, selectedTreeId: null }),
  setSelectedTree: (id) => set({ selectedTreeId: id }),
  setMapView: (center, zoom) => set({ mapCenter: center, mapZoom: zoom }),
}));
