import clsx from "clsx";
import {
  ArrowUp,
  CheckCircle2,
  CircleCheck,
  CircleX,
  ExternalLink,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldAlert,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backend } from "../services/backend";
import { SEVERITY } from "../services/constants";
import { timeAgo } from "../services/time";
import type { AdminStats, GarbageReport, ModerationStatus } from "../types/domain";

// Admin key is stored in sessionStorage (not localStorage) so it is cleared
// when the browser tab is closed — it should not persist across sessions.
const SESSION_KEY = "nk_admin_key";

function readSessionValue(key: string) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
}

function removeSessionValue(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage write failures.
  }
}

const tabs: { key: ModerationStatus; label: string }[] = [
  { key: "flagged", label: "Flagged" },
  { key: "rejected", label: "Rejected" },
  { key: "approved", label: "Approved" }
];

const reasonLabels: Record<string, string> = {
  safesearch_failed: "NSFW detected",
  not_civic_issue: "not civic issue",
  abusive_text: "abusive language",
  suspicious_text: "suspicious text",
  potential_duplicate: "potential duplicate",
  pending_review: "pending review"
};

export function AdminPanel() {
  const [adminKey, setAdminKey] = useState(() => readSessionValue(SESSION_KEY));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [queues, setQueues] = useState<Record<ModerationStatus, GarbageReport[]>>({ flagged: [], rejected: [], approved: [] });
  const [activeTab, setActiveTab] = useState<ModerationStatus>("flagged");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [showTop, setShowTop] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const touchStartRef = useRef<number | null>(null);

  const login = async (key = adminKey) => {
    setLoading(true);
    setLoginError("");
    try {
      const nextStats = await backend.adminStats(key);
      writeSessionValue(SESSION_KEY, key);
      setAdminKey(key);
      setStats(nextStats);
      setIsLoggedIn(true);
      await loadQueue(activeTab, key);
    } catch {
      setLoginError("That admin key did not work. Check the key and try again.");
    } finally {
      setLoading(false);
    }
  };

  // Attempt to restore a persisted admin session silently. On failure (e.g.
  // the key expired or was rotated) we clear it so the login form is shown
  // instead of leaving the user stuck on a blank screen.
  useEffect(() => {
    const key = readSessionValue(SESSION_KEY);
    if (!key) return;
    backend.adminStats(key).then((nextStats) => {
      setAdminKey(key);
      setStats(nextStats);
      setIsLoggedIn(true);
      return loadQueue("flagged", key);
    }).catch(() => {
      // Key is stale — remove it and show the login form.
      removeSessionValue(SESSION_KEY);
    });
  // loadQueue is stable enough for a one-time mount effect; the key is passed
  // explicitly so there is no stale-closure risk here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQueue = async (status: ModerationStatus, key = adminKey) => {
    setLoading(true);
    setActionError("");
    try {
      const [nextQueue, nextStats] = await Promise.all([backend.adminQueue(key, status), backend.adminStats(key)]);
      setQueues((current) => ({ ...current, [status]: nextQueue }));
      setStats(nextStats);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Failed to load queue. Please refresh.");
    } finally {
      setLoading(false);
    }
  };

  const action = async (reportId: string, decision: ModerationStatus) => {
    setActionError("");
    try {
      await backend.moderateReport(adminKey, reportId, decision);
      setQueues((current) => ({ ...current, [activeTab]: current[activeTab].filter((report) => report.id !== reportId) }));
      setStats(await backend.adminStats(adminKey));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Action failed. Please try again.");
    }
  };

  const approveAll = async () => {
    const ids = queues[activeTab].map((report) => report.id);
    if (!ids.length) return;
    setActionError("");
    try {
      await backend.bulkModerate(adminKey, ids, "approved");
      setQueues((current) => ({ ...current, [activeTab]: [] }));
      setStats(await backend.adminStats(adminKey));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Bulk approve failed. Please try again.");
    }
  };

  const queue = queues[activeTab];
  const tabCounts = useMemo(() => tabs.map((tab) => ({ ...tab, count: stats?.[tab.key] ?? 0 })), [stats]);

  const onTouchEnd = (clientX: number) => {
    if (touchStartRef.current === null) return;
    const diff = touchStartRef.current - clientX;
    const index = tabs.findIndex((tab) => tab.key === activeTab);
    if (diff > 60 && index < tabs.length - 1) setActiveTab(tabs[index + 1].key);
    if (diff < -60 && index > 0) setActiveTab(tabs[index - 1].key);
    touchStartRef.current = null;
  };

  useEffect(() => {
    if (isLoggedIn) void loadQueue(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <main className="admin-login">
        <section>
          <img src="/logo.png" alt="Amma Odisha" />
          <p className="eyebrow">Moderator workspace</p>
          <h1>Amma Odisha Moderation</h1>
          <p>Review flagged citizen reports before they appear on the public map.</p>
          <label className="admin-login-field">
            <span>Admin key</span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && adminKey && void login()}
              placeholder="Admin key"
            />
          </label>
          {loginError && <p className="warning-text">{loginError}</p>}
          <button onClick={() => void login()} disabled={loading || !adminKey}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <ShieldAlert size={16} />}
            Login
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header safe-top">
        <div>
          <img src="/logo.png" alt="Moderator" style={{ height: "30px", width: "auto" }} />
          {/* Spin class targets the icon, not the button wrapper */}
          <button onClick={() => void loadQueue(activeTab)} aria-label="Refresh queue">
            <RefreshCw size={18} className={clsx(loading && "spin")} />
          </button>
        </div>
        <button
          onClick={() => {
            removeSessionValue(SESSION_KEY);
            setIsLoggedIn(false);
          }}
          aria-label="Logout"
        >
          <LogOut size={18} />
        </button>
      </header>
      <div
        className="admin-list"
        ref={listRef}
        onScroll={() => setShowTop((listRef.current?.scrollTop ?? 0) > 400)}
        onTouchStart={(event) => {
          touchStartRef.current = event.touches[0].clientX;
        }}
        onTouchEnd={(event) => onTouchEnd(event.changedTouches[0].clientX)}
      >
        {stats && (
          <section className="admin-stats">
            <AdminStat label="Total" value={stats.total} color="#6B7280" />
            <AdminStat label="Flagged" value={stats.flagged} color="#F59E0B" />
            <AdminStat label="Rejected" value={stats.rejected} color="#EF4444" />
            <AdminStat label="Approved" value={stats.approved} color="#22C55E" />
          </section>
        )}
        <nav className="admin-tabs">
          {tabCounts.map((tab) => (
            <button className={clsx(activeTab === tab.key && "is-active")} onClick={() => setActiveTab(tab.key)} key={tab.key}>
              {tab.label} {tab.count > 0 ? `(${tab.count})` : ""}
            </button>
          ))}
        </nav>
        {actionError && (
          <p className="warning-text" style={{ margin: "8px 16px", padding: "10px 12px", borderRadius: 8, background: "var(--primary-soft)" }}>
            {actionError}
          </p>
        )}
        <section className="admin-cards">
          {activeTab === "flagged" && queue.length > 3 && (
            <button className="bulk-action" onClick={() => void approveAll()}>
              <CircleCheck size={14} />
              Approve All {queue.length} Flagged
            </button>
          )}
          {loading && !queue.length ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : queue.length ? (
            queue.map((report, index) => (
              <ModerationCard
                key={report.id}
                report={report}
                index={index}
                currentTab={activeTab}
                onViewPhoto={setPhoto}
                onAction={(decision) => void action(report.id, decision)}
              />
            ))
          ) : (
            <div className="admin-empty">
              <CheckCircle2 size={34} />
              <p>No {activeTab} reports. Queue is clear!</p>
            </div>
          )}
        </section>
      </div>
      {showTop && (
        <button className="scroll-top" onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Scroll to top">
          <ArrowUp size={18} />
        </button>
      )}
      {photo && (
        <button className="photo-viewer" onClick={() => setPhoto(null)} aria-label="Close photo viewer">
          <img src={photo} alt="Report photo" />
          <span>
            <X size={20} />
          </span>
        </button>
      )}
    </main>
  );
}

function AdminStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <strong style={{ color }}>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="moderation-card skeleton">
      <div className="skeleton-photo" />
      <div className="skeleton-lines">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ModerationCard({
  report,
  index,
  currentTab,
  onAction,
  onViewPhoto
}: {
  report: GarbageReport;
  index: number;
  currentTab: ModerationStatus;
  onAction: (decision: ModerationStatus) => void;
  onViewPhoto: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const severity = SEVERITY[report.severity] ?? SEVERITY.medium;
  const metadata = report.moderation_metadata ?? {};
  const reason = metadata.flag_reason || metadata.rejection_reason || "";
  const duplicate = reason === "potential_duplicate" && report._duplicate_original;

  const run = async (decision: ModerationStatus) => {
    setBusy(true);
    try {
      await onAction(decision);
    } finally {
      // Reset busy even if the parent handler rejects (error shown at panel level).
      setBusy(false);
    }
  };

  return (
    <article className="moderation-card" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="moderation-main">
        {report.photo_url ? (
          <button onClick={() => onViewPhoto(report.photo_url!)} aria-label="View full photo">
            <img src={report.photo_url} alt="" />
          </button>
        ) : (
          <span>No photo</span>
        )}
        <div>
          <h2>{report.address}</h2>
          <p>
            Ward #{report.ward_number} · {timeAgo(report.created_at)} · {report.upvote_count || 1} upvotes
          </p>
          <em style={{ background: `${severity.color}15`, color: severity.color }}>{severity.label}</em>
          {reason && <b>{reasonLabels[reason] ?? reason.replace(/_/g, " ")}</b>}
        </div>
      </div>
      {duplicate && <p className="duplicate-box">Possible Duplicate — Compare with existing report before approving.</p>}
      <button className="details-toggle" onClick={() => setExpanded(!expanded)}>
        Moderation details
        <ExternalLink size={13} />
      </button>
      {expanded && (
        <div className="moderation-details">
          {metadata.claude_check && (
            <p>
              <strong>Claude:</strong> {metadata.claude_check.is_civic_issue ? "Civic issue" : "Not civic issue"} (
              {Math.round((metadata.claude_check.confidence ?? 0) * 100)}%) — {metadata.claude_check.reason}
            </p>
          )}
          {metadata.text_check?.flags?.length ? (
            <p>
              <strong>Text:</strong> {metadata.text_check.severity} — {metadata.text_check.flags.join(", ")}
            </p>
          ) : null}
          {metadata.vision_safesearch && (
            <p>
              <strong>Vision:</strong> Adult: {metadata.vision_safesearch.adult}, Violence: {metadata.vision_safesearch.violence}, Racy:{" "}
              {metadata.vision_safesearch.racy}
            </p>
          )}
        </div>
      )}
      <div className="moderation-actions">
        {currentTab !== "approved" && (
          <button onClick={() => void run("approved")} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={13} /> : <CircleCheck size={13} />}
            {currentTab === "rejected" ? "Restore" : "Approve"}
          </button>
        )}
        {currentTab !== "rejected" && (
          <button onClick={() => void run("rejected")} disabled={busy} className="reject">
            {busy ? <LoaderCircle className="spin" size={13} /> : <CircleX size={13} />}
            Reject
          </button>
        )}
      </div>
    </article>
  );
}
