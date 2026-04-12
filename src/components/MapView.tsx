import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { CITY_CENTER, CITY_ZOOM, MAP_STYLE, SEVERITY } from "../services/constants";
import type { GarbageReport, WardFeatureCollection } from "../types/domain";

interface MapViewProps {
  reports: GarbageReport[];
  wardBoundaries: WardFeatureCollection;
  onSelectReport: (report: GarbageReport) => void;
  onSelectWard: (wardNumber: number) => void;
  focusWardNumber: number | null;
  focusRequestId: number;
}

export function MapView({ reports, wardBoundaries, onSelectReport, onSelectWard, focusWardNumber, focusRequestId }: MapViewProps) {
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
        const markerDotEl = document.createElement("span");
        const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
        const baseZIndex = String(Math.round(severity.size));
        markerEl.className = "garbage-marker";
        markerEl.type = "button";
        markerEl.style.setProperty("--marker-color", severity.color);
        markerEl.style.width = `${Math.max(18, severity.size + 12)}px`;
        markerEl.style.height = `${Math.max(18, severity.size + 12)}px`;
        markerEl.style.zIndex = baseZIndex;
        markerEl.title = report.address;
        markerEl.setAttribute("aria-label", `Open report at ${report.address}`);
        markerDotEl.className = "garbage-marker-dot";
        markerDotEl.setAttribute("aria-hidden", "true");
        markerEl.append(markerDotEl);

        markerEl.addEventListener("mouseenter", () => {
          markerEl.style.zIndex = "1000";
        });
        markerEl.addEventListener("mouseleave", () => {
          markerEl.style.zIndex = baseZIndex;
        });
        markerEl.addEventListener("focus", () => {
          markerEl.style.zIndex = "1000";
        });
        markerEl.addEventListener("blur", () => {
          markerEl.style.zIndex = baseZIndex;
        });

        markerEl.addEventListener("click", (event) => {
          event.stopPropagation();
          onSelectReport(report);
        });
        return new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([Number(report.longitude), Number(report.latitude)])
          .addTo(map);
      });
  }, [reports, onSelectReport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusWardNumber == null) return;

    const feature = wardBoundaries.features.find(
      (item) => Number(item.properties?.ward_number) === focusWardNumber
    );
    if (!feature) return;

    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }

    if (!Number.isFinite(minLng) || !Number.isFinite(maxLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      return;
    }

    const isMobile = window.innerWidth < 768;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat]
      ],
      {
        duration: 700,
        maxZoom: 14.5,
        padding: isMobile
          ? { top: 88, right: 20, bottom: 300, left: 20 }
          : { top: 88, right: 56, bottom: 320, left: 320 }
      }
    );
  }, [focusWardNumber, focusRequestId, wardBoundaries]);

  return (
    <div className="map-shell" aria-label="Amma Odisha Bhubaneswar garbage map">
      <div className="map-canvas" ref={containerRef} />
    </div>
  );
}
