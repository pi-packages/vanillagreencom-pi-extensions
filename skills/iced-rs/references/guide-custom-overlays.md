# Building Custom Overlays

Overlays render on top of the normal widget tree — tooltips, popovers, context menus, modals, drop-down lists. This guide is about when to use them and how to build them without hitting the "custom overlays are the #1 source of `container.rs` unwrap panics" pitfall.

**Read order**: this guide → `advanced-overlay.md` → `advanced-widget.md` (for the `overlay()` method on `Widget`).

## First rule: prefer built-in widgets

**Custom overlays are dangerous.** They're the #1 source of `container.rs: unwrap on None` panics in iced apps. Before implementing `Overlay` directly, check whether a built-in widget already solves your problem:

| You want | Use |
|---|---|
| A simple tooltip | `iced::widget::tooltip` |
| A popover/menu anchored to a trigger | `iced::widget::pick_list`, `combo_box`, or `float` |
| A modal dialog with scrim | `stack![base, opaque(scrim_and_dialog)]` — **not** a custom overlay |
| Drag ghost during DnD | `pin` widget + absolute positioning |
| Context menu | `mouse_area` that opens a `float` or `stack` layer |

See `examples/modal/src/main.rs` for the canonical modal pattern using `stack` + `opaque` (no custom overlay needed).

### Modal nesting order (exact — do not rearrange)

The double-opaque modal pattern has a specific nesting that agents commonly get wrong. Copy this exactly:

```
stack![
    base_content,                              // layer 0: the app behind the modal
    opaque(                                    // layer 1: OUTER opaque — blocks ALL events
        mouse_area(                            //   scrim click target
            center(                            //   center the dialog
                opaque(                        //   INNER opaque — stops dialog clicks
                    container(dialog_content)  //     from reaching the scrim's mouse_area
                )
            )
        )
        .on_press(Message::CloseModal)         //   scrim click → close
    )
]
```

**Why two `opaque` wrappers:**

```
Click on scrim (outside dialog):
  → outer opaque blocks base_content ✓
  → click passes through center (transparent)
  → reaches mouse_area.on_press → CloseModal ✓

Click inside dialog:
  → outer opaque blocks base_content ✓
  → inner opaque captures the event ✓
  → mouse_area.on_press NEVER fires → dialog stays open ✓

Click on base content (no modal):
  → stack has no overlay layer → event reaches base normally ✓
```

**Common mistakes:**
- Missing outer `opaque` → base content receives clicks through the scrim
- Missing inner `opaque` → clicking inside the dialog dismisses it (mouse_area fires)
- `opaque` wrapping the entire stack layer instead of just the scrim → keyboard events blocked even when modal is closed
- Putting `mouse_area` outside `opaque` → event ordering breaks

**All close paths must call the same handler.** Extract one helper:

```rust
fn close_modal(&mut self) {
    self.modal_phase.begin_close();  // or: self.show_modal = false;
}

// Wire from every close source:
Message::ScrimClicked => self.close_modal(),
Message::CancelPressed => self.close_modal(),
Message::SubmitPressed => { self.save(); self.close_modal(); }
Message::EscapePressed => self.close_modal(),
```

If none of those fit — e.g., you need precise viewport-aware positioning, non-rectangular shapes, or complex animation — keep reading.

## The Overlay trait

An overlay is produced by a widget's `Widget::overlay()` method. The runtime calls that method after laying out and drawing the main tree; if it returns `Some(Element)`, the runtime gives the overlay its own layout and draw pass **after** the normal tree, so it renders above everything.

```rust
pub trait Overlay<Message, Theme, Renderer>
where
    Renderer: Renderer,
{
    // Required
    fn layout(&mut self, renderer: &Renderer, bounds: Size) -> Node;
    fn draw(
        &self,
        renderer: &mut Renderer,
        theme: &Theme,
        style: &Style,
        layout: Layout<'_>,
        cursor: Cursor,
    );

    // Provided
    fn update(/* &Event by ref, no viewport arg */) { ... }
    fn operate(...) { ... }
    fn mouse_interaction(...) -> Interaction { ... }
    fn overlay<'a>(...) -> Option<Element<'a, ...>> { ... }
    fn index(&self) -> f32 { 1.0 }
}
```

Key differences from `Widget`:
- `layout()` takes `Size` (not `Limits`) — the overlay is expected to figure out its own size from the viewport bounds.
- `draw()` has **no `viewport: &Rectangle`** — the overlay owns its rendering layer.
- `update()` has **no `viewport`** either.
- No `size()` — overlays aren't slotted into parent layouts.

Full API: `advanced-overlay.md`.

## The custom overlay contract — MUST follow

When a parent widget implements `Widget::overlay()` and returns an overlay element, the runtime walks the overlay's layout/draw/update tree separately. Violating the contract causes panics in `container.rs` (the most common is `unwrap() on None` because a child layout node is missing).

### 1. `children()` returns a **fixed count**

The number of child trees must not depend on overlay visibility. If your overlay sometimes has 1 child and sometimes 2, the tree walker will desync.

```rust
// WRONG
fn children(&self) -> Vec<Tree> {
    if self.overlay_open {
        vec![Tree::new(&self.anchor), Tree::new(&self.popup)]
    } else {
        vec![Tree::new(&self.anchor)]
    }
}

// RIGHT
fn children(&self) -> Vec<Tree> {
    vec![Tree::new(&self.anchor), Tree::new(&self.popup)]  // always both
}
```

### 2. `diff()` reconciles **all children** regardless of visibility

Do not skip `diff()` calls for hidden children. The tree must be kept in sync even when the overlay isn't shown.

```rust
// WRONG
fn diff(&self, tree: &mut Tree) {
    tree.children[0].diff(&self.anchor);
    if self.overlay_open {
        tree.children[1].diff(&self.popup);  // skipped when closed!
    }
}

// RIGHT
fn diff(&self, tree: &mut Tree) {
    tree.children[0].diff(&self.anchor);
    tree.children[1].diff(&self.popup);  // always
}
```

### 3. `layout()` produces nodes matching `children()`

Same count, same order. If `children()` returns 2, `layout()` must produce a node with 2 child nodes.

### 4. `draw()` walks the same tree as `layout()`

Same count, same order.

### 5. Invalidate layout when overlay visibility changes

When `Widget::overlay()` starts returning `Some` or goes back to `None`, the tree shape effectively changes from the runtime's perspective. Call `shell.invalidate_layout()` in the update handler where you flip the flag:

```rust
Event::Mouse(mouse::Event::CursorEntered) => {
    if !state.show_overlay {
        state.show_overlay = true;
        shell.invalidate_layout();  // REQUIRED — popup layout nodes go stale otherwise
    }
}
```

Without this, popup layout nodes go stale, causing panics.

## The viewport rule — the most important thing

**When calling `Widget::update`/`draw`/`mouse_interaction`/`overlay` on a descendant from inside an overlay implementation, always pass `Rectangle::INFINITE` as the viewport, never the stored viewport captured from your parent's `overlay()` call.**

### Why

- iced's `scrollable::overlay` forwards `bounds.intersection(viewport)` down the chain.
- `iced_wgpu`'s per-paragraph text scissor turns inherited clips into invisible text.
- If you forward the original viewport, text inside popups will appear blank or scissor-clipped.

### Exception

Your overlay's own `Overlay::layout()` may still use its `bounds: Size` parameter for its own coordinate space. The rule only applies to viewports **propagated to descendant widgets**.

### Example

```rust
impl<'a, Message, Theme, Renderer> iced::advanced::overlay::Overlay<Message, Theme, Renderer>
    for MyOverlay<'a, Message, Theme, Renderer>
{
    fn update(
        &mut self,
        event: &Event,
        layout: Layout<'_>,
        cursor: Cursor,
        renderer: &Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, Message>,
    ) {
        // forwarding to a descendant widget
        self.content.as_widget_mut().update(
            self.tree,
            event,
            layout,
            cursor,
            renderer,
            clipboard,
            shell,
            &Rectangle::INFINITE,  // NOT self.viewport
        );
    }
}
```

## Positioning patterns

### Above-anchor preferred, fallback to below

```rust
fn layout(&mut self, _renderer: &Renderer, bounds: Size) -> Node {
    let popup_size = Size::new(self.content_width, self.content_height);

    // Preferred: above
    let above_y = self.anchor_bounds.y - popup_size.height - SPACING;
    let below_y = self.anchor_bounds.y + self.anchor_bounds.height + SPACING;

    let y = if above_y >= 0.0 {
        above_y
    } else if below_y + popup_size.height <= bounds.height {
        below_y
    } else {
        // Neither fits — clamp to viewport top
        0.0
    };

    // Horizontal: clamp to viewport edges
    let x = (self.anchor_bounds.x + self.anchor_bounds.width * 0.5 - popup_size.width * 0.5)
        .max(0.0)
        .min(bounds.width - popup_size.width);

    Node::new(popup_size).move_to(Point::new(x, y))
}
```

### Follow through scrollables

The `translation` parameter in `Widget::overlay()` is the accumulated parent translation (from scrollables). When you construct an overlay that remembers the anchor position, offset the anchor by `translation`:

```rust
fn overlay<'a>(
    &'a mut self,
    tree: &'a mut Tree,
    layout: Layout<'a>,
    _renderer: &Renderer,
    _viewport: &Rectangle,
    translation: Vector,
) -> Option<overlay::Element<'a, Message, Theme, Renderer>> {
    let anchor_bounds = layout.bounds() + translation;  // <-- offset by translation
    Some(overlay::Element::new(Box::new(MyOverlay { anchor_bounds, /* ... */ })))
}
```

Without this, overlays won't follow the anchor widget as it scrolls.

## Sibling overlays and z-index

`Overlay::index(&self) -> f32` returns a z-index for ordering multiple overlays. Higher renders on top. Default is `1.0` — override if you need deterministic ordering (e.g., a modal should be above a tooltip).

## Composite widgets forwarding overlays

If you're building a container widget that wraps children and some child might produce an overlay, use `overlay::from_children()`:

```rust
fn overlay<'a>(
    &'a mut self,
    tree: &'a mut Tree,
    layout: Layout<'a>,
    renderer: &Renderer,
    viewport: &Rectangle,
    translation: Vector,
) -> Option<overlay::Element<'a, Message, Theme, Renderer>> {
    overlay::from_children(
        &mut self.children,
        tree,
        layout,
        renderer,
        viewport,
        translation,
    )
}
```

This aggregates overlays from all children into a single optional overlay. Failing to forward overlays from children is a common reason tooltips/popovers inside composite widgets never appear.

## Copy-paste overlay template

If you must build a custom overlay (you've exhausted the built-in options above), copy this skeleton verbatim, then fill in the blanks. Do NOT restructure the tree shape — this exact shape is what avoids the `container.rs` panic.

```rust
use iced::advanced::layout::{self, Layout, Limits, Node};
use iced::advanced::overlay;
use iced::advanced::renderer;
use iced::advanced::widget::{self, Widget, tree};
use iced::advanced::{Clipboard, Shell};
use iced::{Element, Event, Length, Point, Rectangle, Size, Vector, mouse};

/// Wrapper widget that shows `content` as an overlay above `anchor` when `show` is true.
pub struct WithOverlay<'a, Message, Theme, Renderer> {
    anchor: Element<'a, Message, Theme, Renderer>,
    content: Element<'a, Message, Theme, Renderer>,
    show: bool,
}

// ── State ────────────────────────────────────────────────────────────
#[derive(Default)]
struct State {
    anchor_bounds: Rectangle,
}

// ── Widget impl ──────────────────────────────────────────────────────
impl<'a, Message, Theme, Renderer> Widget<Message, Theme, Renderer>
    for WithOverlay<'a, Message, Theme, Renderer>
where
    Renderer: renderer::Renderer,
{
    // ALWAYS two children regardless of `show`
    fn children(&self) -> Vec<widget::Tree> {
        vec![
            widget::Tree::new(&self.anchor),
            widget::Tree::new(&self.content),
        ]
    }

    // ALWAYS diff both children regardless of `show`
    fn diff(&self, tree: &mut widget::Tree) {
        tree.diff_children(&[&self.anchor as &dyn Widget<_, _, _>,
                             &self.content as &dyn Widget<_, _, _>]);
    }

    fn tag(&self) -> tree::Tag { tree::Tag::of::<State>() }
    fn state(&self) -> tree::State { tree::State::new(State::default()) }

    fn size(&self) -> Size<Length> { self.anchor.as_widget().size() }

    fn layout(&mut self, tree: &mut widget::Tree, renderer: &Renderer,
              limits: &Limits) -> Node {
        // Layout ONLY the anchor here; content is laid out in the overlay pass
        let node = self.anchor.as_widget_mut().layout(
            &mut tree.children[0], renderer, limits,
        );
        // Remember anchor bounds for overlay positioning
        tree.state.downcast_mut::<State>().anchor_bounds =
            Rectangle::new(Point::ORIGIN, node.size());
        node
    }

    fn draw(&self, tree: &widget::Tree, renderer: &mut Renderer, theme: &Theme,
            style: &renderer::Style, layout: Layout<'_>, cursor: mouse::Cursor,
            viewport: &Rectangle) {
        self.anchor.as_widget().draw(
            &tree.children[0], renderer, theme, style, layout, cursor, viewport,
        );
    }

    fn update(&mut self, tree: &mut widget::Tree, event: &Event,
              layout: Layout<'_>, cursor: mouse::Cursor, renderer: &Renderer,
              clipboard: &mut dyn Clipboard, shell: &mut Shell<'_, Message>,
              viewport: &Rectangle) {
        self.anchor.as_widget_mut().update(
            &mut tree.children[0], event, layout, cursor,
            renderer, clipboard, shell, viewport,
        );
    }

    fn mouse_interaction(&self, tree: &widget::Tree, layout: Layout<'_>,
                         cursor: mouse::Cursor, viewport: &Rectangle,
                         renderer: &Renderer) -> mouse::Interaction {
        self.anchor.as_widget().mouse_interaction(
            &tree.children[0], layout, cursor, viewport, renderer,
        )
    }

    fn overlay<'b>(&'b mut self, tree: &'b mut widget::Tree,
                   layout: Layout<'b>, renderer: &Renderer,
                   viewport: &Rectangle, translation: Vector,
    ) -> Option<overlay::Element<'b, Message, Theme, Renderer>> {
        if !self.show { return None; }

        let state = tree.state.downcast_ref::<State>();
        let anchor = state.anchor_bounds + translation;

        Some(overlay::Element::new(Box::new(ContentOverlay {
            content: &mut self.content,
            tree: &mut tree.children[1],
            anchor,
        })))
    }
}

// ── Overlay impl ─────────────────────────────────────────────────────
struct ContentOverlay<'a, 'b, Message, Theme, Renderer> {
    content: &'b mut Element<'a, Message, Theme, Renderer>,
    tree: &'b mut widget::Tree,
    anchor: Rectangle,
}

impl<'a, 'b, Message, Theme, Renderer>
    overlay::Overlay<Message, Theme, Renderer>
    for ContentOverlay<'a, 'b, Message, Theme, Renderer>
where
    Renderer: renderer::Renderer,
{
    fn layout(&mut self, renderer: &Renderer, bounds: Size) -> Node {
        let limits = Limits::new(Size::ZERO, bounds);
        let mut node = self.content.as_widget_mut().layout(
            self.tree, renderer, &limits,
        );

        // Position: above anchor preferred, below fallback, clamp horizontal
        let popup_h = node.size().height;
        let above_y = self.anchor.y - popup_h - 4.0;
        let below_y = self.anchor.y + self.anchor.height + 4.0;
        let y = if above_y >= 0.0 { above_y }
                else if below_y + popup_h <= bounds.height { below_y }
                else { 0.0 };
        let x = (self.anchor.center_x() - node.size().width * 0.5)
            .max(0.0)
            .min(bounds.width - node.size().width);

        node = node.move_to(Point::new(x, y));
        node
    }

    fn draw(&self, renderer: &mut Renderer, theme: &Theme,
            style: &renderer::Style, layout: Layout<'_>,
            cursor: mouse::Cursor) {
        self.content.as_widget().draw(
            self.tree, renderer, theme, style, layout, cursor,
            &Rectangle::INFINITE,  // ← CRITICAL: never forward parent viewport
        );
    }

    fn update(&mut self, event: &Event, layout: Layout<'_>,
              cursor: mouse::Cursor, renderer: &Renderer,
              clipboard: &mut dyn Clipboard,
              shell: &mut Shell<'_, Message>) {
        self.content.as_widget_mut().update(
            self.tree, event, layout, cursor, renderer, clipboard, shell,
            &Rectangle::INFINITE,  // ← CRITICAL
        );
    }

    fn mouse_interaction(&self, layout: Layout<'_>, cursor: mouse::Cursor,
                         renderer: &Renderer) -> mouse::Interaction {
        self.content.as_widget().mouse_interaction(
            self.tree, layout, cursor, &Rectangle::INFINITE, renderer,
        )
    }
}
```

**What this template guarantees:**
- `children()` returns **2** always (anchor + content) — tree shape never changes
- `diff()` reconciles **both** always — no conditional skip
- `layout()` lays out only anchor; content laid out in `Overlay::layout`
- `Rectangle::INFINITE` passed to all descendant calls in the overlay
- Positioning: above-preferred, below-fallback, horizontally clamped

**What's rigid in this template (the overlay contract — never change these):**
- `children()` returns exactly 2, always, regardless of `show`
- `diff()` reconciles both children every frame, regardless of `show`
- `overlay()` switches on `show` to return `Some` or `None` — but never changes child count
- All descendant calls in the overlay pass `&Rectangle::INFINITE`

**What's fully customizable (swap freely per use case):**
- **Positioning** — replace the math in `Overlay::layout()`. Anchor-relative, cursor-relative, centered, screen-edge-pinned, multi-monitor-aware — anything that produces a `Node` with a position
- **Content** — `self.content` is any `Element` tree. Forms, charts, images, nested scrollables, pane_grids — the overlay system doesn't care what's inside
- **Trigger** — hover, click, right-click, focus, long-press, keyboard shortcut, external state flag. Wire in `Widget::update()` and call `shell.invalidate_layout()` on transition
- **Animation** — fade, scale, slide. Drive from `Widget::update()` on `RedrawRequested`; the overlay's draw reads the interpolated value from `Tree` state
- **Multiple overlays** — one widget can return several via `overlay::Group::with_children(vec![...]).overlay()`
- **Z-index** — override `Overlay::index()` for deterministic layering (default 1.0)
- **Event routing** — the overlay's `update()` can capture, forward, or ignore events independently of the anchor

The template above is the simplest tooltip form. A dropdown menu changes the positioning; a context menu changes the trigger to right-click; a rich popover puts a form inside content. **The tree shape stays identical across all of these.**

## Testing your overlay

- Hover → show → hover away → hide → verify no panic
- Open overlay while inside a `scrollable`, then scroll → verify it follows (or hides if out of view)
- Open overlay, resize the window → verify positioning adjusts
- Open two overlays from the same root → verify z-index ordering
- Open overlay with content wider/taller than viewport → verify clamping

## Still unsure?

Re-read the "First rule" at the top of this file. 80% of the time, the right answer is `stack![base, opaque(modal)]` or the built-in `tooltip`/`float`/`pick_list` widgets. Custom overlays are a last resort.

## See also

- `advanced-overlay.md`
- `advanced-widget.md`
- `widget-tooltip.md`
- `widget-float.md`
- `widget-stack.md`
