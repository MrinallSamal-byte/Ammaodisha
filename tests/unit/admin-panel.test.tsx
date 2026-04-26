import { fireEvent, render, screen } from "@testing-library/react";
import { AdminPanel } from "../../src/components/AdminPanel";
import { backend } from "../../src/services/backend";

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
});
