import { act, fireEvent, render, screen } from "@testing-library/react";
import { AdminPanel } from "../../src/components/AdminPanel";
import { backend } from "../../src/services/backend";
import type { GarbageReport, ModerationStatus } from "../../src/types/domain";

vi.mock("../../src/services/backend", () => ({
  backend: {
    adminStats: vi.fn(),
    adminQueue: vi.fn(),
    moderateReport: vi.fn(),
    bulkModerate: vi.fn(),
    subscribeToAdminChanges: vi.fn(() => () => undefined)
  }
}));

const mockedBackend = vi.mocked(backend);
const stats = { total: 0, flagged: 0, rejected: 0, approved: 0 };

async function renderLoggedInAdmin() {
  sessionStorage.setItem("nk_admin_key", "test-admin-key");
  render(<AdminPanel />);
  await screen.findByText(/No flagged reports/i);
}

describe("AdminPanel", () => {
  beforeEach(() => {
    mockedBackend.adminStats.mockResolvedValue(stats);
    mockedBackend.adminQueue.mockImplementation(async () => []);
    mockedBackend.subscribeToAdminChanges.mockReturnValue(() => undefined);
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

  it("asks for confirmation before bulk-approving flagged reports", async () => {
    const flaggedReports = Array.from({ length: 4 }, (_, index): GarbageReport => ({
      id: `report-${index}`,
      latitude: 20.296,
      longitude: 85.824,
      ward_number: 40,
      address: `Dump spot ${index}`,
      severity: "medium",
      category: "mixed",
      status: "unresolved",
      created_at: new Date(Date.now() - index * 86_400_000).toISOString(),
      upvote_count: 1,
      moderation_status: "flagged"
    }));
    mockedBackend.adminQueue.mockImplementation(async (_key: string, status: ModerationStatus) => (status === "flagged" ? flaggedReports : []));

    sessionStorage.setItem("nk_admin_key", "test-admin-key");
    render(<AdminPanel />);
    await screen.findByText(/Dump spot 0/);

    fireEvent.click(screen.getByRole("button", { name: /Approve All 4 Flagged/i }));
    expect(await screen.findByText(/Approve 4 flagged reports\?/i)).toBeInTheDocument();
    expect(mockedBackend.bulkModerate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Approve 4$/i }));
    await screen.findByText(/No flagged reports/i);
    expect(mockedBackend.bulkModerate).toHaveBeenCalledWith(
      "test-admin-key",
      ["report-0", "report-1", "report-2", "report-3"],
      "approved"
    );
  });

  it("rejects once when the queue removes the card after the undo window", async () => {
    const report: GarbageReport = {
      id: "report-1",
      latitude: 20.296,
      longitude: 85.824,
      ward_number: 40,
      address: "Dump spot 1",
      severity: "medium",
      category: "mixed",
      status: "unresolved",
      created_at: new Date().toISOString(),
      upvote_count: 1,
      moderation_status: "flagged"
    };
    mockedBackend.adminQueue.mockImplementation(async (_key: string, status: ModerationStatus) => (status === "flagged" ? [report] : []));
    mockedBackend.moderateReport.mockClear();
    mockedBackend.moderateReport.mockResolvedValue(undefined);

    sessionStorage.setItem("nk_admin_key", "test-admin-key");
    render(<AdminPanel />);
    await screen.findByText("Dump spot 1");

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: /^Reject$/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(mockedBackend.moderateReport).toHaveBeenCalledTimes(1);
    expect(mockedBackend.moderateReport).toHaveBeenCalledWith("test-admin-key", "report-1", "rejected");
  });
});
