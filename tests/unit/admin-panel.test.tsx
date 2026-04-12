import { render, screen } from "@testing-library/react";
import { AdminPanel } from "../../src/components/AdminPanel";

describe("AdminPanel", () => {
  it("renders the admin login form", () => {
    render(<AdminPanel />);
    expect(screen.getByAltText("Moderator")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Admin key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
  });
});
