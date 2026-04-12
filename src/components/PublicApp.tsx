import clsx from "clsx";
import {
  ArrowUpRight,
  Bell,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Info,
  Layers,
  List,
  LoaderCircle,
  Map as MapIcon,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Trophy,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MapView } from "./MapView";
import { CHANGELOG, CATEGORIES, SEVERITY, STATUS_LABELS } from "../services/constants";
import { backend } from "../services/backend";
import { findNearestWard, findWardInGeoJson, isInsideCity } from "../services/geo";
import { canSubmitReport, hasUpvoted } from "../services/limits";
import { generateBBMPComplaint, getReportShareText, getWhatsAppUrl } from "../services/share";
import { daysActive, timeAgo } from "../services/time";
import type {
  CivicData,
  GarbageReport,
  NewReportInput,
  Representative,
  SeverityKey,
  Ward,
  WasteCategory
} from "../types/domain";

type RouteSelection =
  | { type: "report"; id: string }
  | { type: "ward"; id: string }
  | { type: "mla"; id: string }
  | { type: "mp"; id: string }
  | null;

interface PublicAppProps {
  data: CivicData;
  routeSelection: RouteSelection;
  onDataChange: (data: CivicData) => void;
  navigate: (path: string) => void;
}

export function PublicApp({ data, routeSelection, onDataChange, navigate }: PublicAppProps) {
  const [reports, setReports] = useState(data.reports);
  const [selectedReport, setSelectedReport] = useState<GarbageReport | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<RouteSelection>(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [showIntro, setShowIntro] = useState(() => localStorage.getItem("nk_intro_seen") !== "1");
  const [showAbout, setShowAbout] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [severityFilter, setSeverityFilter] = useState<"all" | SeverityKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "unresolved" | "resolved">("all");

  useEffect(() => {
    setReports(data.reports);
  }, [data.reports]);

  useEffect(() => {
    if (!routeSelection) return;
    if (routeSelection.type === "report") {
      const report = reports.find((item) => item.id === routeSelection.id);
      if (report) setSelectedReport(report);
    } else {
      setSelectedProfile(routeSelection);
    }
  }, [reports, routeSelection]);

  const filteredReports = useMemo(
    () =>
      reports.filter((report) => {
        if (severityFilter !== "all" && report.severity !== severityFilter) return false;
        if (statusFilter !== "all" && report.status !== statusFilter) return false;
        return true;
      }),
    [reports, severityFilter, statusFilter]
  );

  const unresolved = reports.filter((report) => report.status !== "resolved");
  const resolved = reports.filter((report) => report.status === "resolved");
  const worstWards = useMemo(() => getWorstWards(reports, data.wards), [reports, data.wards]);

  const refreshReports = async () => {
    const nextReports = await backend.fetchReports();
    setReports(nextReports);
    onDataChange({ ...data, reports: nextReports });
  };

  const updateReport = (updated: GarbageReport) => {
    const nextReports = reports.map((report) => (report.id === updated.id ? updated : report));
    setReports(nextReports);
    setSelectedReport(updated);
    onDataChange({ ...data, reports: nextReports });
  };

  const onSubmitted = (report: GarbageReport) => {
    const nextReports = [report, ...reports];
    setReports(nextReports);
    onDataChange({ ...data, reports: nextReports });
    setShowReportForm(false);
    setSelectedReport(report);
    navigate(`/report/${report.id}`);
  };

  const dismissIntro = () => {
    localStorage.setItem("nk_intro_seen", "1");
    setShowIntro(false);
  };

  return (
    <div className="app-frame">
      <MapView
        reports={filteredReports}
        wardBoundaries={data.wardBoundaries}
        onSelectReport={(report) => {
          setSelectedReport(report);
          navigate(`/report/${report.id}`);
        }}
        onSelectWard={(wardNumber) => {
          setSelectedProfile({ type: "ward", id: String(wardNumber) });
          navigate(`/ward/${wardNumber}`);
        }}
      />

      <header className="topbar safe-top">
        <button className="brand-chip" onClick={() => navigate("/")} aria-label="Go to map">
          <img src="/logo.png" alt="" />
          <span>Amma Odisha</span>
        </button>
        <div className="topbar-actions">
          <IconButton label="About Amma Odisha" onClick={() => setShowAbout(true)}>
            <Info size={17} />
          </IconButton>
          <IconButton label="What's new" onClick={() => setShowChangelog(true)}>
            <Bell size={17} />
          </IconButton>
        </div>
      </header>

      <div className="map-mode-toggle">
        <SegmentedButton active={viewMode === "map"} onClick={() => setViewMode("map")} icon={<MapIcon size={14} />} label="Map" />
        <SegmentedButton active={viewMode === "list"} onClick={() => setViewMode("list")} icon={<List size={14} />} label="List" />
      </div>

      {viewMode === "list" && (
        <div className="list-overlay">
          <ReportList reports={filteredReports} wards={data.wards} onSelect={(report) => setSelectedReport(report)} />
        </div>
      )}

      <section className="stats-strip" aria-label="NammaKasa report statistics">
        <Stat label="Active" value={unresolved.length} tone="red" />
        <Stat label="Reports" value={reports.length} tone="gray" />
        <Stat label="Resolved" value={resolved.length} tone="green" />
      </section>

      <BottomSheet>
        <div className="sheet-block">
          <div className="sheet-title-row">
            <div>
              <p className="eyebrow">Bhubaneswar (BMC)</p>
              <h1>Garbage Report</h1>
            </div>
            <button className="tiny-action" onClick={refreshReports}>
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
          <p className="muted">Report it. Photograph it. Track who is responsible.</p>
        </div>

        <div className="filter-row">
          <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "all" | SeverityKey)}>
            <option value="all">All Severity</option>
            {Object.entries(SEVERITY).map(([key, value]) => (
              <option value={key} key={key}>
                {value.label}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "unresolved" | "resolved")}>
            <option value="all">All Status</option>
            <option value="unresolved">Unresolved</option>
            <option value="resolved">Cleaned</option>
          </select>
        </div>

        <button className="primary-cta" onClick={() => setShowReportForm(true)}>
          <Plus size={18} />
          Report Garbage
        </button>

        <div className="leaderboard">
          <div className="sheet-title-row compact">
            <h2>Worst Wards by Reports</h2>
            <Trophy size={16} />
          </div>
          {worstWards.length ? (
            worstWards.slice(0, 5).map((item, index) => (
              <button
                className="ward-row"
                key={item.ward.ward_number}
                onClick={() => {
                  setSelectedProfile({ type: "ward", id: String(item.ward.ward_number) });
                  navigate(`/ward/${item.ward.ward_number}`);
                }}
              >
                <span className="rank">{index + 1}</span>
                <span>
                  <strong>Ward {item.ward.ward_number}</strong>
                  <small>{item.ward.ward_name}</small>
                </span>
                <b>{item.count}</b>
              </button>
            ))
          ) : (
            <p className="empty">No reports yet. Be the first!</p>
          )}
        </div>
      </BottomSheet>

      <button className="floating-report" onClick={() => setShowReportForm(true)}>
        <Camera size={18} />
        Report
      </button>

      <TelegramToast />

      {showIntro && <IntroOverlay onClose={dismissIntro} />}
      {showAbout && <AboutSheet onClose={() => setShowAbout(false)} />}
      {showChangelog && <ChangelogSheet onClose={() => setShowChangelog(false)} />}
      {showReportForm && <ReportForm data={data} onClose={() => setShowReportForm(false)} onSubmit={onSubmitted} />}
      {selectedReport && (
        <ReportDetail
          report={selectedReport}
          data={data}
          onClose={() => {
            setSelectedReport(null);
            navigate("/");
          }}
          onUpdate={updateReport}
          openProfile={(profile) => {
            setSelectedReport(null);
            setSelectedProfile(profile);
            navigate(`/${profile.type}/${encodeURIComponent(profile.id)}`);
          }}
        />
      )}
      {selectedProfile && (
        <ProfileSheet
          selection={selectedProfile}
          data={{ ...data, reports }}
          onClose={() => {
            setSelectedProfile(null);
            navigate("/");
          }}
          onSelectReport={(report) => {
            setSelectedProfile(null);
            setSelectedReport(report);
            navigate(`/report/${report.id}`);
          }}
        />
      )}
    </div>
  );
}

function BottomSheet({ children }: { children: ReactNode }) {
  return (
    <aside className="bottom-sheet safe-bottom">
      <div className="sheet-handle" />
      <div className="sheet-content">{children}</div>
    </aside>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="icon-button" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

function SegmentedButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={clsx("segmented-button", active && "is-active")} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`stat stat-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function IntroOverlay({ onClose }: { onClose: () => void }) {
  return (
    <button className="intro-overlay" onClick={onClose}>
      <div className="intro-card">
        <img src="/logo.png" alt="" />
        <p className="eyebrow">v0.3.0</p>
        <h2>Bhubaneswar has a garbage problem.</h2>
        <p>Report it. Photograph it. Track who is responsible.</p>
        <small>Every dump is mapped to the responsible ward, MLA, and MP. When enough citizens report, it becomes impossible to ignore.</small>
        <b>67 wards · 4 MLAs · 1 MP · All of Bhubaneswar</b>
        <span>Tap anywhere to continue</span>
      </div>
    </button>
  );
}

function ReportList({
  reports,
  wards,
  onSelect
}: {
  reports: GarbageReport[];
  wards: Ward[];
  onSelect: (report: GarbageReport) => void;
}) {
  return (
    <div className="report-list">
      {reports.length ? (
        reports.map((report) => (
          <ReportListItem key={report.id} report={report} ward={wards.find((ward) => ward.ward_number === report.ward_number)} onSelect={onSelect} />
        ))
      ) : (
        <p className="empty">No reports yet. Be the first to report a garbage dump in your area!</p>
      )}
    </div>
  );
}

function ReportListItem({
  report,
  ward,
  onSelect
}: {
  report: GarbageReport;
  ward?: Ward;
  onSelect: (report: GarbageReport) => void;
}) {
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
  return (
    <button className="report-item" onClick={() => onSelect(report)}>
      {report.photo_url ? <img src={report.photo_url} alt="" /> : <span className="photo-placeholder">No Photo</span>}
      <span className="report-item-body">
        <strong>{report.address}</strong>
        <small>
          Ward #{report.ward_number} {ward ? `· ${ward.ward_name}` : ""} · {timeAgo(report.created_at)}
        </small>
        <em style={{ color: severity.color }}>{severity.label}</em>
      </span>
      <ChevronDown size={14} className="sideways" />
    </button>
  );
}

function getWorstWards(reports: GarbageReport[], wards: Ward[]) {
  const counts = new globalThis.Map<number, number>();
  reports
    .filter((report) => report.status !== "resolved")
    .forEach((report) => counts.set(report.ward_number, (counts.get(report.ward_number) ?? 0) + 1));
  return wards
    .map((ward) => ({ ward, count: counts.get(ward.ward_number) ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

function ReportDetail({
  report,
  data,
  onClose,
  onUpdate,
  openProfile
}: {
  report: GarbageReport;
  data: CivicData;
  onClose: () => void;
  onUpdate: (report: GarbageReport) => void;
  openProfile: (selection: Exclude<RouteSelection, null>) => void;
}) {
  const [isUpvoting, setIsUpvoting] = useState(false);
  const [upvoted, setUpvoted] = useState(() => hasUpvoted(report.id));
  const [showResolve, setShowResolve] = useState(false);
  const ward = data.wards.find((item) => item.ward_number === report.ward_number);
  const mla = data.representatives.find((rep) => rep.role === "mla" && rep.constituency === ward?.assembly_constituency);
  const mp = data.representatives.find((rep) => rep.role === "mp" && rep.constituency === ward?.parliamentary_constituency);
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;

  const upvote = async () => {
    if (isUpvoting || upvoted) return;
    setIsUpvoting(true);
    const result = await backend.upvoteReport(report.id);
    setUpvoted(true);
    if (!result.alreadyVoted && result.newCount) onUpdate({ ...report, upvote_count: result.newCount });
    setIsUpvoting(false);
  };

  const shareReport = async () => {
    const url = `${location.origin}/report/${report.id}`;
    const text = getReportShareText(report, ward, mla);
    if (navigator.share) {
      await navigator.share({ title: `Garbage Report — ${ward?.ward_name ?? "Bhubaneswar"}`, text, url });
    } else {
      await navigator.clipboard?.writeText(url);
    }
  };

  const complaint = () => {
    const text = generateBBMPComplaint({
      address: report.address,
      wardName: ward?.ward_name ?? "Unknown",
      wardNumber: ward?.ward_number ?? "?",
      severity: report.severity,
      category: report.category,
      photoUrl: report.photo_url,
      lat: report.latitude,
      lng: report.longitude
    });
    window.open(getWhatsAppUrl(text), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="detail-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose} aria-label="Close report detail">
          <X size={18} />
        </button>
        {report.photo_url ? <img className="detail-photo" src={report.photo_url} alt="Garbage report" /> : <div className="detail-photo empty">No Photo</div>}
        <div className="detail-content">
          <div className="pill-row">
            <span className="pill" style={{ background: `${severity.color}15`, color: severity.color }}>
              {severity.label}
            </span>
            <span className={clsx("pill", report.status === "resolved" ? "green" : "red")}>{STATUS_LABELS[report.status]}</span>
          </div>
          <h2>{report.address}</h2>
          <p>
            Ward #{report.ward_number} {ward ? `— ${ward.ward_name}` : ""} · {daysActive(report.created_at)} Days
          </p>

          <div className="metric-grid">
            <Metric label="Upvotes" value={report.upvote_count || 1} />
            <Metric label="Waste Type" value={CATEGORIES[report.category]} />
            <Metric label="Age" value={`${daysActive(report.created_at)} days`} />
          </div>

          <h3>Accountability</h3>
          <div className="rep-grid">
            <RepCard label="MLA" rep={mla} area={ward?.assembly_constituency} onClick={() => mla && openProfile({ type: "mla", id: mla.constituency })} />
            <RepCard label="MP" rep={mp} area={ward?.parliamentary_constituency} onClick={() => mp && openProfile({ type: "mp", id: mp.constituency })} />
          </div>

          <div className="action-grid">
            <button onClick={upvote} disabled={upvoted || isUpvoting}>
              {isUpvoting ? <LoaderCircle className="spin" size={16} /> : <ThumbsUp size={16} />}
              {upvoted ? "Upvoted" : "Upvote"}
            </button>
            <button onClick={shareReport}>
              <Share2 size={16} />
              Share
            </button>
            <button onClick={complaint}>
              <MessageCircle size={16} />
              WhatsApp BMC
            </button>
            {report.status !== "resolved" && (
              <button onClick={() => setShowResolve(true)} className="green-action">
                <CheckCircle2 size={16} />
                It is Cleaned Up — Verify
              </button>
            )}
          </div>
          <p className="anonymous">
            <ShieldCheck size={13} /> All reports are anonymous
          </p>
        </div>
      </article>
      {showResolve && <ResolveModal report={report} onClose={() => setShowResolve(false)} onResolved={onUpdate} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RepCard({ label, rep, area, onClick }: { label: string; rep?: Representative; area?: string; onClick: () => void }) {
  return (
    <button className="rep-card" onClick={onClick} disabled={!rep}>
      <Avatar rep={rep} />
      <span>
        <small>{label}</small>
        <strong>{rep?.name ?? "Not mapped"}</strong>
        <em>
          {rep?.party ?? "—"} · {area ?? "Unknown"}
        </em>
      </span>
      <ArrowUpRight size={14} />
    </button>
  );
}

function Avatar({ rep }: { rep?: Representative }) {
  if (rep?.photo_url) return <img className="avatar" src={rep.photo_url} alt={rep.name} />;
  const initials = (rep?.name ?? "NK")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return <span className="avatar initials">{initials}</span>;
}

function ResolveModal({ report, onClose, onResolved }: { report: GarbageReport; onClose: () => void; onResolved: (report: GarbageReport) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "locating" | "verified" | "mismatch" | "saving">("idle");

  const verify = async () => {
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const distanceMeters = Math.hypot((lat - report.latitude) * 111_000, (lng - report.longitude) * 111_000);
        if (distanceMeters > 500) {
          setStatus("mismatch");
          return;
        }
        setStatus("saving");
        const photoUrl = photo ? await backend.uploadReportPhoto(photo) : null;
        const resolved = await backend.resolveReport(report.id, { photoUrl, lat, lng });
        onResolved(resolved);
        onClose();
      },
      () => setStatus("mismatch"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const onFile = (file?: File) => {
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  return (
    <div className="nested-modal">
      <article className="mini-card">
        <button className="close-button" onClick={onClose}>
          <X size={18} />
        </button>
        <h2>Mark as Cleaned</h2>
        <p>Take a photo to verify this spot has been cleaned up.</p>
        <label className={clsx("photo-drop", preview && "has-photo")}>
          {preview ? <img src={preview} alt="" /> : <Camera size={28} />}
          <span>{preview ? "Tap to Retake" : "Take a Verification Photo"}</span>
          <input type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} />
        </label>
        <button className="primary-cta" onClick={verify} disabled={status === "locating" || status === "saving"}>
          {status === "locating" || status === "saving" ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
          {status === "idle" && "Show that this spot is now clean"}
          {status === "locating" && "Verifying your location..."}
          {status === "saving" && "Saving verification..."}
          {status === "mismatch" && "Try Again"}
        </button>
        {status === "mismatch" && (
          <p className="warning-text">Location Mismatch. You seem to be far from the original report location.</p>
        )}
      </article>
    </div>
  );
}

function ReportForm({ data, onClose, onSubmit }: { data: CivicData; onClose: () => void; onSubmit: (report: GarbageReport) => void }) {
  const [wardNumber, setWardNumber] = useState("");
  const [detectedWard, setDetectedWard] = useState<Ward | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "detecting" | "detected" | "manual" | "outside">("idle");
  const [address, setAddress] = useState("");
  const [severity, setSeverity] = useState<SeverityKey>("medium");
  const [category, setCategory] = useState<WasteCategory>("mixed");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const limit = canSubmitReport();
  const selectedWard = detectedWard ?? data.wards.find((ward) => ward.ward_number === Number(wardNumber));

  const detectWard = () => {
    if (!navigator.geolocation) {
      setLocationState("manual");
      return;
    }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLocation({ lat, lng });
        if (!isInsideCity(lat, lng)) {
          setLocationState("outside");
          return;
        }
        setLocationState("detecting");
        const ward = findWardInGeoJson(lat, lng, data.wards, data.wardBoundaries) ?? findNearestWard(lat, lng, data.wards);
        if (ward) {
          setDetectedWard(ward);
          setWardNumber(String(ward.ward_number));
          setLocationState("detected");
        } else {
          setLocationState("manual");
        }
      },
      () => setLocationState("manual"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Run once on mount so the form immediately mirrors the live GPS-first UX.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => detectWard(), []);

  const onFile = (file?: File) => {
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const submit = async () => {
    setError("");
    if (!limit.allowed) {
      setError("Thank you, amazing citizen! To protect our platform from spam, we limit reports to 5 per day.");
      return;
    }
    if (!selectedWard || !address.trim() || !photo) {
      setError("Photo, ward, and landmark are required.");
      return;
    }
    setSubmitting(true);
    try {
      const photoUrl = await backend.uploadReportPhoto(photo);
      const input: NewReportInput = {
        latitude: location?.lat ?? selectedWard.center_lat,
        longitude: location?.lng ?? selectedWard.center_lng,
        ward_number: selectedWard.ward_number,
        address: address.trim(),
        severity,
        category,
        photo_url: photoUrl
      };
      onSubmit(await backend.submitReport(input));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="form-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="form-header">
          <div>
            <p className="eyebrow">Garbage Report</p>
            <h2>Report Garbage</h2>
          </div>
          <button className="close-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {locationState === "outside" && (
          <div className="notice amber">
            <CircleAlert size={16} />
            <span>
              <strong>We are not live in your area yet</strong>
              You can still browse reports and explore the map.
            </span>
          </div>
        )}
        <label className="field">
          <span>
            Photo <b>*</b>
          </span>
          <label className={clsx("photo-drop", photoPreview && "has-photo")}>
            {photoPreview ? <img src={photoPreview} alt="" /> : <Camera size={30} />}
            <em>{photoPreview ? "Tap to Retake" : "Take a Photo"}</em>
            <small>A photo makes your report 10x more credible</small>
            <input type="file" accept="image/*" capture="environment" onChange={(event) => onFile(event.target.files?.[0])} />
          </label>
        </label>
        <label className="field">
          <span>
            Ward <b>*</b>
          </span>
          <select
            value={wardNumber}
            onChange={(event) => {
              setWardNumber(event.target.value);
              setDetectedWard(null);
              setLocationState("manual");
            }}
          >
            <option value="">Select Ward...</option>
            {data.wards.map((ward) => (
              <option key={ward.ward_number} value={ward.ward_number}>
                Ward {ward.ward_number} — {ward.ward_name}
              </option>
            ))}
          </select>
          <button className="tiny-action" onClick={detectWard} type="button">
            {locationState === "locating" || locationState === "detecting" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}
            {locationState === "detected" ? "Re-detect" : locationState === "detecting" ? "Detecting ward..." : "Ward Detected"}
          </button>
        </label>
        <label className="field">
          <span>
            Landmark / Address <b>*</b>
          </span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="e.g., Near 5th Cross, opposite Reliance Fresh" />
          <small>Please add a landmark or address so others can find this spot.</small>
        </label>
        <label className="field">
          <span>How Bad Is It?</span>
          <div className="option-grid">
            {Object.entries(SEVERITY).map(([key, value]) => (
              <button type="button" className={clsx(severity === key && "is-selected")} onClick={() => setSeverity(key as SeverityKey)} key={key}>
                <i style={{ background: value.color }} />
                <strong>{value.label}</strong>
                <small>{value.description}</small>
              </button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>Waste Type</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as WasteCategory)}>
            {Object.entries(CATEGORIES).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="warning-text">{error}</p>}
        <button className="primary-cta" onClick={submit} disabled={submitting}>
          {submitting ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
          {submitting ? "Submitting..." : "Report Garbage"}
        </button>
        <p className="anonymous">
          <ShieldCheck size={13} /> All reports are anonymous
        </p>
      </article>
    </div>
  );
}

function ProfileSheet({
  selection,
  data,
  onClose,
  onSelectReport
}: {
  selection: Exclude<RouteSelection, null>;
  data: CivicData;
  onClose: () => void;
  onSelectReport: (report: GarbageReport) => void;
}) {
  const isWard = selection.type === "ward";
  const ward = isWard ? data.wards.find((item) => item.ward_number === Number(selection.id)) : null;
  const rep = !isWard
    ? data.representatives.find((item) => item.role === selection.type && item.constituency === decodeURIComponent(selection.id))
    : null;
  const profileReports = data.reports.filter((report) => {
    const itemWard = data.wards.find((item) => item.ward_number === report.ward_number);
    if (ward) return report.ward_number === ward.ward_number;
    if (selection.type === "mla") return itemWard?.assembly_constituency === rep?.constituency;
    return itemWard?.parliamentary_constituency === rep?.constituency;
  });
  const activeReports = profileReports.filter((report) => report.status !== "resolved");

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="profile-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="profile-hero">
          {rep ? <Avatar rep={rep} /> : <Layers size={28} />}
          <div>
            <p className="eyebrow">{isWard ? "Ward Profile" : selection.type.toUpperCase()}</p>
            <h2>{ward ? `Ward ${ward.ward_number}` : rep?.name}</h2>
            <p>{ward ? ward.ward_name : `${rep?.party} · ${rep?.constituency}`}</p>
          </div>
        </div>
        <div className="metric-grid">
          <Metric label="unresolved" value={activeReports.length} />
          <Metric label="Total Reports" value={profileReports.length} />
          <Metric label="Avg Days" value={Math.round(activeReports.reduce((sum, report) => sum + daysActive(report.created_at), 0) / Math.max(1, activeReports.length))} />
        </div>
        {isWard && ward ? (
          <div className="accountability-card">
            <h3>Responsible MLA</h3>
            <p>{ward.assembly_constituency}</p>
            <p>{ward.parliamentary_constituency}</p>
          </div>
        ) : (
          <div className="accountability-card">
            <h3>{selection.type === "mla" ? "Assembly Constituencies" : "Wards"}</h3>
            <p>Tap to view reports and top locations across this constituency.</p>
          </div>
        )}
        <h3>Top Locations</h3>
        <ReportList reports={profileReports} wards={data.wards} onSelect={onSelectReport} />
      </article>
    </div>
  );
}

function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-layer top" onMouseDown={onClose}>
      <article className="top-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose}>
          <X size={18} />
        </button>
        <h2>Why Amma Odisha?</h2>
        <p className="eyebrow">AMMA ODISHA</p>
        <p>
          Bhubaneswar generates over <strong>1,200 tonnes</strong> of waste daily. Despite BMC's efforts, illegal dumping persists across the city — on sidewalks,
          vacant plots, and road corners. Citizens complain, but complaints disappear into bureaucratic black holes.
        </p>
        <p>
          <strong>Amma Odisha changes the equation.</strong> Every garbage dump is mapped, photographed, and linked to the responsible ward, MLA, and MP. When
          enough citizens report the same spot, it becomes impossible to ignore. The data is public, the accountability is permanent.
        </p>
        <p>This is crowdsourced civic infrastructure — built by citizens, for citizens.</p>
        <div className="social-row">
          <a href="https://x.com/realmojojojo_" target="_blank" rel="noreferrer">
            Built by @realmojojojo_
          </a>
          <a href="https://nammakasa.in" target="_blank" rel="noreferrer">
            nammakasa.in
          </a>
        </div>
      </article>
    </div>
  );
}

function ChangelogSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <article className="profile-sheet small" onMouseDown={(event) => event.stopPropagation()}>
        <button className="close-button" onClick={onClose}>
          <X size={18} />
        </button>
        <h2>Changelog</h2>
        <p className="muted">What's new in NammaKasa</p>
        {CHANGELOG.map((entry) => (
          <div className="changelog-entry" key={entry.version}>
            <div className="sheet-title-row compact">
              <strong>v{entry.version}</strong>
              <span className="pill green">{entry.tag}</span>
              <small>{entry.date}</small>
            </div>
            {entry.changes.map((change) => (
              <p key={change.text}>
                <span>NEW</span> {change.text}
              </p>
            ))}
          </div>
        ))}
      </article>
    </div>
  );
}

function TelegramToast() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("nk_telegram_hidden") === "1");
  if (hidden) return null;
  return (
    <div className="telegram-toast">
      <button
        className="toast-close"
        onClick={() => {
          localStorage.setItem("nk_telegram_hidden", "1");
          setHidden(true);
        }}
        aria-label="Dismiss Telegram community toast"
      >
        <X size={12} />
      </button>
      <Sparkles size={16} />
      <span>
        <strong>Join the community</strong>
        Feedback, ideas & updates on Telegram
      </span>
      <a href="https://t.me/nammakasa" target="_blank" rel="noreferrer">
        Join
      </a>
    </div>
  );
}
