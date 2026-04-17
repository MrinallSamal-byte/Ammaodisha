import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITY_CENTER, CITY_MAX_BOUNDS, CITY_MIN_ZOOM, CITY_ZOOM, MAP_STYLE, SEVERITY } from "../services/constants";
import { createMarkerPlacements } from "../services/map-markers";
import { createCoverageData, getBounds, type BoundsTuple, type LngLatTuple } from "../services/map-coverage";
import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import type { CityBoundaryFeatureCollection, GarbageReport, WardFeatureCollection, WardFeatureProperties } from "../types/domain";

interface MapViewProps {
  reports: GarbageReport[];
  cityBoundary: CityBoundaryFeatureCollection;
  wardBoundaries: WardFeatureCollection;
  onSelectReport: (report: GarbageReport) => void;
  onSelectWard: (wardNumber: number) => void;
  focusWardNumber: number | null;
  focusRequestId: number;
}

interface ReportPointProperties {
  address: string;
  isFresh: boolean;
  isPriority: boolean;
  reportId: string;
  severity: string;
  severityColor: string;
  severitySize: number;
  status: string;
  wardNumber: number;
}

interface WardRenderProperties extends WardFeatureProperties {
  report_count: number;
  visible_report_count: number;
}

interface HoverWard {
  reportCount: number;
  wardName: string;
  wardNumber: number;
  x: number;
  y: number;
  zone?: string | null;
}

type ReportPointCollection = FeatureCollection<Point, ReportPointProperties>;
type WardRenderCollection = FeatureCollection<Polygon | MultiPolygon, WardRenderProperties>;

const REPORT_SOURCE_ID = "report-points";
const WARD_SOURCE_ID = "wards";
const MASK_SOURCE_ID = "city-mask";
const BORDER_SOURCE_ID = "city-border";
const CLUSTER_LAYER_ID = "report-clusters";
const CLUSTER_COUNT_LAYER_ID = "report-cluster-count";
const PRIORITY_REPORT_LAYER_ID = "report-priority-pulse";
const REPORT_LAYER_ID = "report-points-unclustered";
const WARD_FILL_LAYER_ID = "wards-fill";
const WARD_LINE_LAYER_ID = "wards-line";
const WARD_LABEL_LAYER_ID = "wards-label";
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

function getSeverityMapRadius(severityKey: GarbageReport["severity"]) {
  if (severityKey === "small") return 7;
  if (severityKey === "medium") return 9;
  if (severityKey === "large") return 11;
  return 14;
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
          isPriority: report.status !== "resolved" && (report.severity === "large" || report.severity === "massive"),
          reportId: report.id,
          severity: report.severity,
          severityColor: severity.color,
          severitySize: getSeverityMapRadius(report.severity),
          status: report.status,
          wardNumber: Number(report.ward_number)
        }
      };
    })
  };
}

function getWardReportCounts(reports: GarbageReport[]) {
  const active = new Map<number, number>();
  const visible = new Map<number, number>();

  reports.forEach((report) => {
    const wardNumber = Number(report.ward_number);
    if (!Number.isFinite(wardNumber)) return;

    visible.set(wardNumber, (visible.get(wardNumber) ?? 0) + 1);
    if (report.status !== "resolved") {
      active.set(wardNumber, (active.get(wardNumber) ?? 0) + 1);
    }
  });

  return { active, visible };
}

function createWardRenderData(reports: GarbageReport[], wardBoundaries: WardFeatureCollection): WardRenderCollection {
  const counts = getWardReportCounts(reports);

  return {
    type: "FeatureCollection",
    features: wardBoundaries.features.map((feature) => {
      const wardNumber = Number(feature.properties.ward_number);
      return {
        ...feature,
        id: wardNumber,
        properties: {
          ...feature.properties,
          report_count: counts.active.get(wardNumber) ?? 0,
          visible_report_count: counts.visible.get(wardNumber) ?? 0
        }
      };
    })
  };
}

function getFeatureBounds(feature: WardFeatureCollection["features"][number]): BoundsTuple | null {
  const points: LngLatTuple[] = [];
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;

  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      ring.forEach(([lng, lat]) => {
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          points.push([lng, lat]);
        }
      });
    });
  });

  if (!points.length) return null;
  return getBounds(points);
}

export function MapView({
  reports,
  cityBoundary,
  wardBoundaries,
  onSelectReport,
  onSelectWard,
  focusWardNumber,
  focusRequestId
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onSelectReportRef = useRef(onSelectReport);
  const onSelectWardRef = useRef(onSelectWard);
  const hoverWardIdRef = useRef<number | null>(null);
  const reportsByIdRef = useRef(new Map<string, GarbageReport>());
  const reportPointDataRef = useRef<ReportPointCollection>({ type: "FeatureCollection", features: [] });
  const wardRenderDataRef = useRef<WardRenderCollection>(createWardRenderData(reports, wardBoundaries));
  const [mapReady, setMapReady] = useState(false);
  const [showClusterHint, setShowClusterHint] = useState(shouldShowClusterHint);
  const [hoverWard, setHoverWard] = useState<HoverWard | null>(null);
  const reportPointData = useMemo(() => createReportPointData(reports, wardBoundaries), [reports, wardBoundaries]);
  const wardRenderData = useMemo(() => createWardRenderData(reports, wardBoundaries), [reports, wardBoundaries]);
  const coverageData = useMemo(() => createCoverageData(wardBoundaries, cityBoundary), [cityBoundary, wardBoundaries]);
  const activeReportCount = useMemo(() => reports.filter((report) => report.status !== "resolved").length, [reports]);

  useEffect(() => {
    onSelectReportRef.current = onSelectReport;
    onSelectWardRef.current = onSelectWard;
  }, [onSelectReport, onSelectWard]);

  useEffect(() => {
    reportPointDataRef.current = reportPointData;
  }, [reportPointData]);

  useEffect(() => {
    wardRenderDataRef.current = wardRenderData;
  }, [wardRenderData]);

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

      map = new maplibre.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [CITY_CENTER.longitude, CITY_CENTER.latitude],
        zoom: CITY_ZOOM,
        minZoom: CITY_MIN_ZOOM,
        maxBounds: CITY_MAX_BOUNDS,
        renderWorldCopies: false,
        attributionControl: false
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "bottom-right");
      map.on("load", () => {
        if (!map) return;
        map.fitBounds(coverageData.bounds, {
          duration: 0,
          maxZoom: CITY_ZOOM,
          padding:
            window.innerWidth < 768
              ? { top: 28, right: 20, bottom: 104, left: 20 }
              : { top: 38, right: 64, bottom: 96, left: 64 }
        });
        map.addSource(MASK_SOURCE_ID, { type: "geojson", data: coverageData.mask });
        map.addSource(BORDER_SOURCE_ID, { type: "geojson", data: coverageData.border });
        map.addSource(WARD_SOURCE_ID, { type: "geojson", data: wardRenderDataRef.current });
        map.addSource(REPORT_SOURCE_ID, {
          type: "geojson",
          data: reportPointDataRef.current,
          cluster: true,
          clusterMaxZoom: 14,
          clusterRadius: 50
        });
        map.addLayer({
          id: "city-mask-fill",
          type: "fill",
          source: MASK_SOURCE_ID,
          paint: {
            "fill-color": "#e5e7eb",
            "fill-opacity": 0.56
          }
        });
        map.addLayer({
          id: "city-border-line",
          type: "line",
          source: BORDER_SOURCE_ID,
          paint: {
            "line-color": "#ef4444",
            "line-dasharray": [3, 2],
            "line-opacity": 0.56,
            "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 13, 2.3]
          }
        });
        map.addLayer({
          id: WARD_FILL_LAYER_ID,
          type: "fill",
          source: WARD_SOURCE_ID,
          paint: {
            "fill-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              "rgba(220,38,38,0.15)",
              [
                "interpolate",
                ["linear"],
                ["get", "report_count"],
                0,
                "rgba(0,0,0,0)",
                1,
                "rgba(249,115,22,0.05)",
                4,
                "rgba(249,115,22,0.08)",
                10,
                "rgba(239,68,68,0.13)",
                18,
                "rgba(127,29,29,0.18)"
              ]
            ]
          }
        });
        map.addLayer({
          id: WARD_LINE_LAYER_ID,
          type: "line",
          source: WARD_SOURCE_ID,
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              "rgba(220,38,38,0.42)",
              "rgba(15,23,32,0.08)"
            ],
            "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.2, 0.75]
          }
        });
        map.addLayer({
          id: WARD_LABEL_LAYER_ID,
          type: "symbol",
          source: WARD_SOURCE_ID,
          minzoom: 13,
          layout: {
            "text-allow-overlap": false,
            "text-anchor": "center",
            "text-field": ["concat", "Ward ", ["to-string", ["get", "ward_number"]]],
            "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
            "text-size": 10
          },
          paint: {
            "text-color": "rgba(15,23,32,0.38)",
            "text-halo-color": "rgba(255,255,255,0.92)",
            "text-halo-width": 1.4
          }
        });
        map.addLayer({
          id: PRIORITY_REPORT_LAYER_ID,
          type: "circle",
          source: REPORT_SOURCE_ID,
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "isPriority"], true]],
          paint: {
            "circle-color": ["get", "severityColor"],
            "circle-radius": ["+", ["get", "severitySize"], 18],
            "circle-opacity": 0.14,
            "circle-stroke-width": 0
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
              "#f97316",
              5,
              "#ef4444",
              15,
              "#7f1d1d",
              30,
              "#dc2626",
              60,
              "#641313"
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              18,
              5,
              22,
              15,
              28,
              30,
              34
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-opacity": 0.92
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
            "circle-radius": ["get", "severitySize"],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2.5,
            "circle-opacity": ["case", ["==", ["get", "status"], "resolved"], 0.42, 1]
          }
        });
        map.on("click", CLUSTER_LAYER_ID, (event) => {
          const feature = map?.queryRenderedFeatures(event.point, { layers: [CLUSTER_LAYER_ID] })[0];
          const clusterId = Number(feature?.properties?.cluster_id);
          if (!map || !Number.isFinite(clusterId) || feature?.geometry.type !== "Point") return;
          const source = map.getSource(REPORT_SOURCE_ID) as GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
            if (!map || feature.geometry.type !== "Point") return;
            map.flyTo({
              center: feature.geometry.coordinates as [number, number],
              duration: 600,
              zoom: Math.min(zoom + 1, 17)
            });
          });
        });
        map.on("click", REPORT_LAYER_ID, (event) => {
          const reportId = String(event.features?.[0]?.properties?.reportId ?? "");
          const report = reportsByIdRef.current.get(reportId);
          if (report) onSelectReportRef.current(report);
        });
        map.on("click", WARD_FILL_LAYER_ID, (event) => {
          const wardNumber = Number(event.features?.[0]?.properties?.ward_number);
          if (wardNumber) onSelectWardRef.current(wardNumber);
        });
        map.on("mousemove", WARD_FILL_LAYER_ID, (event) => {
          const feature = event.features?.[0];
          const wardNumber = Number(feature?.properties?.ward_number);
          if (!map || !Number.isFinite(wardNumber)) return;

          if (hoverWardIdRef.current !== wardNumber) {
            if (hoverWardIdRef.current != null) {
              map.setFeatureState({ source: WARD_SOURCE_ID, id: hoverWardIdRef.current }, { hover: false });
            }
            hoverWardIdRef.current = wardNumber;
            map.setFeatureState({ source: WARD_SOURCE_ID, id: wardNumber }, { hover: true });
          }

          setHoverWard({
            reportCount: Number(feature?.properties?.visible_report_count ?? 0),
            wardName: String(feature?.properties?.ward_name ?? `Ward ${wardNumber}`),
            wardNumber,
            x: event.point.x,
            y: event.point.y,
            zone: typeof feature?.properties?.zone === "string" ? feature.properties.zone : null
          });
        });
        map.on("mouseleave", WARD_FILL_LAYER_ID, () => {
          if (!map) return;
          if (hoverWardIdRef.current != null) {
            map.setFeatureState({ source: WARD_SOURCE_ID, id: hoverWardIdRef.current }, { hover: false });
          }
          hoverWardIdRef.current = null;
          setHoverWard(null);
        });
        [CLUSTER_LAYER_ID, REPORT_LAYER_ID, WARD_FILL_LAYER_ID].forEach((layerId) => {
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
    };
  }, [coverageData, wardBoundaries]);

  useEffect(() => {
    const source = mapRef.current?.getSource(REPORT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(reportPointData);
  }, [mapReady, reportPointData]);

  useEffect(() => {
    const source = mapRef.current?.getSource(WARD_SOURCE_ID) as GeoJSONSource | undefined;
    if (!mapReady || !source) return;
    source.setData(wardRenderData);
  }, [mapReady, wardRenderData]);

  useEffect(() => {
    if (!mapReady) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      const map = mapRef.current;
      if (!map?.getLayer(PRIORITY_REPORT_LAYER_ID)) return;
      const progress = (Date.now() % 1900) / 1900;
      map.setPaintProperty(PRIORITY_REPORT_LAYER_ID, "circle-radius", ["+", ["get", "severitySize"], 12 + progress * 20]);
      map.setPaintProperty(PRIORITY_REPORT_LAYER_ID, "circle-opacity", 0.18 * (1 - progress));
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

    const bounds = getFeatureBounds(feature);
    if (!bounds) return;

    const isMobile = window.innerWidth < 768;
    map.fitBounds(
      bounds,
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
      <div className="map-stats-pill" aria-label="Visible map report statistics">
        <span>
          <strong>{activeReportCount}</strong>
          Active
        </span>
        <i aria-hidden="true" />
        <span>
          <strong>{reports.length}</strong>
          Reports
        </span>
      </div>
      <div className="map-heat-legend" aria-label="Ward report density legend">
        <span>Ward reports</span>
        <i className="is-low" aria-hidden="true" />
        <i className="is-mid" aria-hidden="true" />
        <i className="is-high" aria-hidden="true" />
        <em>Low to high</em>
      </div>
      {hoverWard && (
        <div
          className="map-ward-tooltip"
          style={{ left: hoverWard.x, top: hoverWard.y }}
          aria-hidden="true"
        >
          <strong>{hoverWard.wardName}</strong>
          <span>
            Ward {hoverWard.wardNumber}
            {hoverWard.zone ? ` - ${hoverWard.zone}` : ""}
          </span>
          <em>
            {hoverWard.reportCount} visible {hoverWard.reportCount === 1 ? "report" : "reports"}
          </em>
        </div>
      )}
      {showClusterHint && (
        <div className="map-cluster-hint" aria-label="Map cluster guidance">
          Grouped reports. Zoom in to see exact spots.
        </div>
      )}
    </div>
  );
}
