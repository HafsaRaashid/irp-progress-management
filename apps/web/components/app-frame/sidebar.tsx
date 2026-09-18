"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import {
  TodayIcon, RosterIcon, CyclesIcon, StudentsIcon, SettingsIcon,
} from "@/components/ui/icons";

/**
 * The app frame's primary navigation. `navigation` landmark, 216px wide, on
 * `--surface` — docs/design-system.md §6. Desktop only (NFR-13); no
 * collapse/drawer treatment is provided in this task.
 *
 * `typedRoutes: true` (apps/web/next.config.ts) validates every `<Link
 * href>` against routes that actually exist. Every destination on both
 * lists is now a real link: Task 9 added `apps/web/app/(app)/page.tsx`
 * ("/", Today); Task 13 added `.../roster/page.tsx` (Roster); Task 15 added
 * `.../students/page.tsx` (Students); Task 7 added `.../cycles/page.tsx`
 * (Cycles); Task 8 added `.../my-month/page.tsx`, so "My month" joined the
 * others last. Each destination became a real `<Link href="...">` in the
 * task that added its page — no `as Route` cast was needed in the meantime.
 *
 * **"Review" was deliberately dropped from this list.** `.../review/page.tsx`
 * (added Task 14) has no student directory of its own — it only ever showed
 * "pick a student from the roster" with a link back to Roster, which is the
 * real directory. Every roster row already links straight to
 * `/review/[studentId]` (roster/page.tsx), so the nav item added a click that
 * went nowhere useful. `/review/page.tsx` and `/review/[studentId]` still
 * exist and are still reachable — only the sidebar entry pointing at the
 * empty landing page is gone. One consequence: visiting `/review/[studentId]`
 * no longer lights up anything in the sidebar (see `isActive`'s note below).
 *
 * The current destination is marked with `aria-current="page"` and the
 * `--primary-weak` active-nav fill §3.1 reserves for it. This is a client
 * component solely because that needs `usePathname`; nothing else here is
 * interactive.
 *
 * Navigation is role-gated, not just link-gated: a Student never sees
 * mentor-only destinations (Roster, Cycles, Students) at all, rather
 * than seeing them disabled. Students get their own two-item list.
 *
 * The label-only rendering branch below is kept even with no destination
 * currently using it: it is what lets a future destination be added to
 * either list before its page exists, without an `as Route` cast.
 *
 * `Destination` is a real union, not inferred from the array literals: once
 * every entry on both lists carries an `href`, inference alone would narrow
 * `"href" in d ? ... : ...`'s else branch to `never` and the label-only
 * rendering path would fail to typecheck even though it must stay reachable
 * for a future label-only entry.
 */
/** Every destination carries an icon, including the label-only branch — a
    future entry rendering without one would sit misaligned against every
    other row. */
interface LinkedDestination {
  readonly label: string;
  readonly href: Route;
  readonly icon: () => ReactElement;
}
interface LabelOnlyDestination {
  readonly label: string;
  readonly icon: () => ReactElement;
}
type Destination = LinkedDestination | LabelOnlyDestination;

const MENTOR_DESTINATIONS: readonly Destination[] = [
  { label: "Today", href: "/", icon: TodayIcon },
  { label: "Roster", href: "/roster", icon: RosterIcon },
  { label: "Cycles", href: "/cycles", icon: CyclesIcon },
  { label: "Students", href: "/students", icon: StudentsIcon },
];

const STUDENT_DESTINATIONS: readonly Destination[] = [
  { label: "Today", href: "/", icon: TodayIcon },
  { label: "My month", href: "/my-month", icon: CyclesIcon },
];

/**
 * Settings is NOT appended to either role list. Those render in document order
 * inside a `flex flex-col`, so an appended entry would sit directly under the
 * last primary destination rather than at the bottom of the column.
 *
 * It is also on BOTH roles' frames: the theme is a personal preference, and the
 * page gates its mentor-only sections itself (settings/page.tsx). A Student
 * following this link gets a page with one section, not a redirect.
 */
const SETTINGS_DESTINATION: LinkedDestination = { label: "Settings", href: "/settings", icon: SettingsIcon };

/**
 * "/" must match exactly — every other path also starts with it, so a prefix
 * test would light up Today on every screen in the app. The prefix test is
 * what every other destination needs so a nested route (e.g. `/roster/x`, if
 * one existed) still marks its parent current.
 *
 * Note: `/review/[studentId]` matches nothing here now that "Review" is gone
 * from `MENTOR_DESTINATIONS` — reviewing a student no longer lights up any
 * nav item. That's a deliberate consequence of dropping the entry, not an
 * oversight; see the comment above `MENTOR_DESTINATIONS`.
 */
function isActive(pathname: string, href: Route): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  role,
  signOutSlot,
}: {
  role: "Admin" | "Student";
  /**
   * The sign-out form, rendered by the SERVER layout and passed in. This
   * component is a Client Component (usePathname), and `signOut` from
   * `@/auth` is server-side — importing it here would be a build error. A
   * ReactNode slot keeps the existing inline `"use server"` action intact.
   */
  signOutSlot?: ReactNode;
}) {
  const destinations = role === "Admin" ? MENTOR_DESTINATIONS : STUDENT_DESTINATIONS;
  // usePathname is why this is a client component. The alternative — threading
  // the path down from the server layout — is not available: a layout does not
  // re-render on navigation within its own segment, so the prop would go stale
  // exactly when the highlight needs to move.
  const pathname = usePathname();

  return (
    // shrink-0 so the fixed 216px column is never squeezed by a wide table in
    // the content area; overflow-y-auto so the nav itself scrolls rather than
    // overflowing the frame if the list ever outgrows a short viewport.
    <nav
      aria-label="Primary"
      className="flex shrink-0 flex-col gap-1 overflow-y-auto border-r p-4"
      style={{ width: "216px", background: "var(--surface)", borderColor: "var(--line)" }}
    >
      {destinations.map((d) => {
        if ("href" in d) {
          const active = isActive(pathname, d.href);
          const Glyph = d.icon;
          return (
            <Link
              key={d.label}
              href={d.href}
              // aria-current is the non-visual half of the same signal: §12
              // does not let colour alone carry meaning, and "which page am I
              // on" is meaning.
              aria-current={active ? "page" : undefined}
              className="nav-item"
              data-active={active || undefined}
            >
              <Glyph />
              {d.label}
            </Link>
          );
        }

        const Glyph = d.icon;
        return (
          <span key={d.label} aria-disabled="true" className="nav-item">
            <Glyph />
            {d.label}
          </span>
        );
      })}
      {/* mt-auto is what pins this to the bottom — a margin guess would drift
          as the primary list grows. The divider separates "where you work"
          from "how it looks". */}
      <div
        className="mt-auto border-t pt-1"
        style={{ borderColor: "var(--line)" }}
      >
        <Link
          href={SETTINGS_DESTINATION.href}
          aria-current={isActive(pathname, SETTINGS_DESTINATION.href) ? "page" : undefined}
          // `.nav-item` (globals.css) is itself `display: flex`, so this link is
          // already boxed identically to the .map()-rendered flex-item links
          // above regardless of the wrapper it sits in. The `block` utility
          // class below is a retained no-op, not load-bearing: `.nav-item`'s
          // declaration is unlayered CSS, which outranks `@layer utilities`
          // regardless of specificity, so Tailwind's `.block{display:block}`
          // never wins against it. Kept rather than removed so a future change
          // to `.nav-item` that drops its own `display` does not silently
          // un-blockify this one link with nothing here to catch it.
          className="nav-item block"
          data-active={isActive(pathname, SETTINGS_DESTINATION.href) || undefined}
        >
          <SettingsIcon />
          {SETTINGS_DESTINATION.label}
        </Link>
        {signOutSlot}
      </div>
    </nav>
  );
}
