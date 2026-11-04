import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, ChevronLeft, ClipboardList, Clock3, Link2, MapPin, ShieldCheck, Trash2, X } from "lucide-react";
import { DialogSurface } from "./DialogSurface";
import { copyTextToClipboard, notifyCopied } from "../services/share";
import { readMyReports, removeMyReport, resolveMyReportEntries, type MyReportStatus } from "../services/my-reports";
import { LOCAL_REPORT_PHOTO_FALLBACK_URL } from "../services/report-images";
import { timeAgo } from "../services/time";
import type { GarbageReport } from "../types/domain";

const STATUS_META: Record<MyReportStatus, { label: string; className: string; icon: typeof Clock3 }> = {
  pending: { label: "In review", className: "my-report-status pending", icon: Clock3 },
  live: { label: "Live on map", className: "my-report-status live", icon: MapPin },
  cleaned: { label: "Cleaned", className: "my-report-status cleaned", icon: BadgeCheck }
};

/**
 * "My Reports" — the reports this browser filed, with their review status.
 * Pending reports are invisible everywhere else in the UI (they only become
 * public after moderation), so this is the only place a citizen can check
 * what happened to their submission.
 */
export function MyReportsSheet({
  onClose,
  onReportNew,
  onViewReport,
  publicReports
}: {
  onClose: () => void;
  onReportNew: () => void;
  onViewReport: (report: GarbageReport) => void;
  publicReports: GarbageReport[];
}) {
  const [localReports, setLocalReports] = useState(readMyReports);
  const entries = useMemo(() => resolveMyReportEntries(publicReports, localReports), [publicReports, localReports]);
  const pendingCount = entries.filter((entry) => entry.status === "pending").length;

  const remove = (reportId: string) => {
    setLocalReports(removeMyReport(reportId));
  };

  const copyLink = async (reportId: string) => {
    try {
      await copyTextToClipboard(`${window.location.origin}/report/${reportId}`);
      notifyCopied();
    } catch (error) {
      console.error("Copy link failed", error);
    }
  };

  return (
    <DialogSurface ariaLabel="My reports" className="profile-sheet my-reports-sheet" onClose={onClose}>
      <button className="sheet-back-button" type="button" onClick={onClose}>
        <ChevronLeft size={16} />
        Back to map
      </button>
      <button className="close-button" onClick={onClose} aria-label="Close my reports">
        <X size={18} />
      </button>
      <div className="sheet-title-row">
        <div>
          <p className="eyebrow">Your submissions</p>
          <h2>My Reports</h2>
        </div>
        <ClipboardList size={20} aria-hidden="true" />
      </div>
      <p className="muted">
        {entries.length === 0
          ? "Reports you file from this device are tracked here."
          : `${entries.length} ${entries.length === 1 ? "report" : "reports"} filed from this device${pendingCount ? ` · ${pendingCount} in review` : ""}.`}
      </p>

      {entries.length === 0 ? (
        <div className="my-reports-empty">
          <ClipboardList size={36} aria-hidden="true" />
          <p className="empty-title">Nothing filed yet</p>
          <p className="empty">When you report a garbage spot, you can track its review and cleanup status right here.</p>
          <button type="button" className="primary-cta" onClick={onReportNew}>
            Report garbage
          </button>
        </div>
      ) : (
        <ul className="my-reports-list">
          {entries.map(({ report, status }) => {
            const meta = STATUS_META[status];
            const StatusIcon = meta.icon;
            return (
              <li key={report.id} className="my-report-item">
                <MyReportThumb report={report} />
                <div className="my-report-body">
                  <span className={meta.className}>
                    <StatusIcon size={12} aria-hidden="true" />
                    {meta.label}
                  </span>
                  <strong>{report.address}</strong>
                  <small>
                    Ward {report.ward_number} · {timeAgo(report.created_at)}
                  </small>
                  <div className="my-report-actions">
                    <button type="button" onClick={() => onViewReport(report)}>
                      View
                    </button>
                    <button type="button" onClick={() => void copyLink(report.id)} aria-label="Copy report link">
                      <Link2 size={13} aria-hidden="true" />
                      Copy link
                    </button>
                    <button type="button" onClick={() => remove(report.id)} aria-label="Remove from my reports">
                      <Trash2 size={13} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="anonymous my-reports-note">
        <ShieldCheck size={13} aria-hidden="true" /> Stored only on this device — removing a report here does not delete it from the map.
      </p>
    </DialogSurface>
  );
}

function MyReportThumb({ report }: { report: GarbageReport }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && report.photo_thumb_url ? report.photo_thumb_url : !failed && report.photo_url ? report.photo_url : LOCAL_REPORT_PHOTO_FALLBACK_URL;
  useEffect(() => {
    setFailed(false);
  }, [report.photo_thumb_url, report.photo_url]);
  return <img className="my-report-thumb" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
