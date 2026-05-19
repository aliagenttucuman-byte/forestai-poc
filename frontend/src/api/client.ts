import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
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

export interface AnalysisStatus {
  analysis_id: string;
  status: string;
  progress: number;
  current_step?: string;
  created_at: string;
  completed_at?: string;
  tree_count?: number;
  error?: string;
}

export interface InventorySummary {
  analysis_id: string;
  total_trees: number;
  total_biomass_tons: number;
  total_crown_area_ha: number;
  average_height_m: number;
  average_age_years: number;
  species_distribution: { species: string; count: number; percentage: number; total_biomass_kg: number }[];
  analyzed_at?: string;
  source_filename: string;
}

export const forestApi = {
  listAnalyses: () => api.get<{ items: Analysis[]; total: number }>("/api/analyses").then(r => r.data),
  getStatus: (id: string) => api.get<AnalysisStatus>(`/api/analyses/${id}`).then(r => r.data),
  getSummary: (id: string) => api.get<InventorySummary>(`/api/analyses/${id}/summary`).then(r => r.data),
  getGeoJSON: (id: string) => api.get(`/api/analyses/${id}/geojson`).then(r => r.data),
  uploadOrtophoto: (file: File, name?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    return api.post<{ analysis_id: string; status: string }>("/api/analyses", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  exportCSV: (id: string) => `${api.defaults.baseURL}/api/analyses/${id}/export?format=csv`,
  exportGeoJSON: (id: string) => `${api.defaults.baseURL}/api/analyses/${id}/export?format=geojson`,
};
