import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EntryComposer } from "@/app/(app)/entry-composer";

// vi.mock's factory is hoisted above this file's other statements, so it
// cannot close over a plain top-level `const` -- vi.hoisted() runs first and
// hands back a reference the factory can use safely.
const { submitEntry, markAbsent } = vi.hoisted(() => ({
  submitEntry: vi.fn(),
  markAbsent: vi.fn(),
}));

// entry-composer.tsx imports submitEntry via the relative specifier
// "./entry-actions". Vitest's mock registry keys by resolved absolute
// module, so mocking through the "@/" alias here replaces the same file
// regardless of which specifier each side spells it with.
vi.mock("@/app/(app)/entry-actions", () => ({ submitEntry, markAbsent }));

describe("EntryComposer", () => {
  it("offers only the given target dates as options, most recent first", () => {
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }, { date: "2026-07-30", canBeAbsent: true }]} />);
    const select = screen.getByLabelText("Entry date");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["2026-07-31", "2026-07-30"]);
  });

  it("defaults to the most recent offered date -- today, the untouched fast path", () => {
    // Regression guard: an earlier version defaulted to index length-1 (the
    // OLDEST target, since targetDates is most-recent-first), so the
    // untouched fast path filed today's work against yesterday's date and
    // the API flagged it Late.
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }, { date: "2026-07-30", canBeAbsent: true }]} />);
    expect(screen.getByLabelText("Entry date")).toHaveValue("2026-07-31");
  });

  it("renders no error before any submission", () => {
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no confirmation before any submission", () => {
    // The mirror of the case above, and it is the one that matters more:
    // useActionState is seeded with `null`, and a confirmation branch that
    // forgot to narrow on it would greet a student with "Submitted." before
    // they had typed anything. Every other test in this file would stay
    // green while that happened.
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("surfaces the action's error message as a role=alert on failure", async () => {
    submitEntry.mockResolvedValueOnce({ error: "The entry was not accepted." });
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);

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
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);

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
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);

    const textarea = screen.getByLabelText("Entry text");
    fireEvent.change(textarea, { target: { value: "Worked on the composer." } });
    expect(textarea).toHaveValue("Worked on the composer.");

    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    await screen.findByRole("status");
    expect(textarea).toHaveValue("");
  });

  it("keeps the typed body when a submission is REJECTED, so the student need not retype it", async () => {
    // The counterpart to the reset above, and the reason that reset needs a
    // limit. React 19 resets the form when the action COMPLETES, not when it
    // SUCCEEDS -- so before this was fixed, a rejected entry cleared the
    // textarea too: the student read "the submission window is closed" and
    // found the update they had just written had been thrown away.
    //
    // That bites hardest against a grace-window deadline, which is exactly
    // when a submission is most likely to be rejected and the typed text
    // most expensive to lose. The action now carries the rejected body back
    // and the textarea re-seeds from it.
    submitEntry.mockResolvedValueOnce({
      error: "The submission window for 2026-01-05 is closed.",
      body: "A full afternoon of work I do not want to retype.",
    });
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);

    const textarea = screen.getByLabelText("Entry text");
    fireEvent.change(textarea, {
      target: { value: "A full afternoon of work I do not want to retype." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

    // The error is shown AND the work survives. Both halves matter: showing
    // the error while discarding the text is the defect, not the fix.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The submission window for 2026-01-05 is closed.");
    expect(textarea).toHaveValue("A full afternoon of work I do not want to retype.");
  });

  it("submits the selected date and body through the action", async () => {
    submitEntry.mockResolvedValueOnce({ ok: true });
    render(<EntryComposer targets={[{ date: "2026-07-31", canBeAbsent: true }]} />);

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

  /**
   * Marking absent moved here from the day cards, because this control
   * already owns the date picker and "submit an update" / "I was absent" are
   * two answers to the same question.
   */
  describe("marking absent", () => {
    const targets = [
      { date: "2026-07-31", canBeAbsent: true },
      { date: "2026-08-01", canBeAbsent: false },
    ];

    it("offers Mark absent as a quiet button beside Submit, not a second competing primary", () => {
      render(<EntryComposer targets={targets} />);
      expect(screen.queryByRole("button", { name: "Record absence" })).not.toBeInTheDocument();
    });

    it("reveals a reason field capped at 500 chars, matching AbsenceCreate", () => {
      render(<EntryComposer targets={targets} />);
      fireEvent.click(screen.getByRole("button", { name: "Mark absent" }));
      const reason = screen.getByLabelText("Absence reason for 2026-07-31");
      expect(reason).toHaveAttribute("maxlength", "500");
      expect(screen.getByRole("button", { name: "Record absence" })).toBeInTheDocument();
    });

    /**
     * The glossary is explicit: absence does not apply to a weekend, because
     * there is nothing to be absent from. The submission window DOES carry
     * Saturday and Sunday on a Monday, so this is a real selection a student
     * can make — and the control disappears rather than letting the API
     * reject it, since it is not a mistake the student made.
     */
    it("hides the absence path entirely for a day that cannot carry one", () => {
      render(<EntryComposer targets={[{ date: "2026-08-01", canBeAbsent: false }]} />);
      expect(screen.queryByRole("button", { name: "Mark absent" })).not.toBeInTheDocument();
    });

    it("drops an open absence prompt when the date changes, so a typed reason cannot be filed against another day", () => {
      render(<EntryComposer targets={targets} />);
      fireEvent.click(screen.getByRole("button", { name: "Mark absent" }));
      expect(screen.getByLabelText("Absence reason for 2026-07-31")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("Entry date"), { target: { value: "2026-08-01" } });

      expect(screen.queryByLabelText(/Absence reason/)).not.toBeInTheDocument();
    });

    it("submits the selected date with the reason", async () => {
      markAbsent.mockResolvedValueOnce({ ok: true, reason: "Medical appointment" });
      render(<EntryComposer targets={targets} />);
      fireEvent.click(screen.getByRole("button", { name: "Mark absent" }));
      fireEvent.change(screen.getByLabelText("Absence reason for 2026-07-31"), {
        target: { value: "Medical appointment" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

      await screen.findByRole("button", { name: "Record absence" });
      expect(markAbsent).toHaveBeenCalled();
      const [, formData] = markAbsent.mock.calls[0] as [unknown, FormData];
      expect(formData.get("date")).toBe("2026-07-31");
      expect(formData.get("reason")).toBe("Medical appointment");
    });

    it("surfaces markAbsent's error as role=alert", async () => {
      markAbsent.mockResolvedValueOnce({ error: "The absence was not recorded." });
      render(<EntryComposer targets={targets} />);
      fireEvent.click(screen.getByRole("button", { name: "Mark absent" }));
      fireEvent.change(screen.getByLabelText("Absence reason for 2026-07-31"), {
        target: { value: "Sick" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("The absence was not recorded.");
    });

    /**
     * This was a silent success until the control moved. While marking lived
     * inside the day card, recording an absence visibly rewrote the panel the
     * button sat in. From the composer it does not — the result lands in a
     * card in another column — so the student clicked and saw nothing happen
     * where they were looking. Same defect as submitEntry's, reintroduced by
     * relocating the control.
     */
    it("confirms what it recorded, naming the reason back", async () => {
      markAbsent.mockResolvedValueOnce({ ok: true, reason: "Medical appointment" });
      render(<EntryComposer targets={targets} />);
      fireEvent.click(screen.getByRole("button", { name: "Mark absent" }));
      fireEvent.change(screen.getByLabelText("Absence reason for 2026-07-31"), {
        target: { value: "Medical appointment" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record absence" }));

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent("Marked absent");
      expect(status).toHaveTextContent("Medical appointment");
    });

    it("renders no absence confirmation before anything is recorded", () => {
      render(<EntryComposer targets={targets} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  /**
   * "Time spent in meetings" (FR-17, ADR-0033) -- optional, numeric, never
   * required. A student who skips it must submit exactly as before; nothing
   * here should ever block a submission.
   */
  describe("meeting minutes", () => {
    const targets = [{ date: "2026-07-31", canBeAbsent: true }];

    it("offers an optional minutes field, not required to submit", () => {
      render(<EntryComposer targets={targets} />);
      const field = screen.getByLabelText("Minutes in meetings (optional)");
      expect(field).not.toBeRequired();
      expect(field).toHaveAttribute("type", "number");
      // The server caps at 480 (ADR-0033); mirrored here so a student gets
      // immediate feedback rather than a round trip to learn the bound.
      expect(field).toHaveAttribute("min", "0");
      expect(field).toHaveAttribute("max", "480");
    });

    it("submits unset as nothing, never as the literal string '0' or empty", async () => {
      submitEntry.mockResolvedValueOnce({ ok: true });
      render(<EntryComposer targets={targets} />);
      fireEvent.change(screen.getByLabelText("Entry text"), { target: { value: "Worked on the composer." } });
      fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

      await screen.findByRole("status");
      // .at(-1), not [0]: submitEntry is a SHARED mock across every test in
      // this file (no per-test reset), so by the time this test runs,
      // calls[0] is some EARLIER test's invocation, not this one's.
      const [, formData] = submitEntry.mock.calls.at(-1) as [unknown, FormData];
      // An empty number input reports "" via FormData -- the action (not
      // this component) is responsible for turning that into "omit the
      // field", but the composer must hand it over as empty rather than
      // inventing a 0 the student never typed.
      expect(formData.get("meetingMinutes")).toBe("");
    });

    it("passes a typed value through to the action", async () => {
      submitEntry.mockResolvedValueOnce({ ok: true });
      render(<EntryComposer targets={targets} />);
      fireEvent.change(screen.getByLabelText("Entry text"), { target: { value: "Worked on the composer." } });
      fireEvent.change(screen.getByLabelText("Minutes in meetings (optional)"), { target: { value: "45" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

      await screen.findByRole("status");
      // .at(-1), not [0]: submitEntry is a SHARED mock across every test in
      // this file (no per-test reset), so by the time this test runs,
      // calls[0] is some EARLIER test's invocation, not this one's.
      const [, formData] = submitEntry.mock.calls.at(-1) as [unknown, FormData];
      expect(formData.get("meetingMinutes")).toBe("45");
    });

    /**
     * The same text-loss bug Task 4b fixed for the body must not reopen here:
     * a rejected submission has to hand BOTH fields back, or a student who
     * filled in meeting minutes loses that half silently while the body is
     * correctly restored beside it.
     */
    it("re-seeds minutes (not just the body) after a rejected submission", async () => {
      submitEntry.mockResolvedValueOnce({
        error: "The submission window is closed.",
        body: "Worked on the composer.",
        meetingMinutes: 45,
      });
      render(<EntryComposer targets={targets} />);

      fireEvent.change(screen.getByLabelText("Entry text"), { target: { value: "Worked on the composer." } });
      fireEvent.change(screen.getByLabelText("Minutes in meetings (optional)"), { target: { value: "45" } });
      fireEvent.click(screen.getByRole("button", { name: "Submit update" }));

      await screen.findByRole("alert");
      expect(screen.getByLabelText("Entry text")).toHaveValue("Worked on the composer.");
      expect(screen.getByLabelText("Minutes in meetings (optional)")).toHaveValue(45);
    });
  });
});
