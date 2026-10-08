/**
 * The one table vocabulary — docs/design-system.md §4 (13px body, tabular
 * figures for numbers) and §8.1's roster. Roster, Cycles and Students each
 * hand-rolled the identical `w-full text-[13px]` / muted `<th>` / `border-top
 * 1px var(--line)` chrome; this is that chrome, once.
 *
 * `numeric` on a cell selects right alignment and tabular figures — a column
 * of counts that does not line up is the specific thing §4's tabular-figures
 * rule exists to prevent. Pass it on the `Th` as well as the `Td`, or the
 * header sits left while its value sits right and reads as belonging to the
 * next column along.
 *
 * Horizontal padding is `px-3` (12px), the TOP of design-system §5's "roster
 * uses 8–12px row padding" range, while vertical stays `py-2` (8px). At
 * `px-2` both ways a right-aligned column's value ended up 16px from the next
 * left-aligned column's — the roster's Entries count read as though it were
 * in Extra. Vertical density is the "dense core" signal in §5 and is
 * deliberately not loosened with it.
 *
 * A `numeric` cell then takes `pr-6` (24px) instead of `pr-3`, so its
 * right-aligned value is INSET from the boundary rather than parked against
 * it. §5's 12px ceiling is a row-padding budget and 12px symmetric was not
 * enough here: a right-then-left column pair aligns its two values TOWARD
 * each other by construction, so a short glyph on each side of the boundary
 * reads as one unit however wide the columns are. The roster's `—` under
 * Extra (cycle) and `—` under Absence reason were the case that proved it —
 * 24px apart and still reading as the pair `— —`. Header and cell both carry
 * it, so they stay aligned with each other; the numeric column's own LEFT
 * gap stays 12px, because the column before it is left-aligned and its text
 * ends nowhere near the boundary.
 */
import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * `fixed` is opt-in (2026-10-09, the Users page) rather than the default:
 * `table-layout: fixed` with no column widths divides the available width
 * EQUALLY between columns, which is what an evenly balanced directory wants
 * but not what Roster and Cycles want -- those carry short numeric columns
 * beside long prose ones and are better served by auto layout sizing each to
 * its content. Opting in per table keeps both behaviours without a second
 * component.
 */
export function Table({ children, fixed = false }: { children: ReactNode; fixed?: boolean }) {
  return (
    <table className={`w-full text-[13px] ${fixed ? "table-fixed" : ""}`} style={{ color: "var(--ink)" }}>
      {children}
    </table>
  );
}

export function Th({
  children,
  numeric = false,
  ...rest
}: { children: ReactNode; numeric?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      scope="col"
      className={`py-2 pl-3 font-normal ${numeric ? "pr-6 text-right" : "pr-3 text-left"}`}
      style={{ color: "var(--ink-muted)" }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  ...rest
}: { children: ReactNode; numeric?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td {...rest} className={`py-2 pl-3 ${numeric ? "pr-6 tabular text-right" : "pr-3"}`}>
      {children}
    </td>
  );
}
