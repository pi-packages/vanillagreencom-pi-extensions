# Viewer Component Page Template

The viewer/showcase shell owns the global page header and sidebar. Individual component pages should only define the body content.

## Page Contract

Each component page should compose a vertical stack of shared section blocks from your project's showcase UI helpers.

For parity-driven pages, mirror the reference example/section set first. Only add project-specific sections after the reference sections are represented or explicitly excluded in the parity checklist.

When the Base UI page exposes named example headings, use those headings and the same order directly (`Basic`, `Multiple`, `Disabled`, `Borders`, `Card`, `RTL`, etc.). Do not replace named reference examples with generic umbrella sections like `Variants`, `States`, or `Surface Variants`.

Only add project-specific sections after every reference heading is represented or explicitly excluded, and label those extras as local adaptations rather than reference parity.

## Layout Rules

- Use shared layout helpers from your project's showcase/UI module.
- Extend shared helpers only when a layout pattern will be reused across multiple component pages.
- Keep section widths and card widths tokenized through shared helper constants.
- Avoid bespoke page shells or per-page hero/header wrappers.
- Planned pages should use the shared placeholder pattern, not custom placeholder layouts.

## Behavior Ownership

- Real behavior belongs in widget modules.
- Demo-only state belongs in showcase/preview modules.
- Pages should only compose widgets plus preview state — they must not simulate capabilities the widget does not actually support.
- Every exposed variant must map end-to-end: `widget API → preview state → viewer page → tests`. If one link is missing, the variant is not ready to present as parity-complete.

## Parity Adaptation Rules

- Match reference behavior and examples where they fit Iced and your project.
- Adapt visuals to your project's tokens, fonts, density, and color system.
- Record every adaptation per example/heading instead of folding it into a generic "adapted to tokens" statement.
- Do not copy raw sizes, fonts, or site chrome from the reference implementation.
