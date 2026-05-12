// Port of flightdeck-daemon.bash::{drain_oc_wake_events,
// recover_stranded_oc_drains}.
//
// Atomically drain the wake-events log under SESSION_LOCK. Each line
// is emitted as a JSONL record. Snapshot + rm pattern matches
// drain_events: lock-held read+remove guarantees no subscriber can
// append a record we miss. Stranded .draining.<pid> snapshots from
// crashed drains are folded back in first.
//
// The bash helper reuses src/state/locking.ts::lockedEventsDrain which
// already implements the same flock-held mv + cat + draining-orphan
// sweep. We expose a thin wrapper that adapts the call signature.

import { lockedEventsDrain } from "../../state/locking.ts";

export interface DrainResult { lines: string[]; status: number | null }

export function drainOcWakeEvents(sessionLock: string, wakeEventsLog: string): DrainResult {
	const r = lockedEventsDrain(sessionLock, wakeEventsLog);
	const lines = (r.stdout ?? "").split("\n").filter((l) => l.length > 0);
	return { lines, status: r.status };
}
