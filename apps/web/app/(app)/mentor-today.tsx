import Link from "next/link";
import { listBatches, getBatchDashboardToday, type Role } from "@irp/client";
import { cycleContaining, toProgrammeDate } from "@irp/core";
import { apiClient } from "@/lib/api-client";
import { CycleCalendar } from "@/components/cycle-calendar/cycle-calendar";
import { toBatchCalendarDays } from "@/lib/ribbon";
import { PageTitle } from "@/components/ui/page-title";
import { Panel } from "@/components/ui/panel";
import { SectionLabel } from "@/components/ui/section-label";
import { CountsRow } from "@/components/ui/counts-row";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCivilDateLabel } from "./format-civil-date";

/**
 * FR-28, must-ship (SC-4). One shared calendar for a selected batch, with a
 * batch-selector chip row when the mentor has more than one (D3, O-17) --
 * replacing the earlier one-ribbon-per-batch stack. "N of M submitted" and
 * the late/absent/missed counts sit beside it, all of it above the fold at
 * 1280x800 (docs/design-system.md §8.1).
 */
export async function MentorToday({
  displayName,
  role,
  batchId,
}: {
  displayName: string;
  role: Role;
  batchId?: string;
}) {
  const client = await apiClient();
  const { data: batches, error: batchesError } = await listBatches({ client });

  const identity = (
    <>
      {/* e2e/signin.spec.ts asserts both on every role. Visually hidden — the
          Topbar already shows the name, and a mentor knows they are a mentor. */}
      <span className="sr-only" data-testid="user-name">{displayName}</span>
      <span className="sr-only" data-testid="user-role">{role}</span>
    </>
  );

  if (batchesError !== undefined) {
    return (
      <div>
        <PageTitle>Today</PageTitle>
        {identity}
        <Panel>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {batchesError.detail ?? batchesError.title}
          </p>
        </Panel>
      </div>
    );
  }

  if (batches === undefined || batches.length === 0) {
    return (
      <div>
        <PageTitle>Today</PageTitle>
        {identity}
        <Panel>
          <EmptyState title="No batches yet." hint="Create one from the Students page." />
        </Panel>
      </div>
    );
  }

  // Same fallback the Cycles page uses: the named batch if it exists, else
  // the first by listBatches' own order -- never an empty selection.
  const selected = batches.find((b) => b.id === batchId) ?? batches[0]!;
  const { data: d, error } = await getBatchDashboardToday({ client, path: { id: selected.id } });

  const label =
    d?.cycle.seq === null
      ? `${selected.name} · first evaluated cycle opens ${formatCivilDateLabel(d.cycle.startDate)}`
      : d !== undefined
        ? `${selected.name} · Cycle ${String(d.cycle.seq)} · Day ${String(d.dayNumber)} of ${String(d.cycle.requiredDayCount)}`
        : selected.name;

  return (
    <div>
      <PageTitle>Today</PageTitle>
      {identity}

      {batches.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {batches.map((b) => (
            <Link
              key={b.id}
              href={{ pathname: "/", query: { batchId: b.id } }}
              aria-current={b.id === selected.id ? "page" : undefined}
              className="chip"
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {error !== undefined || d === undefined ? (
        <Panel title={selected.name}>
          <p role="alert" style={{ color: "var(--st-missed)" }}>
            {error?.detail ?? error?.title ?? "This batch's figures could not be loaded."}
          </p>
        </Panel>
      ) : (
        <section aria-label={selected.name}>
          {/* ASSUMPTION: O-17 -- the calendar replaces the ribbon; no FR asks for it. */}
          <CycleCalendar
            weeks={toBatchCalendarDays(
              cycleContaining(toProgrammeDate(new Date())),
              [...d.days],
              [...d.extraAfter],
              d.date,
            )}
            label={label}
          />

          <div className="mt-3">
            <CountsRow
              items={[
                {
                  tone: "ink",
                  strong: true,
                  text: `${String(d.counts.submitted)} of ${String(d.counts.enrolled)} submitted`,
                  testId: `submitted-count-${selected.id}`,
                },
                { tone: "late", text: `${String(d.counts.late)} late`, testId: `late-count-${selected.id}` },
                { tone: "absent", text: `${String(d.counts.absent)} absent`, testId: `absent-count-${selected.id}` },
                { tone: "missed", text: `${String(d.counts.missed)} missed`, testId: `missed-count-${selected.id}` },
                ...(d.extraCount > 0
                  ? [{ tone: "muted" as const, text: `+${String(d.extraCount)} extra this cycle` }]
                  : []),
              ]}
            />
          </div>

          <div className="mt-1" data-testid={`day-label-${selected.id}`} data-date={d.date}>
            <SectionLabel>
              {formatCivilDateLabel(d.date)}
              {d.isFallbackDay && " · the last required day, not today"}
            </SectionLabel>
          </div>
        </section>
      )}
    </div>
  );
}
