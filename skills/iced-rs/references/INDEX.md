# References Index

API reference files and synthesized guides for Iced 0.14. Load on demand.

## Navigation

- `api-module-tree.md` — complete hierarchical index of every public iced 0.14 module, trait, struct, enum, function. Consult when you don't know where an item lives.

## Synthesized guides

| File | When to read |
|---|---|
| `guide-surface-selection.md` | Deciding between built-in / Canvas / Shader / custom Widget / Overlay. Read first if the choice isn't obvious. |
| `guide-custom-widgets.md` | Implementing `iced::advanced::Widget`. Checklist, state management, event handling, animation, hit-testing. |
| `guide-custom-overlays.md` | Implementing `iced::advanced::overlay::Overlay`. Custom overlay contract, `Rectangle::INFINITE` viewport rule, panic sources. |
| `animation.md` | Animation rules: paint-only vs layout-affecting, `request_redraw` / `request_redraw_at` scheduling, `iced::Animation<T>` primitive, hand-rolled patterns, full `Easing` variant list. Read before adding any motion. |
| `animation-easing.md` | Complete `Animation<T>` API (all methods) + `Easing` enum (all 32 variants). Detailed reference for animation code. |
| `shell-chrome.md` | App-level shell UI: token-driven action builders, content-driven floating menus, tab bars. Read when building header bars, dropdowns, or tab chrome. |
| `widgets.md` | Full widget catalog: every 0.14 widget with one-line description, key notes, canonical example. Use as a lookup table. |

## `iced::advanced` API

| File | Covers |
|---|---|
| `advanced-widget.md` | `Widget` trait — required + provided methods, signatures, semantics |
| `advanced-overlay.md` | `Overlay` trait and `Widget::overlay()` contract |
| `advanced-shell.md` | `Shell` — publish, capture_event, request_redraw, invalidate_layout, merge |
| `advanced-tree.md` | `Tree`, `Tag`, `State` — persistent widget state |
| `advanced-layout.md` | `layout::Node`, `Limits`, `Layout` |
| `advanced-renderer.md` | `Renderer` trait, `Quad`, `Style`, `with_layer`, `with_translation` |
| `advanced-mouse.md` | `Cursor`, `Interaction`, `mouse::Event` |
| `advanced-text.md` | `text::Renderer`, `Paragraph`, `Shaping` |
| `advanced-text-editor.md` | `text::editor::Editor` trait, `Action`, `Edit`, `Motion`, `Direction`, `Cursor` |
| `advanced-text-highlighter.md` | `text::highlighter::Highlighter` trait, `Format`, `PlainText` |
| `advanced-subscription-recipe.md` | `subscription::Recipe` trait — custom subscription backends |
| `advanced-clipboard.md` | `Clipboard` trait |
| `advanced-operation.md` | `Operation` trait — focus, scroll-to, introspection |

## `iced::widget` API

| File | Covers |
|---|---|
| `canvas.md` | `Canvas`, `canvas::Program`, `Frame`, `Fill`, `Stroke`, `Text`, `Cache`, `Geometry` |
| `canvas-path.md` | `Path`, `Path::Builder` — line_to, arc, bezier_curve_to |
| `canvas-geometry.md` | `Geometry`, cache invalidation semantics |
| `shader.md` | `Shader` widget, `shader::Program`, `Primitive`, `Pipeline`, `Storage`, `Viewport` |
| `pane-grid.md` | Full pane_grid module dump |
| `widget-table.md` | `Table`, `Column`, `Catalog`, `Style` — data grids |
| `widget-stack.md` | `Stack` — layered children, push, push_under |
| `widget-float.md` | `Float` — floating overlay with scale/translate |
| `widget-pin.md` | `Pin` — absolute positioning at fixed coordinates |
| `widget-markdown.md` | `markdown::view`, `Item`, `Settings`, `Style` — render Markdown |
| `widget-qr-code.md` | `QRCode`, `Data`, `ErrorCorrection`, `Style` |
| `widget-image.md` | `Image`, `Handle`, `FilterMethod`, content_fit, rotation, crop |
| `widget-svg.md` | `Svg`, `Handle`, `Style`, `Status` — vector graphics |
| `widget-themer.md` | `Themer` — apply a different theme to a subtree |
| `widget-lazy-keyed.md` | `Lazy` (hash-based caching) + `keyed::Column` (stable-key diffing) |
| `widget-sensor.md` | `Sensor` — on_show, on_resize, on_hide, anticipate, delay |
| `widget-responsive.md` | `Responsive` — size-aware widget building |
| `widget-text.md` | `Text`, `Rich`, `Span`, `Catalog`, `Style`, `Shaping`, `Wrapping`, `LineHeight` |
| `widget-column-row.md` | `Column`, `Row`, `column![]`, `row![]` — primary layout widgets |
| `widget-layout-primitives.md` | `center`, `space`, `horizontal_rule`, `vertical_rule`, `Rule` |
| `widget-mouse-area.md` | `MouseArea` — mouse event interception on any content |
| `widget-button.md` | `Button`, `Catalog`, `Status`, `Style`, `StyleFn` |
| `widget-checkbox.md` | `Checkbox`, `Catalog`, `Style`, `Status`, `Icon` |
| `widget-combo-box.md` | `ComboBox`, `Catalog`, `State` |
| `widget-container.md` | `Container`, `Catalog`, `Style`, `StyleFn` |
| `widget-pick-list.md` | `PickList`, `Catalog`, `Style`, `Handle`, `Status` |
| `widget-progress-bar.md` | `ProgressBar`, `Catalog`, `Style`, `StyleFn` |
| `widget-radio.md` | `Radio`, `Catalog`, `Style`, `Status` |
| `widget-scrollable.md` | `Scrollable`, `Catalog`, `Style`, `Direction`, `Viewport`, `Anchor` |
| `widget-slider.md` | `Slider`, `Catalog`, `Style`, `Handle`, `Status` |
| `widget-text-editor.md` | `TextEditor`, `Catalog`, `Style`, `Status`, `Content`, `Action` |
| `widget-text-input.md` | `TextInput`, `Catalog`, `Style`, `Status`, `Icon`, `Side` |
| `widget-toggler.md` | `Toggler`, `Catalog`, `Style`, `Status` |
| `widget-tooltip.md` | `Tooltip`, `Position` |

## Core types

| File | Covers |
|---|---|
| `element.md` | `Element<'a, Message, Theme, Renderer>`, `Into<Element>` pattern |
| `length.md` | `Length::{Fill, Shrink, Fixed, FillPortion}` |
| `padding.md` | `Padding` struct and constructors |
| `alignment.md` | `Alignment`, `Horizontal`, `Vertical` |

## Runtime

| File | Covers |
|---|---|
| `application.md` | `iced::application()` / `iced::daemon()` builders, window settings, font loading |
| `task.md` | `Task<Message>` — none, done, batch, perform, future, stream, chaining |
| `subscription.md` | `Subscription<Message>` — run_with, batch, stable identity, high-frequency data |
| `window.md` | `window::open`, `close`, `resize`, `Event`, `Id`, `Settings` |
| `keyboard.md` | `keyboard::Key`, `Modifiers`, `Named` (full variants), `listen`, `on_key_press` |
| `mouse.md` | `mouse::Event`, `Button`, `Cursor`, `Interaction`, `ScrollDelta` |
| `events.md` | `event::Event`, `Status`, `listen`, `listen_with`, `listen_raw`, `listen_url` |
| `touch.md` | `touch::Event`, `Finger` — touch input events |
| `stream.md` | `stream::channel`, `stream::try_channel` — async-to-stream bridge |
| `time.md` | `time::every`, `repeat`, `now`, `Duration`, `Instant` re-exports |
| `futures.md` | `futures::MaybeSend`, `Stream`, `StreamExt` re-exports |
| `debug.md` | `debug::time`, `time_with`, `enable`, `disable` — profiling utilities |
| `system.md` | `system::information`, `Information` — OS/CPU/GPU data (feature `sysinfo`) |

## Theming

| File | Covers |
|---|---|
| `theme.md` | `Theme`, `Theme::custom`, `Theme::custom_with_fn` |
| `theme-palette.md` | `Palette`, `palette::Extended`, `Background`, `Pair` |
| `catalog.md` | `Catalog` trait pattern for styling custom widgets (`StyleFn`, `Status`, `Style`) |

## Reading strategy

**Building new**: relevant `guide-*.md` → API refs it points to → canonical example in `../examples/` → write code → gotchas on bugs.

**Debugging**: rules in `../SKILL.md` → failure-modes table in the guide → gotchas in the API reference. `container.rs unwrap on None` panic → `guide-custom-overlays.md` custom overlay contract.

**Charts**: see chart-specific skill if available.
