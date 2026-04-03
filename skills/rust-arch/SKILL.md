---
name: rust-arch
description: "Rust architecture patterns and anti-patterns. Load for design reviews, refactoring, tech debt triage, hot-path audits, lock-free correctness, error strategy."
license: MIT
user-invocable: true
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# Architecture Patterns

Architecture anti-patterns, design review workflow, and quality gates for Rust codebases.

## Resources

Documentation lookup order: local skill files, ctx7 CLI, web fallback.

### ctx7 CLI

| Library | ctx7 ID | Use For |
|---------|---------|---------|
| Rust std | `/websites/doc_rust-lang_stable_std` | Standard library types, traits, atomics |
| crossbeam | `/crossbeam-rs/crossbeam` | Epoch-based reclamation, lock-free structures |
| tokio | `/websites/rs_tokio` | Async runtime, channels, synchronization |

## Architecture Review Workflow

A structured process for evaluating code architecture against the anti-patterns and principles defined in this skill.

### Step 1: Identify Files to Review

Categorize changed files by architectural layer:
- **Hot path** -- latency-sensitive data processing (zero-alloc, lock-free rules apply)
- **UI layer** -- presentation and event handling (UI anti-patterns apply)
- **Infrastructure** -- tools, build, persistence (architectural anti-patterns apply)
- **Cross-cutting** -- changes spanning multiple layers (all rules apply)

### Step 2: Run Anti-Pattern Detection

**Hot path files:**
- Check for `Mutex`, `RwLock` usage (reject per Mutex in Hot Path)
- Check for `Vec::new()`, `Box::new()`, `String::from()` (reject per Heap Allocation in Hot Path)
- Check for `Box<dyn ...>`, `&dyn ...` (reject per Dynamic Dispatch in Hot Path)
- Check for `HashMap` usage (flag per HashMap Lookup in Hot Path)

**All files:**
- Check for god objects (structs with 6+ responsibilities)
- Check for circular dependencies (module A imports B, B imports A)
- Check for tight coupling (concrete types instead of traits at boundaries)
- Check for leaky abstractions (internal details crossing module boundaries)

### Step 3: Score Architecture Dimensions

Use the Review Scoring Rubric to evaluate each dimension. Design Efficiency is weighted 2x.

### Step 4: Run Quality Gates

Use the Quality Gates checklist. Reject if any gate fails.

### Step 5: Classify Technical Debt

For issues not immediately fixable, classify using the Technical Debt Classification format.

### Output

Return findings as structured review with:
- Anti-pattern violations (with locations and fix recommendations)
- Dimension scores
- Quality gate pass/fail
- Technical debt items (if any)

## Skill Rules

### Architectural Anti-Patterns

Structural violations that degrade maintainability, testability, and scalability. Detect during design reviews and reject in PRs.

#### God Object

A struct with 6+ distinct responsibilities violates single-responsibility principle. It becomes a change magnet -- every feature touches it, making parallel development and testing difficult.

**Indicator:** Struct with methods spanning unrelated domains (parsing, routing, rendering, persistence).

**Fix:** Split into focused components, each owning one responsibility. Connect via trait interfaces.

#### Giant File

Files exceeding ~1,500 lines of implementation (or ~2,000 with tests) become difficult to navigate and can exceed tool context limits. They also tend to accumulate unrelated responsibilities.

**Indicator:** File line count growing beyond limits; multiple unrelated impl blocks.

**Fix:** Split by responsibility. Each module gets one clear responsibility and a minimal public API.

#### Tight Coupling

Using concrete types instead of trait interfaces between modules prevents dependency injection, makes unit testing require full dependency chains, and blocks implementation swaps.

**Incorrect (concrete dependency):**

```rust
struct OrderRouter {
    exchange: BinanceClient,  // Locked to one implementation
}
```

**Correct (trait-based dependency injection):**

```rust
struct OrderRouter<E: Exchange> {
    exchange: E,  // Any implementation works
}
```

#### Circular Dependencies

Modules that depend on each other create cycles that prevent clean layering, cause build ordering issues, and make it impossible to reason about data flow in isolation.

**Indicator:** Module A imports from B, module B imports from A.

**Fix:** Enforce layered architecture -- dependencies flow DOWN only. Extract shared types into a common lower-layer module that both depend on.

#### Leaky Abstraction

When internal implementation details cross module boundaries, consumers become coupled to internals. Any refactoring of the implementation then breaks all consumers.

**Indicator:** Public APIs expose internal types, implementation-specific error variants, or require callers to understand internal data layout.

**Fix:** Add a facade or interface layer. Expose only the contract (traits, public types) -- never the mechanism.

#### Shotgun Surgery

When a single logical change requires edits to many unrelated files, the related logic is scattered. This makes changes error-prone (easy to miss a file) and expensive to review.

**Indicator:** One feature change touches 5+ files across different modules.

**Fix:** Consolidate related logic. Group types and functions that change together into the same module.

#### Feature Envy

When code in one module heavily accesses another module's data -- calling multiple getters, destructuring its types, or computing derived values from its fields -- the logic belongs in the data owner, not the consumer.

**Indicator:** A function that takes a struct from another module and accesses 3+ of its fields.

**Fix:** Move the computation to the module that owns the data. Expose a method instead of exposing fields.

#### Layered Architecture

Applications should be organized in layers where dependencies flow DOWN only. Higher layers (UI, application logic) depend on lower layers (core engine, infrastructure). Lower layers never import from higher layers.

```
┌─────────────────────────────────────────┐
│           UI Layer (Presentation)       │
├─────────────────────────────────────────┤
│          Core Engine (Business Logic)   │
│    ┌─────────┬─────────┬─────────┐      │
│    │ Domain  │ Domain  │ Domain  │      │
│    │  Area A │  Area B │  Area C │      │
│    └─────────┴─────────┴─────────┘      │
├─────────────────────────────────────────┤
│        Infrastructure (Storage, IPC)    │
└─────────────────────────────────────────┘
```

**Rule:** Modules communicate via defined interfaces, never internal types. Each module owns its data and exposes only its public contract.

### Performance Anti-Patterns

Patterns that violate hot-path performance constraints. Must be rejected in latency-sensitive execution paths.

#### Mutex in Hot Path

`Mutex<T>` or `RwLock<T>` in latency-sensitive paths (order processing, tick handling) adds contention-dependent latency that violates sub-microsecond budgets.

**Detection:** `Mutex<T>` or `RwLock<T>` used in data flow paths.

**Fix:** Lock-free alternatives -- SPSC ring buffers, atomics, `ArcSwap` for read-heavy shared state.

#### Heap Allocation in Hot Path

`Vec::new()`, `Box::new()`, `String::from()` in hot paths cause allocator contention and unpredictable latency spikes from system allocator calls.

**Detection:** `Vec::new()`, `Box::new()`, `String::new()`, `format!()` in latency-sensitive code paths.

**Fix:** Pre-allocate at startup. Use object pools, bounded ring buffers, or stack-allocated arrays. All collections should be created with known capacity during initialization.

#### Dynamic Dispatch in Hot Path

`Box<dyn Trait>` and `&dyn Trait` in hot paths prevent inlining and add vtable lookup overhead on every call. In tight loops processing millions of events, this compounds.

**Detection:** `Box<dyn ...>` or `&dyn ...` in data processing paths.

**Fix:** Use generics with static dispatch. Monomorphization eliminates vtable overhead and enables inlining.

#### String Formatting in Hot Path

`format!()`, `to_string()`, and string interpolation allocate heap memory and invoke the formatting machinery on every call.

**Detection:** `format!()`, `.to_string()`, string concatenation in latency-sensitive paths.

**Fix:** Pre-allocated buffers written at startup, or `write!()` into a reusable buffer. For logging, use compile-time disabled macros or sampling in hot paths.

#### HashMap Lookup in Hot Path

`HashMap::get()` involves hashing, bucket traversal, and potential cache misses. In tight loops this adds measurable latency.

**Detection:** `HashMap` access patterns in data processing paths.

**Fix:** Array index with known-range keys, perfect hashing for static key sets, or pre-computed lookup tables populated at startup.

#### System Calls in Hot Path

File I/O, time syscalls (`SystemTime::now()`), and other kernel transitions add unpredictable latency from context switches and kernel scheduling.

**Detection:** File operations, system time calls, network I/O in latency-sensitive paths.

**Fix:** Batch operations, cache results (e.g., read time once per batch), and move I/O to background threads.

### Lock-Free Anti-Patterns

Concurrency mistakes in lock-free code -- wrong ordering, missing fences, lifetime escapes. Cause data races and corruption.

#### Wrong Atomic Ordering

Using `Relaxed` ordering everywhere is a common shortcut that causes data races on non-x86 architectures and can produce stale reads even on x86 under contention.

**Detection:** All atomics using `Ordering::Relaxed` without analysis of happens-before requirements.

**Fix:** Use proper Acquire/Release pairs. Producer stores with `Release`, consumer loads with `Acquire`. Use `SeqCst` only when total ordering across multiple atomics is required.

#### Missing Fence

When a memory fence is needed (e.g., between non-atomic writes and an atomic flag), omitting it allows the CPU to reorder operations, causing consumers to read partially-updated data.

**Detection:** Atomic flag patterns without corresponding `fence()` calls where non-atomic data must be visible.

**Fix:** Add appropriate fence. Verify correctness with loom (not TSAN -- TSAN does not understand fence-based synchronization).

#### TSAN for Fence-Based Code

Thread Sanitizer (TSAN) does not understand `std::sync::atomic::fence()` synchronization patterns. It will report false negatives (no warnings) for code that has real data races, and false positives for correct fence usage.

**Detection:** Using TSAN to validate code that relies on explicit fences for synchronization.

**Fix:** Use loom for verification of fence-based synchronization. Loom models the memory ordering rules correctly and explores possible interleavings.

#### Escaped Guard Lifetime

Crossbeam epoch-based reclamation guards protect memory from deallocation while the guard is alive. If a reference obtained under a guard escapes the guard's scope, the memory can be reclaimed while still referenced.

**Detection:** References derived from crossbeam `Guard`-protected loads that outlive the guard scope.

**Fix:** Process all data within the guard scope. Clone or copy needed values before dropping the guard.

#### ABA Problem

Compare-and-swap (CAS) succeeds if the current value matches the expected value. If a value changes from A to B and back to A between the read and CAS, the CAS succeeds despite the intermediate mutation -- potentially corrupting data structures.

**Detection:** CAS loops without generation counters or hazard pointers.

**Fix:** Use tagged pointers (pack a generation counter into the pointer) or hazard pointer schemes that detect intermediate modifications.

### Error Handling & Data Integrity

Error handling strategy and data immutability rules. Violations cause silent data corruption or missed failures.

#### Fail Fast Over Silent Degradation

Critical execution paths must fail loudly rather than silently degrade. Skipping invalid data, queuing indefinitely on missing connections, or approximating on validation failure all hide problems until they compound into production incidents.

- Invalid data: panic or return error immediately; never skip or substitute
- Missing connection: error immediately; never queue indefinitely
- Validation failure: halt processing; never approximate

**Exception:** Observability tools (profilers, metrics, logging) should degrade gracefully with warnings rather than crash the application.

#### Data Immutability After Reception

Market data and other time-series inputs must be frozen after normalization. Mutating received data breaks audit trails, makes replays non-deterministic, and risks one consumer's transformation affecting another's view.

- Use `Copy` types for small value types (ticks, quotes, bars)
- Transformations create new instances; never mutate originals
- Freeze data after the normalization/parsing step

#### Investigate Errors Before Dismissal

Never dismiss errors, warnings, or unexpected behavior without investigation. Errors that "seem harmless" often indicate silently broken functionality discovered too late.

Investigation checklist:
1. **Trace to source** -- where is this coming from?
2. **Understand intent** -- what was supposed to happen?
3. **Verify impact** -- is functionality silently broken?
4. Only dismiss after confirming harmless (document why in a comment)

### Review Process

Architecture review scoring, quality gates, and technical debt classification. Provides consistent evaluation framework.

#### Review Scoring Rubric

Architecture reviews score across five dimensions:

| Dimension | Weight | Pass | Focus |
|-----------|--------|------|-------|
| **Design Efficiency** | 2x | >=90 | No anti-patterns in hot path |
| Modularity | 1x | >=80 | Clean boundaries, single responsibility |
| Maintainability | 1x | >=80 | Easy to modify, understand |
| Testability | 1x | >=80 | Easy to unit test, mock |
| Scalability | 1x | >=80 | Can handle growth |

**Formula:** (Design Efficiency x 2 + Modularity + Maintainability + Testability + Scalability) / 6

**Pass criteria:** Overall >=80 AND Design Efficiency >=90.

##### Scoring Guide

**Design Efficiency (0-100):**
- 100: Zero anti-patterns, optimal data flow
- 90: Minor inefficiencies, no hot-path issues
- 70: Some anti-patterns, not in critical path
- 50: Anti-patterns affect performance
- <50: Critical anti-patterns in hot path

**Modularity (0-100):**
- 100: Perfect separation, clear interfaces
- 80: Good boundaries, minor coupling
- 60: Some tight coupling
- <60: Circular dependencies or god objects

#### Quality Gates

Every architecture review must pass these gates before approval:

- [ ] Follows layered architecture (dependencies flow down)
- [ ] No circular dependencies
- [ ] Abstractions at module boundaries
- [ ] No hot-path anti-patterns
- [ ] Platform differences handled explicitly
- [ ] Pre-allocation strategy documented
- [ ] Error handling strategy clear

**Reject if any gate fails.**

#### Technical Debt Classification

Classify discovered technical debt by impact and urgency:

| Priority | Impact | Timeline | Example |
|----------|--------|----------|---------|
| P1 Urgent | Blocks performance budget | Fix immediately | Mutex in tick processing |
| P2 High | Architectural violation | Fix this cycle | Circular dependency |
| P3 Normal | Code smell, tech debt | Plan for backlog | Missing abstraction |
| P4 Low | Minor improvement | Track only | Naming, docs |

##### Tracking Format

```
TD-XXX: [Short description]
- Location: module/file description
- Impact: [Performance|Maintainability|Safety]
- Priority: P1|P2|P3|P4
- Estimate: 1-5 points
- Notes: [Additional context]
```

### UI Anti-Patterns

UI-layer patterns that cause frame drops, frozen interfaces, or memory growth.

#### Per-Item UI Update

Updating UI elements individually in a loop triggers a redraw per item, causing frame drops when processing collections.

**Detection:** Loop with individual widget updates or state invalidations.

**Fix:** Batch updates and trigger a single invalidation after the batch completes.

#### UI Thread Blocking

Synchronous I/O (file reads, network calls, database queries) on the main/UI thread blocks the event loop, freezing the interface for the duration of the operation.

**Detection:** Sync I/O calls in message handlers or view functions.

**Fix:** Move I/O to async tasks or background threads. Communicate results back via messages.

#### Unbounded Collection

Collections that grow without bounds (log buffers, event histories, undo stacks) eventually consume all available memory, causing OOM or degraded performance from allocation pressure.

**Detection:** `Vec`, `VecDeque`, or other collections with `push` but no eviction or capacity limit.

**Fix:** Use bounded buffers with a maximum capacity. Evict oldest entries when full (ring buffer pattern).
