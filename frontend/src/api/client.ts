import axios from "axios";

const BASE = import.meta.env.VITE_API_URL || "";

export const api = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

export interface Analysis {
  analysis_id: string;
  filename: string;
  name?: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  tree_count?: number;
  error?: string;
}

export interface TreeResult {
  tree_id: string;
  species: string;
  lat: number;
  lon: number;
  height_m: number;
  crown_area_m2: number;
  biomass_kg: number;
  age_years: number;
  confidence: string;
  // Clasificación VLM (opcional — puede ser null si no se procesó)
  vlm_species?: string | null;
  vlm_health?: string | null;
  vlm_confidence?: number | null;
  vlm_notes?: string | null;
}

export interface Summary {
  analysis_id: string;
  total_trees: number;
  total_biomass_tons: number;
  total_crown_area_ha: number;
  average_height_m: number;
  average_age_years: number;
  species_distribution: {
    species: string;
    count: number;
    percentage: number;
    total_biomass_kg: number;
  }[];
  analyzed_at?: string;
  source_filename: string;
}

export const forestApi = {
  listAnalyses: () =>
    api.get<{ items: Analysis[]; total: number }>("/api/analyses").then(r => r.data),

  createAnalysis: (form: FormData) =>
    api.post<{ analysis_id: string; status: string }>("/api/analyses", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data),

  getStatus: (id: string) =>
    api.get<Analysis>(`/api/analyses/${id}`).then(r => r.data),

  getSummary: (id: string) =>
    api.get<Summary>(`/api/analyses/${id}/summary`).then(r => r.data),

  getTrees: (id: string) =>
    api.get<TreeResult[]>(`/api/analyses/${id}/trees`).then(r => r.data),

  getGeoJSON: (id: string) =>
    api.get(`/api/analyses/${id}/geojson`).then(r => r.data),

  exportCSV: (id: string) =>
    `${BASE}/api/analyses/${id}/csv`,

  exportGeoJSON: (id: string) =>
    `${BASE}/api/analyses/${id}/geojson`,
};
