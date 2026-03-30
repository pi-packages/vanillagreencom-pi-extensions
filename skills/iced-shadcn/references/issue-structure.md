# Foundation Issue Structure

Create a foundation issue before leaf issues when 2+ components depend on the same primitive.

## Trigger Conditions

- A current leaf issue requires viewer-only hacks to prove behavior
- Width/open/dismiss/submenu logic would otherwise be duplicated
- A shared primitive change would unblock multiple component issues

## Recommended Shape

Parent bundle:
- Existing component rollout bundle

Foundation child:
- `Foundation: shared menu primitives for overlay-driven components`

Dependent leaves:
- Context Menu
- Dropdown Menu / Select
- Combobox
- Any other component that reuses the same primitive family

## Description Shape

```
## Summary
[why the family-level issue exists]

## Requirements
- [ ] Extract the shared primitives and state ownership
- [ ] Define wrapper component boundaries
- [ ] Add widget-level tests for the shared behavior
- [ ] Update or create viewer pages only after the shared layer is real

## Context
- Base UI behavior truth
- Iced framework constraints
- External reference code used for study
```

## Labels

Apply your project's standard component/design labels. See `issue-guidance.md` for additional label guidance.
