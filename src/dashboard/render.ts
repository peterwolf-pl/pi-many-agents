import type { DashboardState } from "./state.ts";

const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  t: "┬",
  b: "┴",
};

function pad(str: string, len: number, right = true): string {
  if (str.length >= len) return str.slice(0, len);
  const p = " ".repeat(len - str.length);
  return right ? str + p : p + str;
}

function sanitize(text: string): string {
  // strip control chars except \n \t for safety
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

export function render(state: DashboardState): string {
  const { cols, rows } = state.dimensions;
  const wide = cols >= 140;
  const tall = rows >= 40;
  const lines: string[] = [];

  // Header
  const daemonStatus = state.daemon.status.toUpperCase();
  const header = `PI MANY AGENTS  |  DAEMON ${daemonStatus}  |  runs ${state.runs.length}  |  pid ${state.daemon.pid ?? "-"}  |  ${formatTime(state.daemon.lastRefresh)}`;
  lines.push(pad(sanitize(header), cols));
  lines.push(pad("", cols, true)); // spacer

  // Compute panel heights
  const headerH = 2;
  const helpH = 2;
  const availH = rows - headerH - helpH - 1;
  const runH = Math.max(5, Math.floor(availH * 0.3));
  const taskH = Math.max(6, Math.floor(availH * 0.35));
  const provH = Math.max(4, Math.floor(availH * 0.2));
  const evH = Math.max(5, availH - runH - taskH - provH);

  if (!wide) {
    // Stacked vertical for 80x24
    lines.push(renderRunsPanel(state, cols, runH));
    lines.push(renderTasksPanel(state, cols, taskH));
    lines.push(renderProvidersPanel(state, cols, provH));
    lines.push(renderEventsPanel(state, cols, evH));
  } else {
    // 2-col split
    const leftW = Math.floor(cols * 0.55);
    const rightW = cols - leftW - 1;
    const leftLines = [
      ...renderRunsPanel(state, leftW, runH).split("\n"),
      ...renderTasksPanel(state, leftW, taskH).split("\n"),
    ];
    const rightLines = [
      ...renderProvidersPanel(state, rightW, provH).split("\n"),
      ...renderEventsPanel(state, rightW, evH).split("\n"),
    ];
    const maxL = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxL; i++) {
      const l = pad(leftLines[i] ?? "", leftW);
      const r = pad(rightLines[i] ?? "", rightW);
      lines.push(l + " " + r);
    }
  }

  // Admin / help footer
  const modal = state.adminModal;
  let help = "↑/k ↓/j select  Enter details  r refresh  n new-run  a abort-sel  x abort-all  q quit";
  if (modal) {
    if (modal.type === "confirm-abort") help = `Confirm abort ${modal.runId}? (y/n)  Esc cancel`;
    else if (modal.type === "confirm-abort-all") help = `Type ABORT and press Enter to confirm abort ALL: ${modal.confirmBuffer ?? ""}  Esc cancel`;
    else if (modal.type === "new-run") help = `Enter plan path (or press Enter for demo plan, Esc cancel): ${modal.planPath ?? ""}`;
    else if (modal.type === "details") help = `Details for ${modal.runId} (press Enter/Esc to close)`;
  }
  if (state.lastError) help = `ERROR: ${sanitize(state.lastError).slice(0, 60)}  (r to clear)`;
  lines.push(pad(sanitize(help), cols));

  // trim to rows
  while (lines.length > rows) lines.pop();
  while (lines.length < rows) lines.push(pad("", cols));

  return lines.join("\n");
}

function renderRunsPanel(state: DashboardState, w: number, h: number): string {
  const title = pad(" RUNS (select with ↑↓)", w - 2);
  const header = `${BOX.tl}${BOX.h.repeat(w - 2)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];
  const selected = state.selectedRunId;
  const runLines = state.runs.slice(0, h - 3).map((r, i) => {
    const sel = r.id === selected ? ">" : " ";
    const runDuration =
      r.state === "running"
        ? Date.now() - r.createdAt
        : Math.max(0, (r.updatedAt ?? r.createdAt) - r.createdAt);
    const t = `${sel} ${r.id.slice(0, 12)} ${r.state.padEnd(10)} ${elapsed(runDuration).padEnd(6)} tasks:${r.taskCount ?? 0}`;
    return `${BOX.v}${pad(sanitize(t), w - 2)}${BOX.v}`;
  });
  rows.push(...runLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", w - 2)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(w - 2)}${BOX.br}`);
  return rows.join("\n");
}

function renderTasksPanel(state: DashboardState, w: number, h: number): string {
  const title = pad(` TASKS/WORKERS for ${state.selectedRunId?.slice(0, 8) ?? "none"}`, w - 2);
  const header = `${BOX.tl}${BOX.h.repeat(w - 2)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];
  const taskLines = state.tasks.slice(0, h - 3).map((t) => {
    const st = t.state.padEnd(10);
    const prv = (t.provider ?? "-").padEnd(8);
    const txt = `${t.id.slice(0, 8)} ${sanitize(t.title).slice(0, 20).padEnd(20)} ${st} ${prv}`;
    return `${BOX.v}${pad(txt, w - 2)}${BOX.v}`;
  });
  rows.push(...taskLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", w - 2)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(w - 2)}${BOX.br}`);
  return rows.join("\n");
}

function renderProvidersPanel(state: DashboardState, w: number, h: number): string {
  const title = pad(" PROVIDERS", w - 2);
  const header = `${BOX.tl}${BOX.h.repeat(w - 2)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];
  const provLines = state.providers.slice(0, h - 3).map((p) => {
    const txt = `${p.name.padEnd(10)} ${p.model.padEnd(18)} ${p.status}`;
    return `${BOX.v}${pad(txt, w - 2)}${BOX.v}`;
  });
  rows.push(...provLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", w - 2)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(w - 2)}${BOX.br}`);
  return rows.join("\n");
}

function renderEventsPanel(state: DashboardState, w: number, h: number): string {
  const title = pad(" EVENTS (last)", w - 2);
  const header = `${BOX.tl}${BOX.h.repeat(w - 2)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];
  const evLines = state.events.slice(0, h - 3).map((e) => {
    const t = new Date(e.ts).toISOString().slice(11, 19);
    const tid = e.taskId ? e.taskId.slice(0, 6) : "------";
    const txt = `${t} ${tid} ${sanitize(e.type).padEnd(12)} ${sanitize(e.msg).slice(0, w - 35)}`;
    return `${BOX.v}${pad(txt, w - 2)}${BOX.v}`;
  });
  rows.push(...evLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", w - 2)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(w - 2)}${BOX.br}`);
  return rows.join("\n");
}
