import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminPanel } from "../../src/components/AdminPanel";
import type { GarbageReport } from "../../src/types/domain";

const backendMocks = vi.hoisted(() => ({
  adminStats: vi.fn(),
  adminQueue: vi.fn(),
  moderateReport: vi.fn(),
  bulkModerate: vi.fn(),
  subscribeToAdminChanges: vi.fn(() => () => undefined)
}));

vi.mock("../../src/services/backend", () => ({
  backend: backendMocks
}));

const stats = { total: 0, flagged: 0, rejected: 0, approved: 0 };
const emptyPage = { reports: [], hasMore: false };

function makeReport(overrides: Partial<GarbageReport> = {}): GarbageReport {
  return {
    id: "r1",
    latitude: 20.29605,
    longitude: 85.8245,
    ward_number: 10,
    address: "Test Address",
    severity: "medium",
    category: "mixed",
    status: "unresolved",
    upvote_count: 1,
    created_at: new Date().toISOString(),
    moderation_status: "flagged",
    ...overrides
  };
}

async function renderLoggedInAdmin(page: { reports: GarbageReport[]; hasMore?: boolean } = emptyPage) {
  backendMocks.adminQueue.mockResolvedValue(page);
  sessionStorage.setItem("nk_admin_key", "test-admin-key");
  render(<AdminPanel />);
  await screen.findByRole("button", { name: /Refresh queue/i });
  if (page.reports.length) {
    await screen.findByText(page.reports[0].address);
  } else {
    await screen.findByText(/No flagged reports/i);
  }
}

describe("AdminPanel", () => {
  beforeEach(() => {
    backendMocks.adminStats.mockReset().mockResolvedValue(stats);
    backendMocks.adminQueue.mockReset().mockResolvedValue(emptyPage);
    backendMocks.moderateReport.mockReset().mockResolvedValue(undefined);
    backendMocks.bulkModerate.mockReset().mockResolvedValue(undefined);
    backendMocks.subscribeToAdminChanges.mockReset().mockReturnValue(() => undefined);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the admin login form", () => {
    render(<AdminPanel />);
    expect(screen.getByAltText("Amma Odisha")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Amma Odisha Moderation/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Admin key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
  });

  it("keeps the current tab while vertically scrolling with sideways drift", async () => {
    await renderLoggedInAdmin();

    fireEvent.click(screen.getByRole("button", { name: /Approved/i }));
    await screen.findByText(/No approved reports/i);

    const list = document.querySelector(".admin-list");
    expect(list).toBeInTheDocument();

    fireEvent.touchStart(list!, { touches: [{ clientX: 120, clientY: 100 }] });
    fireEvent.touchEnd(list!, { changedTouches: [{ clientX: 220, clientY: 700 }] });

    expect(screen.getByRole("button", { name: /Approved/i })).toHaveClass("is-active");
    expect(screen.getByText(/No approved reports/i)).toBeInTheDocument();
  });

  it("still supports deliberate horizontal tab swipes", async () => {
    await renderLoggedInAdmin();

    fireEvent.click(screen.getByRole("button", { name: /Approved/i }));
    await screen.findByText(/No approved reports/i);

    const list = document.querySelector(".admin-list");
    expect(list).toBeInTheDocument();

    fireEvent.touchStart(list!, { touches: [{ clientX: 120, clientY: 100 }] });
    fireEvent.touchEnd(list!, { changedTouches: [{ clientX: 220, clientY: 108 }] });

    expect(screen.getByRole("button", { name: /Rejected/i })).toHaveClass("is-active");
    expect(await screen.findByText(/No rejected reports/i)).toBeInTheDocument();
  });

  it("fires the reject API immediately on confirm and removes the card optimistically", async () => {
    await renderLoggedInAdmin({ reports: [makeReport()] });

    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "Duplicate" } });
    fireEvent.change(screen.getByLabelText(/rejection note/i), { target: { value: "same spot" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm reject/i }));

    await waitFor(() =>
      expect(backendMocks.moderateReport).toHaveBeenCalledWith("test-admin-key", "r1", "rejected", {
        rejectionReason: "Duplicate: same spot"
      })
    );
    expect(screen.queryByText(/Test Address/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("undo re-approves the rejected report and restores the card", async () => {
    await renderLoggedInAdmin({ reports: [makeReport()] });

    fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /confirm reject/i }));
    await waitFor(() => expect(backendMocks.moderateReport).toHaveBeenCalledTimes(1));

    backendMocks.moderateReport.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    await waitFor(() => expect(backendMocks.moderateReport).toHaveBeenCalledWith("test-admin-key", "r1", "approved"));
    expect(await screen.findByText(/Test Address/i)).toBeInTheDocument();
  });

  it("blocks Approve All unless the confirm dialog is accepted", async () => {
    await renderLoggedInAdmin({
      reports: [
        makeReport({ id: "r1", address: "Address One" }),
        makeReport({ id: "r2", address: "Address Two" }),
        makeReport({ id: "r3", address: "Address Three" }),
        makeReport({ id: "r4", address: "Address Four" })
      ]
    });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /Approve All/i }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("4"));
    expect(backendMocks.bulkModerate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /Approve All/i }));

    await waitFor(() =>
      expect(backendMocks.bulkModerate).toHaveBeenCalledWith("test-admin-key", ["r1", "r2", "r3", "r4"], "approved")
    );
  });

  it("closes the fullscreen photo viewer with Escape", async () => {
    await renderLoggedInAdmin({
      reports: [makeReport({ photo_url: "https://example.com/full.jpg", photo_thumb_url: "https://example.com/thumb.jpg" })]
    });

    fireEvent.click(screen.getByRole("button", { name: /view full photo/i }));
    expect(screen.getByAltText("Report photo")).toHaveAttribute("src", "https://example.com/thumb.jpg");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByAltText("Report photo")).not.toBeInTheDocument();
  });
});
