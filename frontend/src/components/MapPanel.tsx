import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import { forestApi } from "../api/client";
import { useForestStore } from "../store/useForestStore";

export default function MapPanel() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { selectedAnalysisId, mapCenter, mapZoom, setSelectedTree, setMapView } = useForestStore();

  const { data: geojson } = useQuery({
    queryKey: ["geojson", selectedAnalysisId],
    queryFn: () => selectedAnalysisId ? forestApi.getGeoJSON(selectedAnalysisId) : null,
    enabled: !!selectedAnalysisId,
  });

  // Inicializar mapa
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: mapCenter,
      zoom: mapZoom,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Cargar GeoJSON cuando cambia el análisis
  useEffect(() => {
    if (!map.current || !geojson) return;

    const m = map.current;

    const addLayers = () => {
      // Limpiar capas previas
      ["tree-fill", "tree-outline", "tree-labels"].forEach(id => {
        if (m.getLayer(id)) m.removeLayer(id);
      });
      if (m.getSource("trees")) m.removeSource("trees");

      // Agregar nueva fuente y capas
      m.addSource("trees", { type: "geojson", data: geojson });

      // Polígonos de copa
      m.addLayer({
        id: "tree-fill",
        type: "fill",
        source: "trees",
        paint: {
          "fill-color": [
            "match", ["get", "species"],
            "eucalipto", "#22c55e",
            "pino", "#16a34a",
            "quebracho", "#a16207",
            "algarrobo", "#65a30d",
            "araucaria", "#166534",
            "#6b7280",
          ],
          "fill-opacity": 0.7,
        },
      });

      // Borde de copa
      m.addLayer({
        id: "tree-outline",
        type: "line",
        source: "trees",
        paint: { "line-color": "#fff", "line-width": 1, "line-opacity": 0.5 },
      });

      // Click en árbol
      m.on("click", "tree-fill", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const tree_id = feat.properties?.tree_id;
        setSelectedTree(tree_id);

        const biomass = feat.properties?.biomass_kg?.toFixed(1) ?? "?";
        const species = feat.properties?.species ?? "desconocida";
        const height = feat.properties?.height_m?.toFixed(1) ?? "?";

        new maplibregl.Popup({ closeButton: true, maxWidth: "220px" })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:monospace; font-size:12px; line-height:1.6;">
              <strong style="color:#4ade80">🌳 ${tree_id}</strong><br/>
              Especie: <b>${species}</b><br/>
              Altura: ${height} m<br/>
              Biomasa: ${biomass} kg
            </div>
          `)
          .addTo(m);
      });

      m.on("mouseenter", "tree-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "tree-fill", () => { m.getCanvas().style.cursor = ""; });

      // Centrar en los datos
      if (geojson.features?.length > 0) {
        const coords = geojson.features
          .filter((f: any) => f.geometry?.type === "Point")
          .map((f: any) => f.geometry.coordinates as [number, number]);

        if (coords.length > 0) {
          const lons = coords.map((c: [number, number]) => c[0]);
          const lats = coords.map((c: [number, number]) => c[1]);
          const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
          const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
          m.flyTo({ center: [centerLon, centerLat], zoom: 16 });
          setMapView([centerLon, centerLat], 16);
        }
      }
    };

    if (m.isStyleLoaded()) {
      addLayers();
    } else {
      m.once("load", addLayers);
    }
  }, [geojson]);

  return (
    <div ref={mapContainer} className="w-full h-full" />
  );
}
