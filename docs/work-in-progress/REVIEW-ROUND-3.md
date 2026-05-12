# Review round 3 — `.env` loader edge cases

Round 2 fixes verified. 5 of 5 important items resolved cleanly.

Three new findings, all in the `.env` loader fast-path / bash subprocess.
Report: `review-bugs-round3.md`.

## Important — must fix

### 1. `.env` unset-variable parity (`set -u`)
- **File:** `src/shared/project.ts:122-140`
- **Bug:** bash callers source `.env` under `set -euo pipefail`. TS
  loader uses `set -ea` only. `.env` containing `FD_UNSET=$NO_SUCH_ENV`:
  TS exits 0 and sets `FD_UNSET=""`; bash exits nonzero "unbound
  variable". A typo like `FD_STATE_DIR=$MISPELLED_VAR` silently routes
  state to default in TS while bash fails loud.
- **Fix:** add `set -u` (or full `set -euo pipefail`) to the bash
  loader script. Add a regression test against `.env` with an
  unset-var reference and assert both implementations exit nonzero
  with the var unset.

### 2. `.env` native fast-path drops/misparses inline comments + semicolon assignments
- **File:** `src/shared/project.ts:41-80,144-153`
- **Bugs (3 concrete repros):**
  - `.env` `FD_COMMENT=foo # comment`: TS native sets
    `FD_COMMENT='foo # comment'`; bash sets `FD_COMMENT='foo'`.
  - `.env` `FD_A=one; FD_B=two`: heuristic routes to bash subprocess,
    but the declared-key scan imports only `FD_A`; bash sets both.
  - `export FD_A=1 FD_B=2`: same drop-on-second-key issue + escaped
    quotes mishandled.
- **Fix:** tighten the native fast-path heuristic. Route any line
  containing `#` after the value (not in quotes), bare `;`, multi-key
  `export`, escape sequences, or any whitespace-separated extra
  assignment to the bash subprocess. For the bash fallback's declared-
  key scan, either parse assigned variable names with bash itself
  (`compgen -v` snapshot diff) or reject compound same-line
  assignments with a clear error.
- **Tests:** add three parity tests against the three concrete inputs
  above; assert TS and bash produce identical env state.

## Nice — fix if you have time

### 3. Fractional `FD_ADAPTER_READ_TIMEOUT_SEC` rounded up to 1s
- **File:** `src/bin/pane-poll.ts:349-350,402-403`
- **Bug:** code uses `Number.parseInt(adapterTimeout, 10)` and
  `Math.max(1, ...)`. `FD_ADAPTER_READ_TIMEOUT_SEC=0.2` becomes 1s for
  Pi bridge and `gh` paths. Old `timeout 0.2s` wrapper honored
  sub-second values; `curl --max-time 0.2` still does.
- **Fix:** parse with `Number.parseFloat`, validate finite positive,
  compute `Math.ceil(seconds * 1000)` for the millisecond-based
  spawn timeout. Drop the 1s minimum.

## After this round

These are edge cases. If you disagree with any finding's
prioritization (e.g. the inline-comment behavior is actually expected
because most projects don't put `#` mid-value), bridge me first.
Otherwise land them with tests, run the suite, and report.

After this round the parent will dispatch the **daemon run-loop port**
— the final major task. The .env / preflight foundation is now solid
enough that the run-loop port can build on it.
