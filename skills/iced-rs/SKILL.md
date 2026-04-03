---
name: iced-rs
description: "Iced 0.14 (iced-rs) GUI framework patterns, widget rules, and API reference. Load when building, modifying, or debugging any Iced UI — views, widgets, Canvas, Shader, pane_grid, subscriptions, theming."
license: MIT
user-invocable: true
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# Iced 0.14

Patterns, API reference, and rules for building Iced 0.14 applications. Covers widgets, Canvas, Shader, pane_grid, subscriptions, theming, and the Elm architecture constraints that cause bugs when violated.

## Resources

**For ANY Iced documentation lookup — research, implementation, or verification — use `find-docs` skill with ctx7 CLI first.** Iced 0.14 has significant API changes. Never assume — always verify.

Documentation lookup order: local skill files → ctx7 CLI → web fallback.

### ctx7 CLI

| Library | ctx7 ID | Use For |
|---------|---------|---------|
| Iced 0.14 | `/websites/rs_iced_iced` | Widgets, Theme, Canvas, Shader, Subscription, pane_grid |
| tokio | `/websites/rs_tokio` | Async runtime, channels, streams |
| wgpu | `/websites/rs_wgpu` | GPU rendering, shader pipelines |

### Web

| Source | URL | Use For |
|--------|-----|---------|
| Iced API docs | `https://docs.iced.rs/iced/` | API reference (tracks master — may serve unreleased APIs) |
| Iced GitHub | `https://github.com/iced-rs/iced` | Examples, issues, PRs |
| Iced Docs Repo | `https://github.com/iced-rs/docs` | Guides, tutorials |
| Iced examples | `https://github.com/iced-rs/iced/tree/master/examples` | Reference implementations |

## Dev Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `cargo-hot` | Live UI patching without restart | `cargo install cargo-hot` |
| `comet` | Iced debugger: frame metrics, widget tree, message inspector | `cargo install --locked --git https://github.com/iced-rs/comet.git` |

## API Reference

### Breaking Changes from 0.13

- `Widget::update` takes `Event` by reference
- `Shrink` prioritized over `Fill` in layout; entry point is `iced::daemon(boot, update, view)` for multi-window, or `iced::application(new, update, view)` for single-window
- Theme palette uses Oklch; keyboard subscriptions unified into `keyboard::listen`

### Widget Catalog

#### Layout

| Widget | Purpose | Notes |
|--------|---------|-------|
| `column` | Vertical stack | — |
| `row` | Horizontal stack | — |
| `container` | Single-child with alignment, padding, style | — |
| `stack` | Z-axis layering (overlapping children) | — |
| `scrollable` | Scrollable region | `on_scroll` fires only on user scroll, not initial render/resize |
| `pane_grid` | Resizable docking panes with drag-and-drop | — |
| `responsive` | Layout that adapts to available space | Prefer `sensor` for dimension queries |
| `float` | Content rendered via overlay system (above siblings) | Use for tooltips |
| `pin` | Absolute positioning within parent bounds | Use for drag ghosts, context menus |
| `table` | Data tables | — |
| `center` | Center a single child | — |
| `space` | Fixed-size empty spacer | — |
| `horizontal_rule` / `vertical_rule` | Divider lines | — |
| `themer` | Override theme for a subtree | — |

#### Input

| Widget | Purpose | Notes |
|--------|---------|-------|
| `button` | Pressable action trigger | `on_press` fires on mouse-up (release) |
| `text_input` | Single-line text field | — |
| `text_editor` | Multi-line text editor | — |
| `checkbox` | Boolean toggle with checkmark | — |
| `radio` | Single-choice from group | — |
| `toggler` | On/off switch | — |
| `slider` | Range value selector | — |
| `pick_list` | Dropdown value picker | — |
| `combo_box` | Searchable dropdown | — |

#### Display

| Widget | Purpose |
|--------|---------|
| `text` | Static text display |
| `rich_text` | Styled spans of text |
| `image` | Raster image display |
| `svg` | SVG vector image |
| `tooltip` | Hover popup on trigger |
| `progress_bar` | Determinate progress |
| `qr_code` | QR code image |
| `markdown` | Rendered markdown |

#### Advanced

| Widget | Purpose | Notes |
|--------|---------|-------|
| `canvas` | 2D drawing with Path/Frame/Cache | — |
| `shader` | Custom wgpu pipeline | — |
| `mouse_area` | Mouse event capture region | `on_press` fires on mouse-down; use for drag initiation, hold actions |
| `sensor` | Non-visual layout dimension sensor | `on_show` (initial) + `on_resize` (changes) |
| `keyed::Column` | Keyed diffing for dynamic lists | — |
| `lazy` | Deferred widget construction | — |
| `opaque` | Block event propagation | — |
| `pop` | Remove from parent | — |
| `value` | Display a value (debug) | — |

### PaneGrid

- **Event capture**: Both `button` and `mouse_area` call `capture_event()` on press. Tab elements capture → custom tab drag. Empty title bar → pane_grid native drag. Coexist via pick area geometry.
- **Tab drag** (custom, resilient to rebuilds): `mouse_area.on_press` per tab + `listen_with` subscription for `CursorMoved`/`ButtonReleased`. State machine: Idle → Pressed(origin) → Dragging (8px threshold). App-level state.

### Debug

`features = ["debug"]` + F12 at runtime. Stress: `ICED_PRESENT_MODE=Immediate` + `unconditional-rendering`.

Wrap budgeted paths with `iced::debug::time` to feed comet's timing panel:

```rust
fn update(&mut self, message: Message) -> Task<Message> {
    iced::debug::time(format!("{message:?}"), || {
        match message { /* ... */ }
    })
}
```

`time_with` returns T only (duration goes to beacon internally):

```rust
let elem = iced::debug::time_with("label", || expensive_op());
```

### Multi-Window

`window::open(settings) -> Task<window::Id>`, `window::close(id)`. `view()` receives `window::Id`.

### Testing

`iced_test`: `Simulator` (headless widget), `Emulator` (full runtime), snapshot support.

## Patterns

### Subscriptions

```rust
fn subscription(&self) -> Subscription<Message> {
    Subscription::batch(
        self.sources.iter().map(|source| {
            Subscription::run_with(source.id, data_stream)
                .map(Message::DataReceived)
        })
    )
}
```

Each source's subscription runs independently on Iced's executor. Use `run_with` or `.with(id)` for stable identity when a source has its own receiver.

### Theming

#### Custom Theme via Extended Palette

```rust
Theme::custom_with_fn("My Dark Theme", palette, |palette| {
    theme::palette::Extended::generate(palette)
})
```

#### Palette Mapping

Iced's built-in palette provides `primary`, `success`, `danger`, `warning`. Map domain tokens to these slots:

| Iced Palette Slot | Example Domain Token |
|-------------------|---------------------|
| `palette.primary` | Accent / brand color |
| `palette.success` | Positive state |
| `palette.danger` | Negative state |
| `palette.warning` | Warning state |

Colors without a palette slot (elevation, muted, border, highlight) go in a sidecar.

#### Custom Tokens via LazyLock Sidecar

```rust
use std::sync::LazyLock;

pub struct AppTokens {
    pub surface: [Color; 5],
    pub text_primary: Color,
    pub text_secondary: Color,
    pub border: Color,
    pub border_focused: Color,
    pub space_xs: f32,
    pub space_sm: f32,
    pub space_md: f32,
    pub space_lg: f32,
}

pub static TOKENS: LazyLock<AppTokens> = LazyLock::new(|| { /* ... */ });
```

Style closures access `TOKENS` directly — no parameter threading needed:

```rust
pub fn panel_container(_theme: &iced::Theme) -> container::Style {
    let t = &*TOKENS;
    container::Style {
        background: Some(iced::Background::Color(t.surface[1])),
        border: iced::Border { color: t.border, width: 1.0, radius: 4.0.into() },
        ..Default::default()
    }
}
```

#### Font Loading

Bundle the font via the application builder, then reference it with `Font::MONOSPACE`:

```rust
iced::daemon(boot, State::update, State::view)
    .font(include_bytes!("../fonts/JetBrainsMono-Regular.ttf"))
```

`Font::MONOSPACE` resolves to the first loaded monospace font. For system-installed fonts, use `Font::with_name("JetBrains Mono")`. cosmic-text supports mixed font families via `Shaping::Advanced`.

### Shell Chrome

#### Token-Driven Builders

Extract repeated shell elements (header actions, menus, tab bars) into builder/helper functions. Drive all sizing from a tokens struct — never inline magic numbers.

```rust
fn shell_action<'a, Message>(
    content: Element<'a, Message>,
    on_press: Message,
) -> Element<'a, Message> {
    let t = &*TOKENS;
    button(
        container(content)
            .width(Length::Fixed(t.action_size))
            .height(Length::Fixed(t.action_size))
            .center(Length::Fill),
    )
    .padding(0)
    .style(action_style)
    .on_press(on_press)
    .into()
}
```

#### Content-Driven Menus

Floating menus should compute width from content (widest item wins), apply symmetric padding, clamp to viewport edges, and handle dismiss-on-hover-exit.

### Elm Architecture

Message enum and State struct stay in the root module. Extracted modules receive `&State` or `&mut State` references. Never split these across files. Root keeps: State, Message, boot/new/update/subscription/view dispatch, thin multi-subsystem accessors.

**Module extraction**: Extract when feature-gated and self-contained, OR cohesive responsibility group, OR >30 lines on a well-defined State subset. Module pattern: `impl State` block with doc comment, `crate::` imports, `pub(crate)` methods.

### Surface Selection

Choose the simplest Iced surface that matches the problem:

1. Standard UI composition → normal widgets
2. Custom visuals / dense rendering → `Canvas` or `Shader`
3. Custom widget semantics, hit-testing, focus, layout/event plumbing → `iced::advanced`

```rust
// Normal widgets for standard UI
row![sidebar, main_content];

// Canvas/Shader for dense visual surfaces
Canvas::new(HeatStripProgram { /* ... */ })

// iced::advanced only for engine-level hooks
```

### Animation Lifecycle

When a custom widget owns an `iced::Animation<bool>`:

1. Store animation state in widget `Tree` state.
2. On state flip, call `animation.go_mut(new_state, Instant::now())`.
3. While animating: request redraws every frame; invalidate layout every frame if geometry changes.
4. In `layout()`, compute animated geometry from current animation progress.
5. In `draw()`, clip to animated bounds if only part of the child should be visible.

Sustain the loop by requesting the next frame on each `RedrawRequested`:

```rust
if let Event::Window(window::Event::RedrawRequested(now)) = event {
    if state.animation.is_animating(*now) {
        shell.invalidate_layout();
        shell.request_redraw();
        shell.request_redraw_at(*now + FRAME_INTERVAL);
    }
}
```

Extract a reusable animation widget when 2+ components need the same reveal/collapse behavior with owned clipping or animated geometry.

## Rules

### Framework Constraints

#### Widget Tree Consistency

Iced tracks widgets by tree position. Conditionally wrapping widgets changes the tree structure, breaking event tracking.

```rust
// WRONG: conditional wrapping changes tree shape
if dragging { mouse_area(label).into() } else { label.into() }

// RIGHT: always wrap, conditionally enable
mouse_area(label).on_press_maybe(if enable { Some(msg) } else { None })
```

#### View Is Pure

`view()` must be a pure function of `State`. No side effects, no memoization that depends on call frequency. All mutable state lives in `State` and changes only in `update()`. Never trigger redraws from `view()` — invalidate caches explicitly in `update()`.

#### Scroll State Initialization

`scrollable.on_scroll` fires only after scrolling, not during initial layout. Use `sensor.on_resize` for initial dimensions, then combine with `on_scroll` for ongoing updates.

#### Minimum Pane Size

`PaneGrid::min_size` sets a uniform minimum for all panes. Per-pane minimums must be enforced in pane content or split/resize state.

#### Animation Invalidation

- **Paint-only** (color, opacity, rotation with fixed bounds): `shell.request_redraw()` is sufficient.
- **Layout-affecting** (size, position, expand/collapse, clipping bounds): requires **both** `shell.request_redraw()` **and** `shell.invalidate_layout()`.

Omitting `invalidate_layout()` when geometry changes causes paint at new size with old layout dimensions — overlap, clipping, or dead space. **Diagnostic:** if a widget "only updates on the second click," suspect stale layout.

#### Overlay State Isolation

Overlay layers (`stack` children beyond the base) must not affect the base layer's widget structure. Add/remove overlay layers freely, but never change base-layer widget construction based on overlay presence.

#### Pick Area Geometry

TitleBar content must use `Shrink` width so empty space remains for the pick area. `Fill` width on tab row content eliminates the pick area, disabling pane drag entirely.

```rust
// WRONG: Fill consumes pick area
pane_grid::TitleBar::new(row![tabs].width(Length::Fill))

// RIGHT: Shrink preserves pick area
pane_grid::TitleBar::new(row![tabs].width(Length::Shrink))
```

#### Single Message Per Interaction

Each widget interaction produces exactly one message. For composite actions (e.g., tab press that might become a drag), use state machines in `update()` rather than emitting multiple messages from `view()`.

#### Title Bar Event Ordering

In `pane_grid::Content::update`, the title bar processes before the body. When the cursor crosses from body to title bar in a single frame, title bar messages fire before body messages. Do not unconditionally clear state in body-exit handlers that the title bar just established.

#### Overlay Visibility Requires Layout Invalidation

Custom widgets that conditionally return an overlay from `overlay()` must call `shell.invalidate_layout()` in `update()` when the overlay appears or disappears. Without this, popup layout nodes go stale, causing panics.

```rust
Event::Mouse(mouse::Event::CursorEntered) => {
    if !self.show_overlay {
        self.show_overlay = true;
        shell.invalidate_layout(); // Required — tree shape changed
    }
}
```

Prefer built-in widgets (`tooltip`, `float`) over custom `overlay::Overlay` — custom overlays are the #1 source of `container.rs unwrap() on None` panics.

**Custom overlay contract** (if you must): `children()` → fixed count; `diff()` → reconcile all children regardless of visibility; `layout()` → nodes matching children; `draw()` → same tree from layout.

---

### Subscription Constraints

#### Stable Identity

Each data source needs a unique, stable subscription identity via `run_with(id, ...)` or `.with(id)`. Without stable identity, Iced tears down and recreates the subscription on every view cycle.

#### Bounded Update Work

Pre-aggregate high-frequency data in the subscription worker. Emit one batch per non-empty ~16ms window so `update()` sees bounded work. Use bounded channels with `try_send()` only on the producer side. Empty windows emit no message; idle windows cause no redraw.

---

### Theme Constraints

#### No Custom Theme Type for Tokens

Iced's `Theme::Custom` cannot attach custom data. A custom Theme type requires 15-20 Catalog trait implementations. Use a `LazyLock<AppTokens>` sidecar instead. Migrate to a custom Theme type only when user-selectable themes are needed at runtime.

---

### Interaction

#### Overlay Starvation

Stacked `mouse_area(...).interaction(...)` layers can block underlying hover/move handlers, even without `opaque(...)`. Set `Interaction::Grabbing` on the real drag target instead of adding a global cursor layer. Use `opaque(...)` only for true capture zones.

#### PaneGrid Drag Feedback

If pane dragging uses `pane_grid.on_drag(...)`, keep feedback inside the picked pane subtree or `pane_grid::Style`. `mouse_area`/`opaque` pane-drag overlays are rebuild-sensitive and can prevent native `Dropped` events. Compact drag previews must reuse the same TitleBar/body shell — do not build a separate overlay widget.

#### Split Interaction Ownership

When `mouse_area` handles semantics while `button` provides visual feedback, interaction ownership is split. Hit areas may differ, event ordering is fragile, and state can desync. Exactly one layer must publish the action:

```rust
// RIGHT: mouse_area owns semantics; button is visual-only (no .on_press)
mouse_area(button(content)).on_press(Message::Activate)

// WRONG: both layers publish
mouse_area(button(content).on_press(Message::Activate)).on_press(Message::Activate)
```

---

### Cache & Multi-Window

#### Trace Staleness Before Coding

When adding cached or mirrored UI state, enumerate every mutation path that can stale it before writing code: direct handlers, drag/drop helpers, transfer/split, open/close, reset, and foreign-window events.

#### Extend Existing Event Paths

When changing window lifecycle handling, extend the existing global event path rather than adding parallel subscriptions for the same event family.

#### Regression Tests for Invalidation

Add at least one regression test for each non-obvious cache invalidation or source-window gate you introduce.
