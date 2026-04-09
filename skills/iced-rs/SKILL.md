---
name: iced-rs
description: "Iced 0.14 GUI framework expert — custom widgets via iced::advanced, overlays, Canvas, Shader, pane_grid, theming, subscriptions, Elm architecture. Load whenever building, modifying, or debugging any Iced UI. Bundled reference library covers the full 0.14 API; bundled examples include all upstream iced examples plus the iced_wgpu renderer source."
license: MIT
user-invocable: true
metadata:
  author: vanillagreen
  version: "3.0.0"
---

# Iced 0.14

Framework skill for building any Iced 0.14 UI.

## Required reading order

1. `references/INDEX.md` — table of every reference file, load-on-demand
2. `references/guide-surface-selection.md` — decision tree: built-in vs Canvas vs Shader vs Widget vs Overlay
3. `references/guide-custom-widgets.md` — when building a custom `iced::advanced::Widget`
4. `references/guide-custom-overlays.md` — when building a custom `iced::advanced::overlay::Overlay`

Load raw API references (`advanced-*.md`, `canvas.md`, `shader.md`, etc.) as needed.

## Bundled resources

### `references/` — API docs + synthesized guides

75 files covering the full iced 0.14 API and synthesized patterns. Load on demand from `references/INDEX.md`.

**Guides (read before writing similar code):**

| Guide | Use |
|---|---|
| `guide-surface-selection.md` | Pick the right primitive |
| `guide-custom-widgets.md` | Implementing `iced::advanced::Widget` |
| `guide-custom-overlays.md` | Implementing `iced::advanced::overlay::Overlay` |

**Raw API refs (load as needed):**
- `advanced-*.md` — Widget, Overlay, Shell, Tree, Layout, Renderer, Mouse, Text, Clipboard, Operation
- `canvas.md`, `canvas-path.md`, `canvas-geometry.md`, `shader.md`
- `element.md`, `length.md`, `padding.md`, `alignment.md`
- `task.md`, `subscription.md`, `application.md`, `window.md`, `keyboard.md`, `mouse.md`
- `theme.md`, `theme-palette.md`, `catalog.md`
- `pane-grid.md` — full pane_grid module
- `api-module-tree.md` — complete hierarchical index of the iced 0.14 module tree

### `examples/` — all upstream Iced 0.14 examples

56 official examples. Read the canonical one before writing similar code — 0.14 signatures differ from 0.13 and guessing fails.

| Need | Read first |
|---|---|
| Custom Widget impl | `examples/custom_widget/src/main.rs` |
| GPU shader pipeline | `examples/custom_shader/` (full dir) |
| Mesh / vector geometry widget | `examples/geometry/src/main.rs` |
| Canvas 2D drawing | `examples/bezier_tool`, `examples/clock`, `examples/color_palette` |
| Canvas animation | `examples/solar_system`, `examples/the_matrix`, `examples/game_of_life` |
| Arc/ring animation | `examples/loading_spinners`, `examples/arc` |
| Modal dialog | `examples/modal/src/main.rs` (stack + opaque) |
| Toast/notification overlay | `examples/toast/src/main.rs` |
| Tooltip / zoom-on-hover | `examples/loupe/src/main.rs` |
| Styled components | `examples/styling/` |
| pane_grid layout | `examples/pane_grid/` |
| Multi-window | `examples/multi_window/` |
| WebSocket subscription | `examples/websocket/` |
| Text editing | `examples/editor/` |

### `iced_wgpu/` — iced's own wgpu renderer source

Full source of the `iced_wgpu` crate. Reference for wgpu pipeline patterns that integrate with iced.

| File | Use |
|---|---|
| `iced_wgpu/src/engine.rs` | Device/Queue per-frame lifecycle |
| `iced_wgpu/src/layer.rs` | Layer composition |
| `iced_wgpu/src/quad.rs`, `quad/solid.rs`, `quad/gradient.rs` | Instanced quad pipeline template |
| `iced_wgpu/src/triangle.rs`, `triangle/msaa.rs` | Mesh pipeline with MSAA |
| `iced_wgpu/src/primitive.rs` | Custom shader primitive interface |
| `iced_wgpu/src/buffer.rs` | Resizable growable buffer pattern |
| `iced_wgpu/src/shader/quad.wgsl` | Reference WGSL for instanced quads |

### External fallbacks

- `ctx7 docs /websites/rs_iced_iced "<query>"` — newer API surface
- `https://docs.rs/iced/0.14.0/iced/` — authoritative API reference
- `https://github.com/iced-rs/iced` — upstream master (may serve unreleased APIs)

Prefer local `references/` + `examples/` over external — they're pinned to 0.14.0 exactly.

## Dev tools

| Tool | Purpose | Install |
|---|---|---|
| `cargo-hot` | Live UI patching | `cargo install cargo-hot` |
| `comet` | Debugger: frame metrics, widget tree, message inspector | `cargo install --locked --git https://github.com/iced-rs/comet.git` |

`features = ["debug"]` + F12 for built-in debugger. Stress-test with `ICED_PRESENT_MODE=Immediate` + `unconditional-rendering`.

Wrap budgeted paths with `iced::debug::time`:

```rust
fn update(&mut self, message: Message) -> Task<Message> {
    iced::debug::time(format!("{message:?}"), || match message { /* ... */ })
}
```

## Breaking changes from Iced 0.13

Most common cause of compile errors when porting or regenerating from memory:

- `Widget::update` takes `event: &Event` (by ref, not by value)
- `Widget::layout` takes `&mut Tree`
- Entry points split: `iced::daemon(boot, update, view)` multi-window, `iced::application(new, update, view)` single-window
- Shrink prioritized over Fill in layout resolution
- Theme palette uses Oklch
- Keyboard subscriptions unified into `keyboard::listen`

## Surface Selection (short form)

Full decision tree: `references/guide-surface-selection.md`.

1. **Standard UI** → built-in widgets + `.style(closure)`
2. **2D custom drawing** → `Canvas`
3. **GPU-dense rendering** → `Shader`
4. **Custom events/state/overlays/layout** → `iced::advanced::Widget`
5. **Floating layer** → try `tooltip`, `float`, `stack`+`opaque` first; custom `Overlay` only as last resort

## Widget catalog (quick lookup)

Full API in `references/`. This is a fast-access map.

**Layout**: `column`, `row`, `container`, `stack`, `scrollable`, `pane_grid`, `responsive`, `float`, `pin`, `table`, `center`, `space`, `horizontal_rule`/`vertical_rule`, `themer`

**Input**: `button`, `text_input`, `text_editor`, `checkbox`, `radio`, `toggler`, `slider`, `pick_list`, `combo_box`

**Display**: `text`, `rich_text`, `image`, `svg`, `tooltip`, `progress_bar`, `qr_code`, `markdown`

**Advanced**: `canvas`, `shader`, `mouse_area`, `sensor`, `keyed::Column`, `lazy`, `opaque`, `pop`, `value`

Notes:
- `button.on_press` fires on mouse-up; `mouse_area.on_press` fires on mouse-down (use for drag initiation)
- `sensor.on_show` fires on initial layout + `on_resize` on changes; combine with `scrollable.on_scroll` for initial + ongoing
- `scrollable.on_scroll` fires only on user scroll, not initial render
- `float` → overlay-based (tooltips); `pin` → absolute positioning (drag ghosts)

## Patterns

### Subscriptions

```rust
fn subscription(&self) -> Subscription<Message> {
    Subscription::batch(self.sources.iter().map(|source| {
        Subscription::run_with(source.id, data_stream).map(Message::DataReceived)
    }))
}
```

Each source gets a stable identity via `run_with(id, ...)` or `.with(id)`. Without stable identity, Iced tears down + recreates on every view cycle. See `references/subscription.md`.

### Theming

Built-in palette: `primary`, `success`, `danger`, `warning`. Custom tokens go in a sidecar — Iced's `Theme::Custom` cannot attach custom data.

```rust
// Custom theme with custom palette
Theme::custom_with_fn("My Dark", palette, |p| theme::palette::Extended::generate(p))

// Custom tokens via LazyLock sidecar
pub struct AppTokens {
    pub surface: [Color; 5],
    pub border: Color,
    pub border_width: f32,
    pub border_radius: f32,
    // ...
}
pub static TOKENS: LazyLock<AppTokens> = LazyLock::new(|| { /* ... */ });

// Style closures read from TOKENS — no inline literals
pub fn panel_container(_theme: &iced::Theme) -> container::Style {
    let t = &*TOKENS;
    container::Style {
        background: Some(iced::Background::Color(t.surface[1])),
        border: iced::Border { color: t.border, width: t.border_width, radius: t.border_radius.into() },
        ..Default::default()
    }
}
```

Keep raw color/width/radius literals out of style closures — route every visual value through `TOKENS`. This is the point of the sidecar pattern: one place to change when the palette shifts.

Font loading via the application builder:

```rust
iced::daemon(boot, State::update, State::view)
    .font(include_bytes!("../fonts/JetBrainsMono-Regular.ttf"))
```

`Font::MONOSPACE` resolves to the first loaded monospace font; use `Font::with_name("...")` for system fonts. See `references/theme.md`, `references/theme-palette.md`, `references/catalog.md`.

### Elm architecture

Message enum and State struct stay in the root module. Extracted modules receive `&State` or `&mut State` references. Root keeps: State, Message, boot/new/update/subscription/view dispatch, thin multi-subsystem accessors.

**Extract a module when**: feature-gated + self-contained, OR cohesive responsibility group, OR >30 lines on a well-defined State subset. Pattern: `impl State` block with doc comment, `crate::` imports, `pub(crate)` methods.

### Multi-window

`window::open(settings) -> Task<window::Id>`, `window::close(id)`. `view()` receives `window::Id`. See `references/window.md`.

### Testing

`iced_test`: `Simulator` (headless widget), `Emulator` (full runtime), snapshot support.

### PaneGrid

- Both `button` and `mouse_area` call `capture_event()` on press. Tab elements capture → custom tab drag. Empty title bar → native pane_grid drag. Coexist via pick area geometry.
- Tab drag (custom, rebuild-resilient): `mouse_area.on_press` per tab + `listen_with` subscription for `CursorMoved`/`ButtonReleased`. State machine: Idle → Pressed(origin) → Dragging (8px threshold). App-level state.

## Rules (non-negotiable framework invariants)

### Widget tree consistency

Iced tracks widgets by tree position. Conditionally wrapping widgets changes tree shape and breaks event tracking.

```rust
// WRONG: conditional wrapping changes tree shape
if dragging { mouse_area(label).into() } else { label.into() }

// RIGHT: always wrap, conditionally enable
mouse_area(label).on_press_maybe(if enable { Some(msg) } else { None })
```

### view() is pure

No side effects, no memoization dependent on call frequency. All mutable state in `State`, mutated only in `update()`. Never trigger redraws from `view()` — invalidate caches explicitly in `update()`.

### Scroll state initialization

`scrollable.on_scroll` fires only after scrolling, not at initial layout. Use `sensor.on_resize` for initial dimensions; combine with `on_scroll` for ongoing updates.

### Minimum pane size

`PaneGrid::min_size` is uniform across all panes. Per-pane minimums must be enforced in pane content or split/resize state.

### Animation invalidation

- **Paint-only** (color, opacity, rotation with fixed bounds): `shell.request_redraw()` is sufficient
- **Layout-affecting** (size, position, expand/collapse, clipping bounds): **both** `shell.request_redraw()` AND `shell.invalidate_layout()`

**Diagnostic**: widget "only updates on the second click" → stale layout, add `invalidate_layout()`.

### Overlay state isolation

Overlay layers (`stack` children beyond the base) must not affect base-layer widget structure. Add/remove overlays freely; never change base-layer construction based on overlay presence.

### Pick area geometry (pane_grid)

TitleBar content must use `Shrink` width so empty space remains for the pick area. `Fill` width on tab row content eliminates the pick area and disables pane drag.

```rust
// WRONG
pane_grid::TitleBar::new(row![tabs].width(Length::Fill))
// RIGHT
pane_grid::TitleBar::new(row![tabs].width(Length::Shrink))
```

### Single message per interaction

One widget interaction → one message. Composite actions (tab press → drag) use a state machine in `update()`, not multiple messages from `view()`.

### Title bar event ordering (pane_grid)

In `pane_grid::Content::update` the title bar processes before the body. When the cursor crosses from body to title bar in one frame, title bar messages fire before body messages. Do not unconditionally clear state in body-exit handlers that the title bar just established.

### Overlay visibility requires layout invalidation

Widgets that conditionally return an overlay from `overlay()` must call `shell.invalidate_layout()` in `update()` when visibility changes. Otherwise popup layout nodes go stale → panic.

```rust
Event::Mouse(mouse::Event::CursorEntered) => {
    if !self.show_overlay {
        self.show_overlay = true;
        shell.invalidate_layout(); // required
    }
}
```

### Custom overlays are the #1 panic source

Prefer built-ins (`tooltip`, `float`, `stack`+`opaque`) over custom `overlay::Overlay`. Custom overlays cause `container.rs unwrap() on None` when the contract is violated.

**Custom overlay contract**: `children()` → fixed count; `diff()` → reconcile all children regardless of visibility; `layout()` → nodes matching children; `draw()` → same tree from layout. Full spec: `references/guide-custom-overlays.md`.

### Overlay viewport contract

When calling `Widget::update`/`draw`/`mouse_interaction`/`overlay` on a descendant from inside an `Overlay` impl, pass `Rectangle::INFINITE` as the viewport, **never** the stored viewport captured from your parent's `overlay()`. iced's `scrollable::overlay` forwards `bounds.intersection(viewport)`, and `iced_wgpu`'s per-paragraph text scissor turns inherited clips into invisible text. The overlay's own `Overlay::layout()` may still use its `bounds: Size` parameter for its own coordinate space — the rule applies only to viewports propagated to descendant widgets.

### Subscription — stable identity

Each data source needs a unique, stable subscription identity via `run_with(id, ...)` or `.with(id)`. Without it, Iced tears down + recreates on every view cycle.

### Subscription — bounded update work

Pre-aggregate high-frequency data in the subscription worker. Emit one batch per non-empty ~16ms window so `update()` sees bounded work. Use bounded channels with `try_send()` producer-side. Empty windows emit no message; idle windows cause no redraw.

### Theme — no custom theme type for tokens

Iced's `Theme::Custom` cannot attach custom data. A custom Theme type requires 15-20 Catalog trait implementations. Use a `LazyLock<AppTokens>` sidecar. Migrate to a custom Theme type only when user-selectable themes are needed at runtime.

### Overlay starvation

Stacked `mouse_area(...).interaction(...)` layers can block underlying hover/move handlers even without `opaque(...)`. Set `Interaction::Grabbing` on the real drag target instead of adding a global cursor layer. Use `opaque(...)` only for true capture zones.

### PaneGrid drag feedback

If pane dragging uses `pane_grid.on_drag(...)`, keep feedback inside the picked pane subtree or `pane_grid::Style`. `mouse_area`/`opaque` pane-drag overlays are rebuild-sensitive and can prevent native `Dropped` events. Compact drag previews must reuse the same TitleBar/body shell — do not build a separate overlay widget.

### Split interaction ownership

When `mouse_area` handles semantics while `button` provides visual feedback, ownership is split. Exactly one layer must publish the action:

```rust
// RIGHT: mouse_area owns semantics; button is visual-only
mouse_area(button(content)).on_press(Message::Activate)

// WRONG: both layers publish
mouse_area(button(content).on_press(Message::Activate)).on_press(Message::Activate)
```

### Cache staleness — trace before coding

When adding cached or mirrored UI state, enumerate every mutation path that can stale it before writing code: direct handlers, drag/drop helpers, transfer/split, open/close, reset, foreign-window events.

### Cache staleness — extend existing event paths

When changing window lifecycle handling, extend the existing global event path rather than adding parallel subscriptions for the same event family.

### Cache staleness — regression tests

Add at least one regression test for each non-obvious cache invalidation or source-window gate.

## Hot workflow — building new features

1. Classify: read `references/guide-surface-selection.md`, pick the surface. Do not skip.
2. Read the canonical example in `examples/` for that surface.
3. Read the relevant guide (`guide-custom-widgets.md`, `guide-custom-overlays.md`).
4. Skim the API references the guide points to.
5. Write code.
6. When stuck: re-read the guide's "Common failure modes" / "Gotchas" sections. Top 3 custom-widget bugs: missing `capture_event`, missing `invalidate_layout` on layout-changing animation, wrong event signature (0.13 API).
7. For perf issues: measure with `iced::debug::time` + `comet` before optimizing. Canvas is often faster than expected; don't rewrite to Shader without data.
