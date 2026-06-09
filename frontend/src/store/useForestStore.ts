import { create } from "zustand";

export interface DetectedTree {
  id: string;
  x: number;
  y: number;
  crown_diameter: number;
  health_status: string;
  species?: string;
  score?: number;
  vlm_health?: string | null;
  vlm_species?: string | null;
}

interface ForestStore {
  selectedAnalysisId: string | null;
  selectedTreeId: string | null;
  mapCenter: [number, number];
  mapZoom: number;
  // Detección activa → compartida con Vista 3D
  detectedTrees: DetectedTree[];
  imageWidth: number;
  imageHeight: number;
  setDetectedTrees: (trees: DetectedTree[], w: number, h: number) => void;
  clearDetectedTrees: () => void;
  setSelectedAnalysis: (id: string | null) => void;
  setSelectedTree: (id: string | null) => void;
  setMapView: (center: [number, number], zoom: number) => void;
}

export const useForestStore = create<ForestStore>((set) => ({
  selectedAnalysisId: null,
  selectedTreeId: null,
  mapCenter: [-65, -35], // Argentina
  mapZoom: 4,
  detectedTrees: [],
  imageWidth: 0,
  imageHeight: 0,
  setDetectedTrees: (trees, w, h) => set({ detectedTrees: trees, imageWidth: w, imageHeight: h }),
  clearDetectedTrees: () => set({ detectedTrees: [], imageWidth: 0, imageHeight: 0 }),
  setSelectedAnalysis: (id) => set({ selectedAnalysisId: id, selectedTreeId: null }),
  setSelectedTree: (id) => set({ selectedTreeId: id }),
  setMapView: (center, zoom) => set({ mapCenter: center, mapZoom: zoom }),
}));
