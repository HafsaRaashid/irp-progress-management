import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsPage from "@/app/(app)/settings/page";

const { getCurrentUserOrRedirect, apiClient } = vi.hoisted(() => ({
  getCurrentUserOrRedirect: vi.fn(),
  apiClient: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ getCurrentUserOrRedirect, apiClient }));

const { cookies } = vi.hoisted(() => ({ cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies }));

const ADMIN_USER = { id: "1", email: "m@x.test", displayName: "Dev Mentor", role: "Admin" as const };
const STUDENT_USER = { id: "2", email: "s@x.test", displayName: "Dev Student", role: "Student" as const };

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.mockResolvedValue({});
  cookies.mockResolvedValue({ get: () => ({ name: "irp-theme", value: "dark" }) });
  // ThemeControl reconciles its radio from the live `<html data-theme>`
  // attribute after mount (Plan 7B, Task 9 — see theme-control.tsx). In the
  // real app that attribute is always stamped by the SAME root layout render
  // that computes this page's `current` prop, from the same cookie, so the
  // two never disagree. This test file renders SettingsPage in isolation,
  // with no root layout in the tree to stamp the attribute, so it is cleared
  // here as the default baseline and set explicitly wherever a test needs the
  // page to agree with a "dark" cookie.
  delete document.documentElement.dataset.theme;
});

/**
 * ADR-0034 (2026-10-08) moved Register back to Students, the page it lived
 * on before ADR-0022 — joining Create batch, which already went back under
 * ADR-0023. Settings is Appearance-only now, for every role, with no
 * remaining per-section gate: the Register/batch-fetching behaviour these
 * tests used to cover lives in students-page.test.tsx instead, exercising
 * the same RegisterForm component now rendered there.
 */
describe("SettingsPage", () => {
  it("shows Appearance to a mentor", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    document.documentElement.dataset.theme = "dark";
    render(await SettingsPage());
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("shows Appearance to a student", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);
    document.documentElement.dataset.theme = "dark";
    render(await SettingsPage());
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
  });

  it("carries no Register or Create batch for either role — both moved to Users (ADR-0034)", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(ADMIN_USER);
    render(await SettingsPage());
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Batch name")).not.toBeInTheDocument();
  });

  it("falls back to system when no theme cookie is set", async () => {
    getCurrentUserOrRedirect.mockResolvedValue(STUDENT_USER);
    cookies.mockResolvedValue({ get: () => undefined });
    render(await SettingsPage());
    expect(screen.getByRole("radio", { name: "Follow system" })).toBeChecked();
  });
});
