# Component Parity Issue Guidance

## Parenting

- If a component parity rollout bundle already exists under the active parent issue, create the new follow-up issue beneath that bundle.
- If the original component issue is still the correct implementation vehicle, add a comment first and only create a new issue when the follow-up scope is materially separate.
- Keep implementation issues and audit issues distinct when possible.

## Labels

Apply your project's standard component/design labels. See `issue-structure.md` § Labels for additional context.

## Description Shape

Use the standard issue format: `## Summary`, `## Requirements`, `## Context`.

Include:
- The reference source (shadcn Base UI)
- A `Base UI tab confirmed` note with screenshot evidence
- The exact reference example headings and which local section each maps to
- The specific local files likely to change
- Any extra local sections or missing reference sections, each with a justification
- Specific interaction/layout deviations being closed (hit target, separator treatment, alignment, type hierarchy, outline removal)
- Any new semantic component token/role contracts or shared motion primitives
- Specific examples/behaviors to add or close
- Any justified gaps already known

## Original Issue Comment

Before or alongside issue creation, comment on the original component issue with:
- The reference target used
- The concrete behavior/style/page gaps found
- The planned follow-up scope

## Closure Gate

See `checklist.md` § Deliverables. If visual or behavioral review shows the result missed parity, reopen the issue and comment on the failure explicitly.
