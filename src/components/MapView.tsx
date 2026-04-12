import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { CITY_CENTER, CITY_ZOOM, MAP_STYLE, SEVERITY } from "../services/constants";
import type { GarbageReport, WardFeatureCollection } from "../types/domain";

interface MapViewProps {
  reports: GarbageReport[];
  wardBoundaries: WardFeatureCollection;
  onSelectReport: (report: GarbageReport) => void;
  onSelectWard: (wardNumber: number) => void;
}

export function MapView({ reports, wardBoundaries, onSelectReport, onSelectWard }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [CITY_CENTER.longitude, CITY_CENTER.latitude],
      zoom: CITY_ZOOM,
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");

    map.on("load", () => {
      map.addSource("wards", { type: "geojson", data: wardBoundaries });
      map.addLayer({
        id: "wards-fill",
        type: "fill",
        source: "wards",
        paint: {
          "fill-color": "#dc2626",
          "fill-opacity": 0.08
        }
      });
      map.addLayer({
        id: "wards-line",
        type: "line",
        source: "wards",
        paint: {
          "line-color": "#dc2626",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 12, 2.2, 14, 3]
        }
      });
      map.on("click", "wards-fill", (event) => {
        const wardNumber = Number(event.features?.[0]?.properties?.ward_number);
        if (wardNumber) onSelectWard(wardNumber);
      });
      map.on("mouseenter", "wards-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "wards-fill", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [onSelectWard, wardBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = reports
      .filter((report) => report.status !== "resolved")
      .map((report) => {
        const markerEl = document.createElement("button");
        const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
        markerEl.className = "garbage-marker";
        markerEl.type = "button";
        markerEl.style.setProperty("--marker-color", severity.color);
        markerEl.style.width = `${Math.max(18, severity.size + 12)}px`;
        markerEl.style.height = `${Math.max(18, severity.size + 12)}px`;
        markerEl.title = report.address;
        markerEl.setAttribute("aria-label", `Open report at ${report.address}`);
        markerEl.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectReport(report);
        });
        return new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([Number(report.longitude), Number(report.latitude)])
          .addTo(map);
      });
  }, [reports, onSelectReport]);

  return (
    <div className="map-shell" aria-label="Amma Odisha Bhubaneswar garbage map">
      <div className="map-canvas" ref={containerRef} />
    </div>
  );
}
