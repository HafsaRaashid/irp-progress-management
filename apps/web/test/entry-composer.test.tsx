import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntryComposer } from "@/app/(app)/entry-composer";

// vi.mock's factory is hoisted above this file's other statements, so it
// cannot close over a plain top-level `const` -- vi.hoisted() runs first and
// hands back a reference the factory can use safely.
const { submitEntry } = vi.hoisted(() => ({ submitEntry: vi.fn() }));

// entry-composer.tsx imports submitEntry via the relative specifier
// "./entry-actions". Vitest's mock registry keys by resolved absolute
// module, so mocking through the "@/" alias here replaces the same file
// regardless of which specifier each side spells it with.
vi.mock("@/app/(app)/entry-actions", () => ({ submitEntry }));

describe("EntryComposer", () => {
  it("offers only the given target dates as options, most recent first", () => {
    render(<EntryComposer targetDates={["2026-07-31", "2026-07-30"]} />);
    const select = screen.getByLabelText("Entry date");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["2026-07-31", "2026-07-30"]);
  });

  it("defaults to the most recent offered date -- today, the untouched fast path", () => {
    // Regression guard: an earlier version defaulted to index length-1 (the
    // OLDEST target, since targetDates is most-recent-first), so the
    // untouched fast path filed today's work against yesterday's date and
    // the API flagged it Late.
    render(<EntryComposer targetDates={["2026-07-31", "2026-07-30"]} />);
    expect(screen.getByLabelText("Entry date")).toHaveValue("2026-07-31");
  });

  it("renders no error before any submission", () => {
    render(<EntryComposer targetDates={["2026-07-31"]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no confirmation before any submission", () => {
    // The mirror of the case above, and it is the one that matters more:
    // useActionState is seeded with `null`, and a confirmation branch that
    // forgot to narrow on it would greet a student with "Submitted." before
    // they had typed anything. Every other test in this file would stay
    // green while that happened.
    render(<EntryComposer targetDates={["2026-07-31"]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("surfaces the action's error message as a role=alert on failure", async () => {
    submitEntry.mockResolvedValueOnce({ error: "The entry was not accepted." });
    render(<EntryComposer targetDates={["2026-07-31"]} />);

    fireEvent.change(screen.getByLabelText("Entry text"), {
      target: { value: "Worked on the composer." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The entry was not accepted.");
  });

  it("confirms a successful submission as a role=status", async () => {
    // submitEntry used to resolve to `null` on success, so a successful
    // submission was completely silent -- indistinguishable from a click
    // that never reached the server. "Submitted." is the wording
    // design-system.md section 11 requires: an action keeps its name
    // through the whole flow.
    submitEntry.mockResolvedValueOnce({ ok: true });
    render(<EntryComposer targetDates={["2026-07-31"]} />);

    fireEvent.change(screen.getByLabelText("Entry text"), {
      target: { value: "Worked on the composer." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Submitted.");
    // The two branches are mutually exclusive -- a success must not also
    // light the error line.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the textarea once a submission succeeds", async () => {
    // OBSERVED, not assumed (the Task 4 plan asks for exactly this check).
    // Measured on 2026-10-06 in Chromium against `next dev` on
    // localhost:3100, signed in as dev-student-1: a real entry submitted
    // through the real server action left the textarea empty, both
    // immediately and 1.5s later, with "Submitted." still on screen.
    //
    // Nothing in this component does that -- React 19 resets an uncontrolled
    // <form action={fn}> itself once the action resolves. So no useRef /
    // form.reset() was added: it would be a second mechanism racing one that
    // already works. That also makes the behaviour React's to change, not
    // ours, which is the whole reason it is pinned here: an upgrade that
    // stopped resetting would leave the just-submitted body sitting in the
    // box underneath the word "Submitted.", and a stale body under a
    // confirmation reads as a FAILED submit -- the exact ambiguity this
    // task exists to remove.
    submitEntry.mockResolvedValueOnce({ ok: true });
    render(<EntryComposer targetDates={["2026-07-31"]} />);

    const textarea = screen.getByLabelText("Entry text");
    fireEvent.change(textarea, { target: { value: "Worked on the composer." } });
    expect(textarea).toHaveValue("Worked on the composer.");

    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    await screen.findByRole("status");
    expect(textarea).toHaveValue("");
  });

  it("submits the selected date and body through the action", async () => {
    submitEntry.mockResolvedValueOnce({ ok: true });
    render(<EntryComposer targetDates={["2026-07-31"]} />);

    fireEvent.change(screen.getByLabelText("Entry text"), {
      target: { value: "Worked on the composer." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    await screen.findByRole("button", { name: "Submit update" });
    expect(submitEntry).toHaveBeenCalled();
    const [, formData] = submitEntry.mock.calls[0] as [unknown, FormData];
    expect(formData.get("entryDate")).toBe("2026-07-31");
    expect(formData.get("body")).toBe("Worked on the composer.");
  });
});
