# pi-caveman

![/caveman command autocomplete](https://raw.githubusercontent.com/vanillagreencom/vstack/main/pi-extensions/pi-caveman/assets/command-autocomplete.png)

Native Pi caveman communication mode: fewer output tokens, same technical accuracy.

## Highlights

- Identity-framed opener with per-mode Bad/Good few-shot anchors.
- Lite is filler-free full-sentence prose, explicitly distinct from caveman shorthand.
- Anti-markdown rule names the forbidden tokens (`**Bold**`, `## Heading`, `### Sub`) so chat replies don't render as doc pages.
- Clarity-escape regex limited to literal destructive ops; no false fires on "confused", "security", or "clarify".
- Silent clarity escape (no marker line) prevents the `Caveman <verb>:` label leak that comes from teaching the model a sentinel pattern.
- Boundary clause covers code, commits/PRs, reviews, and external writes (issue bodies, PR comments, chat, email).
- Per-session warning when `claude-bridge` is installed with `includeCavemanHook: false` while caveman is active, so the directive isn't silently swallowed.
- Live-validated across multi-turn conversations on Opus 4.7 (claude-bridge) and gpt-5.5 (openai-codex native).

## Install

Via [npm](https://www.npmjs.com/package/@vanillagreen/pi-caveman):

```bash
pi install npm:@vanillagreen/pi-caveman
```

Via [vstack](https://github.com/vanillagreencom/vstack):

```bash
cargo install --git https://github.com/vanillagreencom/vstack.git vstack
vstack add vanillagreencom/vstack --pi-extension pi-caveman --harness pi -y
```

Restart Pi after installation.

## Commands

| Command | Action |
| --- | --- |
| `/caveman` | Toggle the current session between off and the last active mode. |
| `/caveman:lite\|full\|ultra\|micro` | Set a session override mode. |
| `/caveman:toggle` | Toggle the session override between off and the last active mode. |
| `/caveman off` | Disable caveman mode for the current session. |
| `/caveman status` | Show current mode and whether it comes from settings or a session override. |
| `/caveman debug` | Show resolved mode, settings paths, legacy-key conflicts, and the rendered prompt block. |

Arguments support autocomplete.

## Modes

| Mode | Style |
| --- | --- |
| `lite` | Professional full sentences, but no filler or hedging. |
| `full` | Classic terse caveman; fragments are OK. |
| `ultra` | Maximum English compression with abbreviations and arrows. |
| `micro` | Shortest prompt injection for token-sensitive sessions. |

## Behavior

- The extension injects instructions in `before_agent_start`; it does not post-process model output.
- The canonical setting is `mode` (`off`, `lite`, `full`, `ultra`, or `micro`). Older `enabled` + `defaultMode` settings are only read as a local fallback.
- `/caveman` commands create a per-session override when `sessionOverrideAllowed` is on. Changing the extension-manager `mode` setting clears the session override so the configured mode takes over immediately.
- Session override state and the last active mode persist in the Pi session and restore from the active branch.
- Settings live in Pi/vstack `settings.json`; project settings override user settings.
- QOL can use the caveman bridge for its compact statusline badge and `Alt+C` editor shortcut.
- The hard clarity-safety escape only fires when the user prompt names an explicit irreversible destructive operation (force-push, drop table, rm -rf, hard reset, destructive/irreversible). The model still self-elects plain prose for genuine destructive confirmations via an inline self-clarity rule, but no longer escapes on soft signals like "confused" or "security".
- The clarity-safety branch writes plain prose for the turn and does **not** emit any marker line. Caveman resumes automatically next turn via re-injection. (Prior versions used a literal `Caveman resume` sentinel; the model generalized that as a `Caveman <verb>:` labeling pattern and leaked it back into normal output — e.g. `Caveman ask:`, `Caveman question:`.)
- Boundary toggles keep caveman out of text destined for other systems: code/identifiers, commit messages and PR descriptions, formal reviews, and external writes (issue/PR bodies + comments, code review, chat/email). Caveman is for in-chat replies.

## Claude-bridge users

pi-caveman injects its directive into Pi's `systemPrompt`. When you use `claude-bridge` as your provider, claude-bridge builds its own `systemPrompt` from Claude Code's preset and only forwards pi-side hooks that you explicitly enable. The caveman directive is one of those hooks.

- Set `@vanillagreen/pi-claude-bridge` → `includeCavemanHook: true` in the extension manager. The default is **off**.
- If caveman is active and the bridge is installed with this flag off, pi-caveman warns once at session start. Run `/caveman debug` to confirm the resolved bridge setting.
- Non-bridge providers (native Pi providers) receive the caveman block as part of Pi's regular `systemPrompt` and do not need this flag.
