import { cookies } from "next/headers";
import { getCurrentUserOrRedirect } from "@/lib/api-client";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ThemeControl } from "./theme-control";

/**
 * Settings — Appearance only, for every role (ADR-0021, theme by cookie).
 *
 * Registration lived here from ADR-0022 (2026-08-04) until ADR-0034
 * (2026-10-08) moved it back to Students alongside Create batch, Transfer,
 * and the directory -- there was never a distinct "mentor management"
 * surface to justify keeping it apart (see ADR-0034, and
 * `docs/superpowers/specs/2026-10-08-mentor-users-page-design.md`). This
 * page no longer needs the per-section Admin gate that Register's presence
 * used to require: Appearance has always been for every role, so the whole
 * page now is too.
 */
export default async function SettingsPage() {
  // The call's side effect (redirecting an unauthenticated or unregistered
  // caller) is what this page needs -- there is no role branch left to read
  // the return value for, now that Register has moved off this page.
  await getCurrentUserOrRedirect();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div>
      <PageTitle>Settings</PageTitle>
      <div className="max-w-[640px]">
        <Panel title="Appearance">
          <ThemeControl current={theme} />
        </Panel>
      </div>
    </div>
  );
}
