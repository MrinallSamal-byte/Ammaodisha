import { render, screen } from "@testing-library/react";
import { AdminPanel } from "../../src/components/AdminPanel";

describe("AdminPanel", () => {
  it("renders the admin login form", () => {
    render(<AdminPanel />);
    expect(screen.getByAltText("Amma Odisha")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Amma Odisha Moderation/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Admin key")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
  });
});
