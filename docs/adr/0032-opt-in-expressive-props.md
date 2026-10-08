# ADR-0032: Opt-in expressive props, named by behaviour

## Status
Accepted (2026-10-05). Records **D6** of
`docs/superpowers/specs/2026-10-05-student-surface-refresh-design.md`. Relates to
`docs/design-system.md` §5, §9 and §12, and to
[ADR-0020](0020-collapsed-ribbon-key-on-the-mentor-dashboard.md).

## Context
This slice makes the student surfaces warmer and more legible. The mentor surfaces are **not** part
of it, and are due their own redesign on a later branch.

The two roles do not have separate components. `EmptyState`, `CycleRibbon`, `StatusPill`,
`CountsRow` and `Panel` all render on both roles' screens, so any change to one of their **defaults**
is a change to the mentor's screen made by a plan that never looked at it. The premise of this slice
is that the mentor's view comes out unchanged, which makes "how does a shared component behave
differently on one surface" the question that has to be answered before any of the expressive work
starts.

Three constraints bound the answer. §9 asks for "one button vocabulary across every screen", so
forking a primitive per role is already ruled out by the design system. §5 couples `sunk` to density
— "rhythm **is** the density signal" — so surface modes are not free to multiply. And §12 keeps
status semantic, so nothing in the status vocabulary is available to be decorated at all.

## Decision
**Every new expressive treatment is a prop on the existing shared component, defaulted off.** The
mentor's rendering is unchanged because the default path is unchanged — not because the mentor's
surfaces were audited afterwards, but because nothing they render was altered.

**Props are named after what they do, never after who uses them.** No `studentMode`, no
student-scoped CSS, no student-only tokens. The reason is specific rather than stylistic: the mentor
surfaces are due their own redesign on a later branch, and anything named or scoped "student" would
have to be unpicked before that redesign could use it. A prop named for its behaviour is something
that redesign simply **turns on**; a prop named for a role is a renaming task standing in front of
it. `celebrate` describes what happens; `studentMode` describes who was in the room when it was
written.

| Component | Addition | Default |
|---|---|---|
| `EmptyState` | optional `icon` + CTA slot | none — renders exactly as today |
| `CycleRibbon` | `celebrate` | `false` |
| `StatusPill`, `CountsRow` | **nothing** | status is semantic |
| `Panel` | **nothing this slice** | see below |

`Panel` gains no `elevated`/`tone` prop. §5 already couples `sunk` to density, and a third surface
mode with no stated job is decoration. If the greeting band needs a distinct surface it gets one
locally, and a prop is proposed when a second caller exists.

**Each opt-in carries a characterisation test of its default path** — that the component renders
identically with the new prop unset. That test, not the diff, is what stops a default drifting later.

[ADR-0020](0020-collapsed-ribbon-key-on-the-mentor-dashboard.md) settled the mirror-image case the
other way round and is consistent with this: `RibbonKey` is mentor-only, and it is a separate
component the mentor dashboard renders once, not a `mentorMode` flag inside `CycleRibbon`. Either
way the role lives at the call site and never inside the shared component.

## Consequences
- The mentor's view comes out of this branch unchanged apart from `--primary`'s hue
  ([ADR-0030](0030-bistec-cerulean-as-the-brand-colour.md)), and that is checkable by diff rather
  than by assertion: no mentor page should appear in the branch's component diff at all.
- The later mentor redesign turns these props on where it wants them. It inherits no "student"
  naming to unpick and no scope attribute to remove.
- Every capability is two render paths, so every capability costs a default-off test. That is the
  price of not forking the primitive, and it is lower than the price §9 would charge for forking it.
- The opt-ins accumulate. If a prop is still defaulted off with one caller several slices from now,
  that is the signal to ask whether the treatment should become the default rather than to add a
  third flag beside it.

## Rejected alternatives
1. **A scope attribute on the student layout, plus CSS descendant rules.** One attribute on
   `(app)/layout` and the styling falls out of the cascade, with no component signature touched at
   all. Rejected because it makes a component's appearance depend on an **invisible ancestor** — the
   same defect in reasoning that the dev-bypass guards keep re-learning, where a property is assumed
   to hold because something upstream was supposed to provide it. It is also untestable where the
   components are tested: `test/ui-primitives.test.tsx` renders primitives in isolation, with no
   layout above them, so the student appearance would have no coverage at all.
2. **Separate student-only components.** A `StudentEmptyState` beside `EmptyState`, and so on.
   Complete isolation, and the mentor's path is provably untouched because it is a different file.
   Rejected because it violates §9's "one button vocabulary across every screen" directly, and
   doubles the maintained surface: every future fix to a primitive has to be made twice, and the
   second copy is the one that gets forgotten. `counts-row.tsx` already records where that ends —
   the status vocabulary reached four separate definitions before it was consolidated — three
   hand-rolled inline on pages, plus StatusPill's own.
3. **Make the treatments always-on.** No props, no defaults, no tests for a default path — the
   simplest code by a clear margin. Rejected because it changes the mentor view, which this slice's
   whole premise forbids. It would also decide the mentor redesign's questions on its behalf, from a
   branch that never opened a mentor screen.
