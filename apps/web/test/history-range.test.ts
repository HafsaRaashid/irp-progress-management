import { describe, expect, it } from "vitest";
import { civilDate } from "@irp/core";
import { historyRangeFor } from "@/lib/history-range";

describe("historyRangeFor", () => {
  it("widens `from` to the open submission window's oldest target when it falls in the previous cycle", () => {
    // Monday the 10th is a cycle boundary: the previous weekday, Friday the
    // 7th, is still inside its grace window and still targetable, but it
    // falls in the PREVIOUS cycle -- the exact bug the reviewer found
    // (C-2): a query scoped to only the current cycle's bounds silently
    // drops that day's entries from the student's own history.
    const range = historyRangeFor(
      { targetDates: [civilDate("2026-08-10"), civilDate("2026-08-07")], graceClosesAt: new Date() },
      { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") },
    );
    expect(range.from).toBe("2026-08-07");
    expect(range.to).toBe("2026-09-09");
  });

  it("uses the cycle's own start when the window's oldest target is already inside it", () => {
    const range = historyRangeFor(
      { targetDates: [civilDate("2026-08-20"), civilDate("2026-08-19")], graceClosesAt: new Date() },
      { start: civilDate("2026-08-10"), end: civilDate("2026-09-09") },
    );
    expect(range.from).toBe("2026-08-10");
    expect(range.to).toBe("2026-09-09");
  });
});
