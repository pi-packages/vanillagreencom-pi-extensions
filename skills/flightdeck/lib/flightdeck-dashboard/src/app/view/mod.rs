pub mod conversations;
pub mod daemon;
pub mod decisions;
pub mod fx;
pub mod live_feed;
pub mod merges;
pub mod modals;
pub mod overview;

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Tabs};
use ratatui::Frame;

use crate::app::command::SnapshotSource;
use crate::app::model::{Model, Tab};
use crate::app::theme::Palette;
use crate::state::snapshot::{SessionState, Staleness};

pub fn render(frame: &mut Frame<'_>, model: &Model) {
    let theme = model.palette();
    let area = frame.area();
    let pause_height = u16::from(model.snapshot.paused_for_user.is_some());
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(pause_height),
            Constraint::Length(3),
            Constraint::Min(3),
            Constraint::Length(2),
        ])
        .split(area);

    render_status(frame, chunks[0], model, theme);
    render_pause_banner(frame, chunks[1], model, theme);
    render_tabs(frame, chunks[2], model, theme);
    render_body(frame, chunks[3], model, theme);
    render_footer(frame, chunks[4], model, theme);

    match model.modal {
        crate::app::model::ModalState::Help => modals::render_help(frame, area, model, theme),
        crate::app::model::ModalState::DecisionDetail => {
            modals::render_decision_detail(frame, area, model, theme);
        }
        crate::app::model::ModalState::None => {}
    }
}

fn render_status(frame: &mut Frame<'_>, area: Rect, model: &Model, theme: &Palette) {
    let snapshot = &model.snapshot;
    let owner = owner_label(model);
    let elapsed = snapshot
        .started_at
        .map(|started| human_duration(started, model.now))
        .unwrap_or_else(|| String::from("unknown"));
    let state_counts = state_counts_label(&snapshot.counts.by_state);

    let mut spans = vec![
        Span::styled(" Flightdeck ", theme.title()),
        Span::raw(" "),
        Span::styled("session ", theme.status_label()),
        Span::raw(snapshot.session_id.as_str()),
        Span::raw("  "),
        Span::styled("owner ", theme.status_label()),
        Span::raw(owner),
        Span::raw("  "),
        Span::styled(daemon_label(model), theme.muted()),
        Span::raw("  "),
        Span::styled("elapsed ", theme.status_label()),
        Span::raw(elapsed),
        Span::raw("  "),
        Span::styled(
            format!(
                "AH:{} ISS:{} WF:{}",
                snapshot.counts.adhoc, snapshot.counts.issue, snapshot.counts.workflow
            ),
            theme.info(),
        ),
    ];
    if !state_counts.is_empty() {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(state_counts, theme.muted()));
    }
    spans.push(Span::raw("  "));
    match snapshot.staleness(model.now) {
        Staleness::Fresh => spans.push(Span::styled(" fresh ", theme.muted())),
        Staleness::WarnAfter(age) => spans.push(Span::styled(
            format!(" stale-warn {} ", duration_label(age)),
            theme.warning(),
        )),
        Staleness::StaleAfter(age) => spans.push(Span::styled(
            format!(" stale {} ", duration_label(age)),
            theme.error(),
        )),
    }
    if snapshot.terminated {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(" ✔ session complete ", theme.ok()));
    }
    if model.is_observer() {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(" observer ", theme.warning()));
    }
    if let Some(error) = &model.error {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(format!(" ERR {error} "), theme.error()));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(theme.border_active())
        .title(Span::styled(" Flightdeck ", theme.title()));
    frame.render_widget(
        Paragraph::new(Line::from(spans))
            .block(block)
            .style(theme.status()),
        area,
    );
}

fn render_pause_banner(frame: &mut Frame<'_>, area: Rect, model: &Model, theme: &Palette) {
    if area.height == 0 {
        return;
    }
    let Some(pause) = &model.snapshot.paused_for_user else {
        return;
    };
    let entry_id = pause.entry_id.as_deref().unwrap_or("unknown-entry");
    let mut text = format!(" PAUSED FOR USER · {entry_id} · {}", pause.reason);
    if let Some(prompt) = pause
        .prompt_text
        .as_deref()
        .filter(|prompt| !prompt.is_empty())
    {
        text.push_str(" · ");
        text.push_str(&trim_for_header(prompt, 96));
    }
    frame.render_widget(Paragraph::new(text).style(theme.pause()), area);
}

fn render_tabs(frame: &mut Frame<'_>, area: Rect, model: &Model, theme: &Palette) {
    let labels = model
        .tabs_enabled
        .iter()
        .map(|tab| Line::from(Span::raw(model.tab_label(*tab))))
        .collect::<Vec<_>>();
    let fx_hint = fx::tab_switch_hint(model);
    let title = if fx_hint.is_empty() {
        String::from(" tabs ")
    } else {
        format!(" tabs {fx_hint} ")
    };
    let tabs = Tabs::new(labels)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme.border())
                .title(Span::styled(title, theme.muted())),
        )
        .select(model.selected_tab_position())
        .style(theme.tab_inactive())
        .highlight_style(theme.tab_active());
    frame.render_widget(tabs, area);
}

fn render_body(frame: &mut Frame<'_>, area: Rect, model: &Model, theme: &Palette) {
    match model.current_tab {
        Tab::Overview => overview::render(frame, area, model, theme),
        Tab::LiveFeed => live_feed::render(frame, area, model, theme),
        Tab::Conversations => conversations::render(frame, area, model, theme),
        Tab::Merges => merges::render(frame, area, model, theme),
        Tab::Decisions => decisions::render(frame, area, model, theme),
        Tab::Daemon => daemon::render(frame, area, model, theme),
    }
}

fn render_footer(frame: &mut Frame<'_>, area: Rect, model: &Model, theme: &Palette) {
    let text = if model.ui.filter_open {
        let prefix = if model.feed_filter.error.is_some() {
            " regex invalid > "
        } else {
            " filter > "
        };
        Line::from(vec![
            Span::styled(prefix, theme.filter()),
            Span::styled(model.feed_filter.input.clone(), theme.filter()),
        ])
    } else {
        let noisy = if model.ui.hide_noise {
            "noise: hidden"
        } else {
            "noise: shown"
        };
        let filter = if model.feed_filter.pattern.is_empty() {
            "filter:off".to_owned()
        } else {
            format!("filter:{}", model.feed_filter.pattern)
        };
        Line::from(vec![Span::styled(
            format!(
                " Tab/Shift+Tab tabs  j/k select  r reload  Ctrl+N {noisy}  / {filter}  Alt+M compact  ? help  q quit "
            ),
            theme.footer(),
        )])
    };
    let mut paragraph = Paragraph::new(text).style(theme.footer());
    if model.ui.filter_open && model.feed_filter.error.is_some() {
        paragraph = paragraph.block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(theme.error()),
        );
    }
    frame.render_widget(paragraph, area);
}

fn daemon_label(model: &Model) -> &str {
    if matches!(model.snapshot_source, SnapshotSource::Socket(_))
        || model.snapshot.daemon.label != "daemon: unknown"
    {
        model.snapshot.daemon.label.as_str()
    } else {
        "daemon: file-mode"
    }
}

fn owner_label(model: &Model) -> String {
    let Some(owner) = &model.snapshot.owner else {
        return String::from("unknown");
    };
    let harness = owner.harness.as_deref().unwrap_or("unknown");
    let pane = owner.pane_id.as_deref().unwrap_or("no-pane");
    let cwd = owner
        .cwd
        .as_ref()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| String::from("cwd?"));
    format!("{harness} · {pane} · {cwd}")
}

fn state_counts_label(counts: &BTreeMap<SessionState, usize>) -> String {
    let mut parts = Vec::with_capacity(counts.len());
    let priority = [
        SessionState::Prompting,
        SessionState::Submitting,
        SessionState::Waiting,
        SessionState::Ready,
        SessionState::MergeReady,
        SessionState::Complete,
        SessionState::Merged,
        SessionState::Cancelled,
        SessionState::Aborted,
        SessionState::Dead,
    ];
    for state in &priority {
        if let Some(count) = counts.get(state) {
            parts.push(format!("{}:{count}", state_abbrev(state)));
        }
    }
    for (state, count) in counts {
        if !priority.contains(state) {
            parts.push(format!("{}:{count}", state_abbrev(state)));
        }
    }
    parts.join(" ")
}

fn state_abbrev(state: &SessionState) -> String {
    match state {
        SessionState::Prompting => String::from("P"),
        SessionState::Submitting => String::from("S"),
        SessionState::Waiting => String::from("W"),
        SessionState::Ready => String::from("R"),
        SessionState::MergeReady => String::from("MR"),
        SessionState::Complete => String::from("C"),
        SessionState::Merged => String::from("M"),
        SessionState::Cancelled => String::from("X"),
        SessionState::Aborted => String::from("A"),
        SessionState::Dead => String::from("D"),
        SessionState::Other(value) => value.chars().take(3).collect::<String>(),
    }
}

fn trim_for_header(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let trimmed = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{trimmed}…")
    } else {
        trimmed
    }
}

fn duration_label(duration: std::time::Duration) -> String {
    let seconds = duration.as_secs();
    let hours = seconds / 3_600;
    let minutes = (seconds % 3_600) / 60;
    if hours > 0 {
        format!("{hours}h{minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        format!("{seconds}s")
    }
}

pub(super) fn human_duration(start: DateTime<Utc>, end: DateTime<Utc>) -> String {
    let duration = end.signed_duration_since(start);
    let seconds = duration.num_seconds().max(0);
    let hours = seconds / 3_600;
    let minutes = (seconds % 3_600) / 60;
    if hours > 0 {
        format!("{hours}h{minutes:02}m")
    } else {
        format!("{minutes}m")
    }
}
