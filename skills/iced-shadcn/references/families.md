# Component Families

Use family classification before creating or updating implementation issues.

## Menu Family

Components:
- Context Menu
- Dropdown Menu
- Select
- Combobox
- Menubar
- Navigation Menu

Shared primitives:
- menu entries (label, separator, item, checkbox, radio, submenu)
- overlay open/close state
- pointer anchor capture
- dismissal rules
- width / text measurement
- submenu positioning

## Overlay Family

Components:
- Popover
- Hover Card
- Tooltip
- Dialog
- Drawer
- Sheet

Shared primitives:
- anchor/placement
- viewport collision handling
- focus / dismissal
- overlay stacking

## Selection / Input Family

Components:
- Checkbox
- Radio Group
- Switch
- Toggle
- Toggle Group
- Input Group
- Textarea

Shared primitives:
- selection state contracts
- label wiring
- size/radius tokens
- grouped composition

## Display / Data Family

Components:
- Badge
- Card
- Separator
- Table
- Accordion
- Tabs
- Carousel

These are typically leaf-only — no shared primitive extraction needed unless 2+ components share non-trivial behavior.

## Leaf-Only Rule

Treat a component as leaf-only only when:
- it has no shared primitive changes
- it has no downstream dependent components
- its behavior can be implemented without duplicating another widget family
