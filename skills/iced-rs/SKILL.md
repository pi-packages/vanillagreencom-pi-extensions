---
name: iced-rs
description: "Iced 0.14 (iced-rs) GUI framework patterns, widget rules, and API reference. Load when building, modifying, or debugging any Iced UI — views, widgets, Canvas, Shader, pane_grid, subscriptions, theming."
license: MIT
user-invocable: true
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# Iced 0.14 Patterns

## Dev Tools

| Tool | Purpose | Install |
|------|---------|---------|
| `cargo-hot` | Live UI patching without restart | `cargo install cargo-hot` |
| `comet` | Iced debugger: frame metrics, widget tree, message inspector | `cargo install --locked --git https://github.com/iced-rs/comet.git` |

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

## Subscription Patterns

### One Subscription Per Data Source

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

### Batch Processing & Backpressure

- Pre-aggregate high-frequency data in the subscription worker
- Emit one batch per non-empty ~16ms window so `update()` sees bounded work
- Use bounded channels with `try_send()` only on the producer side
- Empty windows emit no message; idle windows cause no redraw

## Theming

### Custom Theme via Extended Palette

```rust
Theme::custom_with_fn("My Dark Theme", palette, |palette| {
    theme::palette::Extended::generate(palette)
})
```

### Palette Mapping

Iced's built-in palette provides `primary`, `success`, `danger`, `warning`. Map your domain tokens to these slots:

| Iced Palette Slot | Example Domain Token |
|-------------------|---------------------|
| `palette.primary` | Accent / brand color |
| `palette.success` | Positive state |
| `palette.danger` | Negative state |
| `palette.warning` | Warning state |

Colors without a palette slot (elevation, spacing, muted, border, highlight) go in a sidecar.

### Custom Tokens via LazyLock Sidecar

Iced's `Theme::Custom` has no mechanism to attach custom data. A `LazyLock` global static avoids the 15-20 Catalog trait implementations required by a custom Theme type.

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

**Migration path**: If the product later requires user-selectable themes, migrate to a custom Theme type. Style functions remain identical — only the token source changes.

### Font Loading

Bundle the font via the application builder, then reference it with `Font::MONOSPACE`:

```rust
iced::daemon(boot, State::update, State::view)
    .font(include_bytes!("../fonts/JetBrainsMono-Regular.ttf"))
```

`Font::MONOSPACE` resolves to the first loaded monospace font. For system-installed fonts, use `Font::with_name("JetBrains Mono")`. cosmic-text supports mixed font families via `Shaping::Advanced`.

## Iced 0.14 API Reference

### Breaking Changes from 0.13

- `Widget::update` takes `Event` by reference
- `Shrink` prioritized over `Fill` in layout; entry point is `iced::daemon(boot, update, view)` for multi-window, or `iced::application(new, update, view)` for single-window
- Theme palette uses Oklch; keyboard subscriptions unified into `keyboard::listen`

### Key Widgets

| Widget | Use | Notes |
|--------|-----|-------|
| `sensor` | Layout dimensions via `on_show` (initial) + `on_resize` (changes). Use instead of `responsive`. | [Scroll State](#scroll-state-initialization) |
| `float` | Content rendered via overlay system (above siblings). Use for tooltips. | — |
| `pin` | Absolute positioning within parent bounds. Use for drag ghosts, context menus. | — |
| `stack` | Z-order layering within widget tree. Use for overlay composition. | [Overlay State Isolation](#overlay-state-isolation) |
| `table` | Data tables | — |
| `scrollable` | `on_scroll` only fires on user scroll, NOT initial render/resize. | [Scroll State](#scroll-state-initialization) |
| `mouse_area` | `on_press` fires on mouse-down. Use for drag initiation, hold actions. | [Press-and-Hold](#press-and-hold-input) |
| `button` | `on_press` fires on mouse-up (release). Standard activate-on-release. | [Press-and-Hold](#press-and-hold-input) |

### PaneGrid

- **Event capture**: Both `button` and `mouse_area` call `capture_event()` on press. Tab elements capture → custom tab drag. Empty title bar → pane_grid native drag. Coexist via pick area geometry.
- **Tab drag** (custom, resilient to rebuilds): `mouse_area.on_press` per tab + `listen_with` subscription for `CursorMoved`/`ButtonReleased`. State machine: Idle → Pressed(origin) → Dragging (8px threshold). App-level state.

### Debug

`features = ["debug"]` + F12 at runtime. `iced::debug::time_with("label", || { ... })`. Stress: `ICED_PRESENT_MODE=Immediate` + `unconditional-rendering`.

### Multi-Window

`window::open(settings) -> Task<window::Id>`, `window::close(id)`. `view()` receives `window::Id`.

### Testing

`iced_test`: `Simulator` (headless widget), `Emulator` (full runtime), snapshot support.

## Widget Catalog

Prefer Iced's built-in widgets over custom `Widget`/`overlay::Overlay` implementations. See [Surface Selection](#surface-selection) for the selection ladder and [Overlay Visibility Requires Layout Invalidation](#overlay-visibility-requires-layout-invalidation) for the custom overlay contract.

### Layout

| Widget | Purpose |
|--------|---------|
| `column` | Vertical stack |
| `row` | Horizontal stack |
| `container` | Single-child with alignment, padding, style |
| `stack` | Z-axis layering (overlapping children) |
| `scrollable` | Scrollable region |
| `pane_grid` | Resizable docking panes with drag-and-drop |
| `responsive` | Layout that adapts to available space |
| `center` | Center a single child |
| `space` | Fixed-size empty spacer |
| `horizontal_rule` / `vertical_rule` | Divider lines |
| `themer` | Override theme for a subtree |

### Input

| Widget | Purpose |
|--------|---------|
| `button` | Pressable action trigger (fires on release) |
| `text_input` | Single-line text field |
| `text_editor` | Multi-line text editor |
| `checkbox` | Boolean toggle with checkmark |
| `radio` | Single-choice from group |
| `toggler` | On/off switch |
| `slider` | Range value selector |
| `pick_list` | Dropdown value picker |
| `combo_box` | Searchable dropdown |

### Display

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

### Advanced

| Widget | Purpose |
|--------|---------|
| `canvas` | 2D drawing with Path/Frame/Cache |
| `shader` | Custom wgpu pipeline |
| `mouse_area` | Mouse event capture region |
| `sensor` | Non-visual layout dimension sensor |
| `keyed::Column` | Keyed diffing for dynamic lists |

### Utility

| Widget | Purpose |
|--------|---------|
| `lazy` | Deferred widget construction |
| `opaque` | Block event propagation |
| `pin` | Absolute positioning within parent |
| `pop` | Remove from parent |
| `value` | Display a value (debug) |

## Shell Chrome Patterns

### Token-Driven Builders

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

### Content-Driven Menus

Floating menus should compute width from content (widest item wins), apply symmetric padding, clamp to viewport edges, and handle dismiss-on-hover-exit.

## Skill Rules

### Framework Constraints

#### Widget Tree Consistency

Iced tracks widgets by tree position. Conditionally wrapping widgets based on interaction state changes the tree structure, breaking event tracking.

**Incorrect (conditional wrapping changes tree shape):**

```rust
if dragging {
    mouse_area(label).into()
} else {
    label.into()
}
```

**Correct (always wrap, conditionally enable):**

```rust
mouse_area(label)
    .on_press_maybe(if enable { Some(msg) } else { None })
```

#### View Is Pure

`view()` must be a pure function of `State`. No side effects, no memoization that depends on call frequency, no hidden state. All mutable state lives in `State` and changes only in `update()`.

#### Scroll State Initialization

`scrollable.on_scroll` fires only after scrolling, not during initial layout. Capture initial dimensions with an explicit measurement step such as `sensor.on_resize`, then combine that with `on_scroll` if you also need ongoing scroll updates.

#### Minimum Pane Size

`PaneGrid::min_size` sets a uniform minimum for all panes. If different panes need different minimums, enforce them in the pane content or in your split/resize state instead of assuming `PaneGrid` tracks them per pane.

#### Animation Invalidation

When a custom widget animates, choose the right shell invalidation:

- **Paint-only animation** (color, opacity, stroke width, rotation with fixed bounds): `shell.request_redraw()` is sufficient.
- **Layout-affecting animation** (size, position, expand/collapse, clipping bounds, hit region): require **both** `shell.request_redraw()` **and** `shell.invalidate_layout()`.

Omitting `invalidate_layout()` when geometry changes causes the widget to paint at its new size while surrounding layout retains the old dimensions — producing overlap, clipping, or dead space.

**Diagnostic:** if a widget "only updates on the second click," suspect stale layout before suspecting message routing.

**Immediate Transition Start:**

When a user interaction triggers an animated state change, start the tween and immediately request both a redraw and a scheduled next-frame redraw:

```rust
shell.request_redraw();
shell.request_redraw_at(Instant::now() + FRAME_INTERVAL);
```

If geometry changes, also call `shell.invalidate_layout()`.

**Sustaining the Animation Loop:**

Handle `RedrawRequested` to keep the animation alive every frame until the tween completes:

```rust
// On state transition (e.g. toggle expand/collapse)
if state.pending_transition {
    shell.invalidate_layout();
    shell.request_redraw();
    shell.request_redraw_at(Instant::now() + FRAME_INTERVAL);
    state.pending_transition = false;
}

// On each frame while animating
if let Event::Window(window::Event::RedrawRequested(now)) = event {
    if state.animation.is_animating(*now) {
        shell.invalidate_layout();
        shell.request_redraw();
        shell.request_redraw_at(*now + FRAME_INTERVAL);
    }
}
```

**Custom Widget Lifecycle:**

For custom widgets that own an `iced::Animation<bool>`:

1. Store animation state in widget `Tree` state.
2. On state flip, call `animation.go_mut(new_state, Instant::now())`.
3. While animating: request redraws every frame; invalidate layout every frame if geometry changes.
4. In `layout()`, compute animated geometry from the current animation progress.
5. In `draw()`, clip to the animated bounds if only part of the child should be visible.

**When To Extract a Shared Motion Primitive:**

Extract a reusable animation widget when:

- 2+ components need the same reveal/collapse behavior
- The motion owns clipping or animated geometry
- The animation semantics are framework-level, not component-specific

Keep geometry animation logic in the widget that owns the layout — do not store it in transient preview or showcase state.

#### Overlay State Isolation

Overlay layers (stack children beyond the base) must not affect the base layer's widget structure. Add/remove overlay layers freely, but never change how base-layer widgets are constructed based on overlay presence.

#### Pick Area Geometry

TitleBar content must use `Shrink` width so empty space remains for the pick area. `Fill` width on tab row content eliminates the pick area, disabling pane drag entirely.

**Incorrect (Fill width consumes pick area):**

```rust
pane_grid::TitleBar::new(
    row![tabs].width(Length::Fill)  // No pick area left
)
```

**Correct (Shrink width preserves pick area):**

```rust
pane_grid::TitleBar::new(
    row![tabs].width(Length::Shrink)  // Pick area in remaining space
)
```

#### Single Message Per Interaction

Each widget interaction produces exactly one message. For composite actions (e.g., tab press that might become a drag), use state machines in `update()` rather than emitting multiple messages from `view()`.

#### Title Bar Event Ordering

In `pane_grid::Content::update`, the title bar is processed before the body. When the cursor crosses from body to title bar in a single frame, title bar messages (e.g., `TabBarEntered`) fire before body messages (e.g., `PaneBodyExited`). Do not unconditionally clear state in body-exit handlers that the title bar just established.

---

### Development Practices

#### Validate API Before Use

Iced 0.14 has significant breaking changes from 0.13. Always verify widget APIs, entry points, and trait signatures against current docs before assuming API shape.

#### Surface Selection

Choose the simplest Iced surface that matches the problem:

- Standard UI composition uses normal widgets.
- Custom visuals and dense rendering use `Canvas` or `Shader` first.
- Reserve `iced::advanced` for new control behavior or engine-level hooks the public APIs cannot express cleanly: custom widget semantics, hit-testing, focus, layout/event/runtime plumbing, renderer hooks, or custom subscriptions.

**Incorrect (using `iced::advanced` for a purely visual surface):**

```rust
struct HeatStrip;

impl<Message> advanced::Widget<Message, Theme, Renderer> for HeatStrip {
    // custom layout/event/runtime plumbing only to draw colored levels
}
```

**Correct (use the public surface that matches the need):**

```rust
// Standard UI composition stays with normal widgets.
row![sidebar, main_content];

// Dense visual surface uses Canvas/Shader first.
Canvas::new(HeatStripProgram { /* ... */ })

// Reach for iced::advanced only if the surface needs custom hit-testing,
// focus, layout/runtime behavior, or another engine-level hook.
```

#### Reactive Discipline

Never trigger redraws from `view()`. Invalidate caches explicitly in `update()`. Batch high-frequency data updates into ~16ms windows so `update()` sees bounded work and idle windows cause no redraw.

#### Instrument Budgeted Paths

Every function with a performance budget must have an `iced::debug::time` wrapper. This feeds the comet debugger's timing panel for runtime validation.

Wrap update() message handling:

```rust
fn update(&mut self, message: Message) -> Task<Message> {
    iced::debug::time(format!("{message:?}"), || {
        match message { /* ... */ }
    })
}
```

Wrap specific expensive operations:

```rust
let geometries = iced::debug::time("chart::draw", || {
    self.data_cache.draw(renderer, bounds, |frame| { /* ... */ })
});
```

`time_with` returns T only (duration goes to beacon internally):

```rust
let elem = iced::debug::time_with("subscription::drain", || {
    self.drain_data_batch()
});
```

#### No Redundant Event Subscriptions

Before adding a new `window::*` or event subscription, check whether the same event family already flows through an existing listener. Extend the existing path unless a separate subscription is required and benchmarked.

#### Press-and-Hold Input

`button(...).on_press(...)` fires on mouse-up (release). For true mouse-down behavior (repeat scroll, press-and-hold actions), use `mouse_area(...).on_press(...)`.

#### Smoke Test After UI Changes

Clippy catches compile errors but not runtime panics (missing Tokio runtime, wgpu init failures, font loading). Always run the app briefly after UI changes to catch these.

---

### Cache & Multi-Window

#### Trace Staleness Before Coding

When adding cached or mirrored UI state (snapshots, summaries, registries), enumerate every mutation path that can stale it before writing code: direct handlers, drag/drop helpers, transfer/split, open/close, reset, and foreign-window events.

#### Extend Existing Event Paths

When changing window lifecycle handling, prefer extending the existing global event path over adding parallel subscriptions for the same event family.

#### Regression Tests for Invalidation

Add at least one regression test for each non-obvious cache invalidation or source-window gate you introduce.

---

### Elm Architecture

#### Message and State Stay in Root

Message enum and State struct stay in the root module. Extracted modules receive `&State` or `&mut State` references. Never split these across files. Root keeps: State, Message, boot/new/update/subscription/view dispatch, thin multi-subsystem accessors.

#### Module Extraction Pattern

Extract when: feature-gated and self-contained, OR cohesive responsibility group, OR >30 lines on a well-defined State subset. Module pattern: `impl State` block with doc comment, `crate::` imports, `pub(crate)` methods. Feature gates move with the function — if all functions share a gate, apply it to the `mod` declaration.

---

### Interaction

#### Overlay Starvation

Stacked `mouse_area(...).interaction(...)` layers can stop underlying hover/move handlers from receiving events, even without `opaque(...)`. Prefer setting `Interaction::Grabbing` on the real drag target widgets instead of adding a global cursor layer. Use `opaque(...)` only for true capture zones (app-edge drop zones).

#### Keep PaneGrid Drag Feedback Internal

If pane dragging uses `pane_grid.on_drag(...)`, keep feedback inside the picked pane subtree or `pane_grid::Style`. `mouse_area`/`opaque` pane-drag overlays are rebuild-sensitive and can prevent native `Dropped` events from arriving.

Compact drag previews are safe only when they reuse the same TitleBar/body shell and swap leaf styling or content in place — do not build a separate overlay widget for the preview. Passive cursor indicators (e.g., a cursor icon change) are fine; `mouse_area`/`opaque` pane-drag overlays that capture input are not. Drop-zone highlight state is rebuild-sensitive and must live inside the pane subtree or be driven by `pane_grid::Style`.

#### Split Interaction Ownership

When `mouse_area` handles semantic interaction (press, hover, drag) while a `button` provides visual feedback (styling, states), interaction ownership is split across two widgets. This creates risks:

- Hit areas may differ — `button` respects its own bounds while `mouse_area` covers a potentially different region.
- Event ordering is fragile — both widgets consume the same pointer events, and which wins depends on tree position.
- State can desync — `button` visual state (pressed, hovered) may not reflect `mouse_area` semantic state.

When this pattern appears in code, flag it explicitly. Prefer consolidating interaction into one widget: either a styled `mouse_area` or a `button` with `on_press`.

If both are truly needed, exactly one layer publishes the action:

**Correct (single owner):**

```rust
// mouse_area owns semantics; button is visual-only
mouse_area(button(content))       // no .on_press on button
    .on_press(Message::Activate)
```

**Incorrect (split ownership):**

```rust
// both layers publish — ambiguous press/release semantics
mouse_area(
    button(content).on_press(Message::Activate)
).on_press(Message::Activate)
```

Document which widget owns which concern and verify hit areas match. If the semantic wrapper owns the interaction, it must wrap the entire intended hit region — otherwise animated layout changes can leave hit testing on stale geometry.

#### Overlay Visibility Requires Layout Invalidation

**Built-in First**: Prefer Iced's built-in widgets over custom `overlay::Overlay` implementations. Custom overlay implementations are the #1 source of crashes in Iced applications — `container.rs unwrap() on None` panics during rapid interaction. Use `iced::widget::tooltip::Tooltip` for tooltips; reserve custom overlays only for popovers or context menus that require dismiss semantics no built-in can express.

Custom widgets that conditionally return an overlay from `overlay()` must call `shell.invalidate_layout()` in `update()` whenever the overlay appears or disappears. Without this, the popup tree's layout nodes go stale between `layout()` and `draw()`, causing panics.

**Incorrect (no invalidation on visibility change):**

```rust
fn update(&mut self, _state: &mut Tree, event: Event, ..., shell: &mut Shell<'_, Message>) {
    match event {
        Event::Mouse(mouse::Event::CursorEntered) => {
            self.show_overlay = true;
            // BUG: layout tree still has no overlay node
        }
        Event::Mouse(mouse::Event::CursorLeft) => {
            self.show_overlay = false;
        }
        _ => {}
    }
}

fn overlay<'b>(...) -> Option<overlay::Element<'b, Message, Theme, Renderer>> {
    if self.show_overlay { Some(my_popup(...)) } else { None }
}
```

**Correct (invalidate layout on every visibility transition):**

```rust
fn update(&mut self, _state: &mut Tree, event: Event, ..., shell: &mut Shell<'_, Message>) {
    match event {
        Event::Mouse(mouse::Event::CursorEntered) => {
            if !self.show_overlay {
                self.show_overlay = true;
                shell.invalidate_layout();
            }
        }
        Event::Mouse(mouse::Event::CursorLeft) => {
            if self.show_overlay {
                self.show_overlay = false;
                shell.invalidate_layout();
            }
        }
        _ => {}
    }
}

fn overlay<'b>(...) -> Option<overlay::Element<'b, Message, Theme, Renderer>> {
    if self.show_overlay { Some(my_popup(...)) } else { None }
}
```

**Custom widget overlay contract** — if you MUST build a custom overlay widget:

- `children()` → return a fixed child count (never changes between frames)
- `diff()` → reconcile ALL children regardless of visibility state
- `layout()` → produce layout nodes matching children
- `draw()` → use the SAME tree from layout
- `overlay()` → call `shell.invalidate_layout()` when overlay visibility changes
