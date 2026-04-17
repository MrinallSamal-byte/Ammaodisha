import type maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITY_CENTER, CITY_ZOOM, MAP_STYLE, SEVERITY } from "../services/constants";
import { createMarkerPlacements } from "../services/map-markers";
import type { FeatureCollection, Point } from "geojson";
import type { GarbageReport, WardFeatureCollection } from "../types/domain";

interface MapViewProps {
  reports: GarbageReport[];
  wardBoundaries: WardFeatureCollection;
  onSelectReport: (report: GarbageReport) => void;
  onSelectWard: (wardNumber: number) => void;
  focusWardNumber: number | null;
  focusRequestId: number;
}

interface ReportPointProperties {
  address: string;
  isFresh: boolean;
  reportId: string;
  severityColor: string;
  severitySize: number;
  wardNumber: number;
}

type ReportPointCollection = FeatureCollection<Point, ReportPointProperties>;

const REPORT_SOURCE_ID = "report-points";
const CLUSTER_LAYER_ID = "report-clusters";
const CLUSTER_COUNT_LAYER_ID = "report-cluster-count";
const FRESH_REPORT_LAYER_ID = "report-fresh-pulse";
const REPORT_LAYER_ID = "report-points-unclustered";
const CLUSTER_HINT_KEY = "nk_cluster_hint_seen";
const FRESH_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;

function shouldShowClusterHint() {
  try {
    return localStorage.getItem("nk_intro_seen") !== "1" && localStorage.getItem(CLUSTER_HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

function markClusterHintSeen() {
  try {
    localStorage.setItem(CLUSTER_HINT_KEY, "1");
  } catch {
    // Ignore storage write failures.
  }
}

function createReportPointData(reports: GarbageReport[], wardBoundaries: WardFeatureCollection): ReportPointCollection {
  return {
    type: "FeatureCollection",
    features: createMarkerPlacements(reports, wardBoundaries).map(({ report, latitude, longitude }) => {
      const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        properties: {
          address: report.address,
          isFresh: Date.now() - new Date(report.created_at).getTime() < FRESH_REPORT_WINDOW_MS,
          reportId: report.id,
          severityColor: severity.color,
          severitySize: Math.max(8, severity.size),
          wardNumber: Number(report.ward_number)
        }
      };
    })
  };
}

export function MapView({ reports, wardBoundaries, onSelectReport, onSelectWard, focusWardNumber, focusRequestId }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof maplibregl | null>(null);
  const onSelectReportRef = useRef(onSelectReport);
  const onSelectWardRef = useRef(onSelectWard);
  const reportsByIdRef = useRef(new Map<string, GarbageReport>());
  const reportPointDataRef = useRef<ReportPointCollection>({ type: "FeatureCollection", features: [] });
  const [mapReady, setMapReady] = useState(false);
  const [showClusterHint, setShowClusterHint] = useState(shouldShowClusterHint);
  const reportPointData = useMemo(() => createReportPointData(reports, wardBoundaries), [reports, wardBoundaries]);

  useEffect(() => {
    onSelectReportRef.current = onSelectReport;
    onSelectWardRef.current = onSelectWard;
  }, [onSelectReport, onSelectWard]);

  useEffect(() => {
    reportPointDataRef.current = reportPointData;
  }, [reportPointData]);

  useEffect(() => {
    reportsByIdRef.current = new Map(reports.map((report) => [report.id, report]));
  }, [reports]);

  useEffect(() => {
    if (!showClusterHint) return;
    const timer = window.setTimeout(() => {
      setShowClusterHint(false);
      markClusterHintSeen();
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [showClusterHint]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    let map: MapLibreMap | null = null;

    void import("maplibre-gl").then(({ default: maplibre }) => {
      if (cancelled || !containerRef.current) return;

      maplibreRef.current = maplibre;
      map = new maplibre.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [CITY_CENTER.longitude, CITY_CENTER.latitude],
        zoom: CITY_ZOOM,
        attributionControl: false
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        map.addSource("wards", { type: "geojson", data: wardBoundaries });
        map.addSource(REPORT_SOURCE_ID, {
          type: "geojson",
          data: reportPointDataRef.current,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 48
        });
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
        map.addLayer({
          id: CLUSTER_LAYER_ID,
          type: "circle",
          source: REPORT_SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step",
              ["get", "point_count"],
              "#ef4444",
              8,
              "#dc2626",
              20,
              "#b9141b"
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              19,
              8,
              24,
              20,
              30
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-opacity": 0.94
          }
        });
        map.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: "symbol",
          source: REPORT_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12
          },
          paint: {
            "text-color": "#ffffff"
          }
        });
        map.addLayer({
          id: REPORT_LAYER_ID,
          type: "circle",
          source: REPORT_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["get", "severityColor"],
            "circle-radius": ["+", ["get", "severitySize"], 6],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-opacity": 0.95
          }
        });
        map.addLayer(
          {
            id: FRESH_REPORT_LAYER_ID,
            type: "circle",
            source: REPORT_SOURCE_ID,
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "isFresh"], true]],
            paint: {
              "circle-color": ["get", "severityColor"],
              "circle-radius": ["+", ["get", "severitySize"], 20],
              "circle-opacity": 0.18,
              "circle-stroke-color": ["get", "severityColor"],
              "circle-stroke-opacity": 0.28,
              "circle-stroke-width": 2
            }
          },
          REPORT_LAYER_ID
        );
        map.on("click", CLUSTER_LAYER_ID, (event) => {
          const feature = map?.queryRenderedFeatures(event.point, { layers: [CLUSTER_LAYER_ID] })[0];
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!map || !Number.isFinite(clusterId) || feature?.geometry.type !== "Point") return;
          const source = map.getSource(REPORT_SOURCE_ID) as GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
            if (!map || feature.geometry.type !== "Point") return;
            map.easeTo({
              center: feature.geometry.coordinates as [number, number],
              zoom: Math.min(zoom, 16)
            });
          });
        });
        map.on("click", REPORT_LAYER_ID, (event) => {
          const reportId = String(event.features?.[0]?.properties?.reportId ?? "");
          const report = reportsByIdRef.current.get(reportId);
          if (report) onSelectReportRef.current(report);
        });
        map.on("click", "wards-fill", (event) => {
          const wardNumber = Number(event.features?.[0]?.properties?.ward_number);
          if (wardNumber) onSelectWardRef.current(wardNumber);
        });
        [CLUSTER_LAYER_ID, REPORT_LAYER_ID, "wards-fill"].forEach((layerId) => {
          map?.on("mouseenter", layerId, () => {
            map?.getCanvas().style.setProperty("cursor", "pointer");
          });
          map?.on("mouseleave", layerId, () => {
            map?.getCanvas().style.setProperty("cursor", "");
          });
        });
        setMapReady(true);
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
      setMapReady(false);
      mapRef.current = null;
      maplibreRef.current = null;
    };
  }, [wardBoundaries]);

  useEffect(() => {
    const source = mapRef.current?.getSource(REPORT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(reportPointData);
  }, [mapReady, reportPointData]);

  useEffect(() => {
    if (!mapReady) return;
    const timer = window.setInterval(() => {
      const map = mapRef.current;
      if (!map?.getLayer(FRESH_REPORT_LAYER_ID)) return;
      const progress = (Date.now() % 1700) / 1700;
      map.setPaintProperty(FRESH_REPORT_LAYER_ID, "circle-radius", ["+", ["get", "severitySize"], 14 + progress * 18]);
      map.setPaintProperty(FRESH_REPORT_LAYER_ID, "circle-opacity", 0.24 * (1 - progress));
      map.setPaintProperty(FRESH_REPORT_LAYER_ID, "circle-stroke-opacity", 0.34 * (1 - progress));
    }, 120);
    return () => window.clearInterval(timer);
  }, [mapReady]);

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
          ? { top: 28, right: 20, bottom: 190, left: 20 }
          : { top: 36, right: 56, bottom: 220, left: 56 }
      }
    );
  }, [focusWardNumber, focusRequestId, wardBoundaries]);

  return (
    <div className="map-shell" aria-label="Amma Odisha Bhubaneswar garbage map">
      <div className="map-canvas" ref={containerRef} />
      {showClusterHint && (
        <div className="map-cluster-hint" aria-label="Map cluster guidance">
          Grouped reports. Zoom in to see exact spots.
        </div>
      )}
    </div>
  );
}
