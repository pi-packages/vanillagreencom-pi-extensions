---
name: perf-ebpf
description: "Load when writing eBPF programs with Aya, choosing program types (tracepoint, kprobe, XDP), selecting map patterns, running bpftrace one-liners, or debugging BPF verifier errors. Kernel-level observability and tracing in Rust."
license: MIT
user-invocable: true
metadata:
  author: vanillagreen
  version: "1.0.0"
---

# eBPF/Aya Observability

Kernel-level observability with eBPF and the Aya framework in Rust. Covers project setup, program types, map patterns, bpftrace diagnostics, and verifier debugging.

## Resources

### ctx7 CLI

| Library | ctx7 ID | Use For |
|---------|---------|---------|
| aya | `/aya-rs/book` | Aya eBPF framework |
| aya-bpf | `/aya-rs/aya` | Kernel-side eBPF helpers |
| bpftrace | `/bpftrace/bpftrace` | bpftrace reference |

## Skill Rules

### Aya Framework

Aya project setup, program type selection, and map patterns. Covers workspace layout, kernel-side vs userspace crate separation, program type matching to use case, and efficient kernel-to-userspace data transfer via maps.

#### Project Setup

Workspace layout: `my-ebpf-ebpf/` (kernel-side `#![no_std]`/`#![no_main]`, target: bpf), `my-ebpf/` (userspace with tokio), `xtask/` (build helper). Generate with `cargo generate https://github.com/aya-rs/aya-template`. Build: `cargo xtask build-ebpf && cargo xtask run`. Kernel-side requires `#[panic_handler]` that calls `core::hint::unreachable_unchecked()`. Maps declared with `#[map]` attribute.

**Incorrect (flat layout, no workspace separation):**

```rust
// Single crate trying to do both kernel and userspace
#![no_std]
use std::net::TcpStream; // ERROR: no std in BPF programs
```

**Correct (proper workspace layout):**

```rust
// my-ebpf-ebpf/src/main.rs (kernel-side)
#![no_std]
#![no_main]

use aya_ebpf::{macros::tracepoint, programs::TracePointContext};

#[tracepoint]
pub fn my_prog(ctx: TracePointContext) -> u32 {
    0
}

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    unsafe { core::hint::unreachable_unchecked() }
}

// my-ebpf/src/main.rs (userspace)
use aya::programs::TracePoint;
use tokio::signal;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut ebpf = aya::Ebpf::load(aya::include_bytes_aligned!(
        concat!(env!("OUT_DIR"), "/my-ebpf")
    ))?;
    let program: &mut TracePoint = ebpf.program_mut("my_prog").unwrap().try_into()?;
    program.load()?;
    program.attach("syscalls", "sys_enter_read")?;
    signal::ctrl_c().await?;
    Ok(())
}
```

#### Program Type Selection

Program type selection: `#[tracepoint]` for syscall entry/exit (stable, low overhead), `#[kprobe]`/`#[kretprobe]` for any kernel function (flexible, slightly higher overhead), `#[uprobe]` for userspace function tracing without recompilation, `#[xdp]` for packet processing before kernel stack (lowest latency), `#[perf_event]` for hardware counter sampling.

Decision: tracepoints for syscall monitoring, uprobes for application tracing, XDP for network path.

**Incorrect (kprobe for stable syscall tracing):**

```rust
// kprobe on __x64_sys_read — breaks across kernel versions
#[kprobe]
pub fn trace_read(ctx: ProbeContext) -> u32 {
    // Kernel function names change between versions
    0
}
```

**Correct (tracepoint for syscall tracing, kprobe for internal functions):**

```rust
// Tracepoint: stable ABI, survives kernel upgrades
#[tracepoint]
pub fn trace_read(ctx: TracePointContext) -> u32 {
    // tracepoint:syscalls:sys_enter_read — stable interface
    0
}

// Kprobe: only when tracing internal kernel functions not exposed as tracepoints
#[kprobe]
pub fn trace_tcp_internal(ctx: ProbeContext) -> u32 {
    // kprobe:tcp_rcv_established — no tracepoint equivalent
    0
}

// XDP: packet processing before kernel stack (lowest latency path)
#[xdp]
pub fn filter_packets(ctx: XdpContext) -> u32 {
    // Runs before sk_buff allocation — minimal overhead
    xdp_action::XDP_PASS
}
```

#### Map Patterns

Use `RingBuf` (kernel >=5.8) over `PerfEventArray` for events — lower overhead, preserved cross-CPU ordering, variable-size records. Pattern: kernel reserves with `EVENTS.reserve::<MyEvent>(0)`, writes, submits. Userspace reads via `AsyncFd` for async polling. Use `HashMap` for per-PID/per-connection state. Use `PerCpuArray` for lock-free per-CPU counters (aggregate in userspace).

**Incorrect (PerfEventArray when RingBuf available):**

```rust
// Kernel-side: PerfEventArray has per-CPU buffers, no cross-CPU ordering
#[map]
static EVENTS: PerfEventArray<MyEvent> = PerfEventArray::with_max_entries(1024, 0);

// Loses ordering when events fire on different CPUs
EVENTS.output(&ctx, &event, 0);
```

**Correct (RingBuf for events, HashMap for state, PerCpuArray for counters):**

```rust
// Kernel-side: RingBuf preserves cross-CPU ordering
#[map]
static EVENTS: RingBuf = RingBuf::with_byte_size(256 * 1024, 0);

#[map]
static CONN_STATE: HashMap<u32, ConnInfo> = HashMap::with_max_entries(10240, 0);

#[map]
static COUNTERS: PerCpuArray<u64> = PerCpuArray::with_max_entries(8, 0);

// Submit event via RingBuf — reserve, write, submit
if let Some(mut entry) = EVENTS.reserve::<MyEvent>(0) {
    entry.write(MyEvent { pid, latency_ns });
    entry.submit(0);
}

// Per-PID state lookup
if let Some(info) = unsafe { CONN_STATE.get(&pid) } {
    // use connection state
}

// Lock-free per-CPU counter increment
if let Some(counter) = unsafe { COUNTERS.get_ptr_mut(0) } {
    unsafe { *counter += 1 };
}
```

### bpftrace Diagnostics

Production-safe bpftrace one-liners for syscall analysis, latency histograms, scheduling diagnostics, and network troubleshooting. No recompilation required, negligible overhead.

#### Production-Safe One-Liners

Production-safe diagnostic one-liners that require no recompilation and add negligible overhead.

- **Syscall count by process**: `bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'`
- **Read latency histogram for specific process**: `bpftrace -e 'tracepoint:syscalls:sys_enter_read /comm == "myapp"/ { @start[tid] = nsecs; } tracepoint:syscalls:sys_exit_read /comm == "myapp"/ { @us = hist((nsecs - @start[tid]) / 1000); delete(@start[tid]); }'`
- **Why threads are getting descheduled**: `bpftrace -e 'tracepoint:sched:sched_switch { @[kstack] = count(); }'`

**Incorrect (strace for production diagnostics):**

```bash
# strace attaches via ptrace — stops process on every syscall
# 10-100x overhead, unsafe for production
strace -p $(pidof myapp) -c
```

**Correct (bpftrace with negligible overhead):**

```bash
# Syscall count by process — runs in-kernel, no ptrace
bpftrace -e 'tracepoint:raw_syscalls:sys_enter { @[comm] = count(); }'

# Read latency histogram filtered to specific process
bpftrace -e '
tracepoint:syscalls:sys_enter_read /comm == "myapp"/ {
    @start[tid] = nsecs;
}
tracepoint:syscalls:sys_exit_read /comm == "myapp"/ {
    @us = hist((nsecs - @start[tid]) / 1000);
    delete(@start[tid]);
}'

# Scheduling analysis — why threads get descheduled
bpftrace -e 'tracepoint:sched:sched_switch { @[kstack] = count(); }'
```

#### Network Diagnosis

For exchange connectivity: `bpftrace -e 'kprobe:tcp_retransmit_skb { @[kstack] = count(); }'` (retransmit sources), `bpftrace -e 'kprobe:tcp_rcv_established { @bytes = hist(arg2); }'` (receive buffer sizes). XDP in Aya for dropping irrelevant multicast at line rate before kernel stack processing.

**Incorrect (tcpdump for retransmit analysis):**

```bash
# tcpdump copies every packet to userspace — high overhead on busy links
# Must post-process pcap to find retransmits
tcpdump -i eth0 -w capture.pcap
# Then: tshark -r capture.pcap -Y "tcp.analysis.retransmission"
```

**Correct (bpftrace for targeted network diagnostics):**

```bash
# Retransmit sources with kernel stack trace — zero packet copying
bpftrace -e 'kprobe:tcp_retransmit_skb { @[kstack] = count(); }'

# Receive buffer size distribution
bpftrace -e 'kprobe:tcp_rcv_established { @bytes = hist(arg2); }'
```

```rust
// XDP program: drop irrelevant multicast at line rate
// Runs before sk_buff allocation — no kernel stack overhead
#[xdp]
pub fn multicast_filter(ctx: XdpContext) -> u32 {
    match try_filter(&ctx) {
        Ok(action) => action,
        Err(_) => xdp_action::XDP_PASS,
    }
}

fn try_filter(ctx: &XdpContext) -> Result<u32, ()> {
    let eth = unsafe { ptr_at::<EthHdr>(ctx, 0)? };
    // Drop multicast groups we don't subscribe to
    if is_irrelevant_multicast(unsafe { &*eth }) {
        return Ok(xdp_action::XDP_DROP); // Dropped before kernel stack
    }
    Ok(xdp_action::XDP_PASS)
}
```

### Verifier & Debugging

BPF verifier error resolution and program inspection with bpftool. Covers common verifier rejections, capability requirements, and runtime debugging of loaded programs and maps.

#### Verifier Error Resolution

Common verifier error to fix table:

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid mem access 'scalar'` | Missing null check after map lookup | Add `if let Some(val) = map.get(&key)` guard |
| `back-edge detected` | Unbounded loop | Use bounded loop or `bpf_loop()` (kernel >=5.17) |
| `Type not found` | Stale vmlinux bindings | Regenerate with `aya-tool generate` |
| `Permission denied` | Missing capabilities | Need `CAP_BPF` or `CAP_SYS_ADMIN` |

Debug with: `RUST_LOG=debug cargo xtask run 2>&1 | grep verifier`

**Incorrect (unchecked map access):**

```rust
#[tracepoint]
pub fn my_prog(ctx: TracePointContext) -> u32 {
    let pid = ctx.pid();
    // Verifier rejects: map lookup can return null
    let val = unsafe { STATE.get(&pid) };
    let count = unsafe { *val }; // "invalid mem access 'scalar'"
    0
}
```

**Correct (null check after every map lookup):**

```rust
#[tracepoint]
pub fn my_prog(ctx: TracePointContext) -> u32 {
    let pid = ctx.pid();
    // Verifier accepts: null check before dereference
    if let Some(val) = unsafe { STATE.get(&pid) } {
        let count = *val;
        // use count
    }
    0
}
```

#### Inspecting Loaded Programs

`bpftool prog list` for loaded programs, `bpftool prog dump xlated name my_prog` for translated bytecode, `bpftool map show` for active maps, `bpftool map dump name MY_MAP` for map contents. Use for verifying programs loaded correctly and maps are being populated.

**Incorrect (guessing whether programs are loaded):**

```bash
# No visibility into BPF subsystem state
# Assuming program loaded because no error was printed
cargo xtask run &
# ... hope it works
```

**Correct (bpftool for runtime inspection):**

```bash
# List all loaded BPF programs
bpftool prog list
# Output: 42: tracepoint name my_prog tag abc123 ...

# Dump translated bytecode for a specific program
bpftool prog dump xlated name my_prog

# List all active BPF maps
bpftool map show
# Output: 7: ringbuf name EVENTS ...

# Dump map contents to verify data flow
bpftool map dump name CONN_STATE

# Combined: verify program is attached and map is populated
bpftool prog list | grep my_prog && bpftool map dump name EVENTS
```
