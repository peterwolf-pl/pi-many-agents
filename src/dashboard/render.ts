import type { DashboardState } from "./state.ts";
import type { UsageSummary } from "../daemon/store.ts";

const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
};

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

export function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

export function pad(str: string, targetWidth: number, right = true): string {
  const w = visibleWidth(str);
  if (w >= targetWidth) return truncate(str, targetWidth);
  const space = " ".repeat(targetWidth - w);
  return right ? str + space : space + str;
}

export function truncate(str: string, maxWidth: number): string {
  if (visibleWidth(str) <= maxWidth) return str;
  let res = "";
  let visible = 0;
  let inEscape = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === "\x1b") {
      inEscape = true;
      res += char;
      continue;
    }
    if (inEscape) {
      res += char;
      if (/[a-zA-Z]/.test(char)) inEscape = false;
      continue;
    }
    if (visible >= maxWidth - 1) {
      res += "…";
      break;
    }
    res += char;
    visible++;
  }
  return res;
}

export function sanitize(text: string): string {
  // Strip non-printable control chars and ANSI escape sequences from untrusted inputs
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

export function elapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

export function formatTokens(num?: number): string {
  if (typeof num !== "number") return "--";
  if (num === 0) return "0";
  if (num < 1000) return String(num);
  if (num < 1_000_000) return `${(num / 1000).toFixed(1)}k`;
  return `${(num / 1_000_000).toFixed(2)}M`;
}

export function formatCost(cost?: number): string {
  if (typeof cost !== "number") return "--";
  return `$${cost.toFixed(4)}`;
}

export function render(state: DashboardState): string {
  const { cols, rows } = state.dimensions;

  // Tiny terminal graceful degradation
  if (cols < 50 || rows < 14) {
    return renderMinimal(state, cols, rows);
  }

  const wide = cols >= 130;
  const lines: string[] = [];

  // Header line 1
  const daemonStatus = state.daemon.status.toUpperCase();
  const u = state.globalUsage;
  const tokensStr = u ? `tokens: ${formatTokens(u.totalTokens)} (in ${formatTokens(u.inputTokens)}/out ${formatTokens(u.outputTokens)})` : "tokens: --";
  const costStr = u?.costKnown ? `cost: ${formatCost(u.estimatedCost)}` : "";
  const activeRunsStr = `active: ${state.runs.filter((r) => r.state === "running").length}`;

  const headerParts = [
    "PI MANY AGENTS",
    `DAEMON ${daemonStatus} (pid ${state.daemon.pid ?? "-"})`,
    `runs ${state.runs.length}`,
    activeRunsStr,
    tokensStr,
    costStr,
    formatTime(state.daemon.lastRefresh),
  ].filter(Boolean);

  const headerLine = headerParts.join("  |  ");
  lines.push(pad(sanitize(headerLine), cols));
  lines.push(pad("", cols)); // blank spacer

  const availH = rows - 4; // header(2) + footer(2)

  if (!wide) {
    // 80x24 vertical stacked layout
    const runH = Math.max(4, Math.floor(availH * 0.28));
    const taskH = Math.max(5, Math.floor(availH * 0.32));
    const useH = Math.max(3, Math.floor(availH * 0.18));
    const evH = Math.max(4, availH - runH - taskH - useH);

    lines.push(renderRunsPanel(state, cols, runH));
    lines.push(renderTasksPanel(state, cols, taskH));
    lines.push(renderUsagePanel(state, cols, useH));
    lines.push(renderEventsPanel(state, cols, evH));
  } else {
    // 140x40 2-column control room layout
    const leftW = Math.floor(cols * 0.54);
    const rightW = cols - leftW - 1;

    const runH = Math.max(5, Math.floor(availH * 0.38));
    const taskH = Math.max(6, availH - runH);

    const useH = Math.max(5, Math.floor(availH * 0.30));
    const provH = Math.max(4, Math.floor(availH * 0.25));
    const evH = Math.max(5, availH - useH - provH);

    const leftLines = [
      ...renderRunsPanel(state, leftW, runH).split("\n"),
      ...renderTasksPanel(state, leftW, taskH).split("\n"),
    ];

    const rightLines = [
      ...renderUsagePanel(state, rightW, useH).split("\n"),
      ...renderProvidersPanel(state, rightW, provH).split("\n"),
      ...renderEventsPanel(state, rightW, evH).split("\n"),
    ];

    const maxL = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < maxL; i++) {
      const l = pad(leftLines[i] ?? "", leftW);
      const r = pad(rightLines[i] ?? "", rightW);
      lines.push(`${l} ${r}`);
    }
  }

  // Footer (admin controls & shortcuts)
  lines.push(renderFooter(state, cols));

  // Ensure exact row count
  while (lines.length > rows) lines.pop();
  while (lines.length < rows) lines.push(pad("", cols));

  return lines.join("\n");
}

function renderMinimal(state: DashboardState, cols: number, rows: number): string {
  const lines: string[] = [];
  lines.push(pad(`PI MANY AGENTS [${state.daemon.status.toUpperCase()}] runs:${state.runs.length}`, cols));
  const selected = state.selectedRunId ?? state.runs[0]?.id;
  if (selected) {
    const r = state.runs.find((x) => x.id === selected);
    lines.push(pad(`Selected: ${selected} (${r?.state ?? "-"})`, cols));
    for (const t of state.tasks.slice(0, rows - 4)) {
      lines.push(pad(`${t.id} ${t.state} ${sanitize(t.title)}`, cols));
    }
  }
  lines.push(pad("q quit  r refresh  ↑↓ select", cols));
  while (lines.length > rows) lines.pop();
  while (lines.length < rows) lines.push(pad("", cols));
  return lines.join("\n");
}

function renderRunsPanel(state: DashboardState, w: number, h: number): string {
  const innerW = Math.max(10, w - 2);
  const title = pad(" RUNS (↑↓ select)", innerW);
  const header = `${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];
  const selected = state.selectedRunId;

  const runLines = state.runs.slice(0, h - 3).map((r) => {
    const sel = r.id === selected ? ">" : " ";
    const id = r.id.slice(0, 14);
    const st = r.state.padEnd(9);
    const progress = `${r.completed}/${r.taskCount}`.padStart(5);
    const dur = elapsed(r.elapsedMs ?? (r.state === "running" ? Date.now() - r.createdAt : r.updatedAt - r.createdAt)).padEnd(5);
    const tokens = r.usage ? formatTokens(r.usage.totalTokens).padStart(6) : "    --";
    const cost = r.usage?.costKnown ? formatCost(r.usage.estimatedCost).padStart(8) : "";

    const lineText = `${sel} ${id} ${st} ${progress} ${dur} ${tokens} ${cost}`;
    return `${BOX.v}${pad(sanitize(lineText), innerW)}${BOX.v}`;
  });

  rows.push(...runLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", innerW)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
  return rows.join("\n");
}

function renderTasksPanel(state: DashboardState, w: number, h: number): string {
  const innerW = Math.max(10, w - 2);
  const title = pad(` TASKS/WORKERS (${state.selectedRunId?.slice(0, 14) ?? "none"})`, innerW);
  const header = `${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];

  const taskLines = state.tasks.slice(0, h - 3).map((t) => {
    const id = t.id.slice(0, 10).padEnd(10);
    const st = t.state.slice(0, 9).padEnd(9);
    const prov = (t.provider ?? "-").slice(0, 8).padEnd(8);
    const mod = (t.model ?? "-").slice(0, 14).padEnd(14);
    const rsg = (t.reasoning ?? "-").slice(0, 5).padEnd(5);
    const tok = t.usage ? formatTokens(t.usage.totalTokens).padStart(5) : "   --";
    const dur = t.durationMs !== undefined ? elapsed(t.durationMs).padStart(5) : "   --";
    const titleText = sanitize(t.title).slice(0, 18).padEnd(18);

    const lineText = `${id} ${titleText} ${st} ${prov} ${mod} ${rsg} ${tok} ${dur}`;
    return `${BOX.v}${pad(lineText, innerW)}${BOX.v}`;
  });

  rows.push(...taskLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", innerW)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
  return rows.join("\n");
}

function renderUsagePanel(state: DashboardState, w: number, h: number): string {
  const innerW = Math.max(10, w - 2);
  const scope = state.usageScope.toUpperCase();
  const title = pad(` USAGE [u: toggle scope (${scope})]`, innerW);
  const header = `${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];

  const selectedRun = state.runs.find((r) => r.id === state.selectedRunId);
  const u: UsageSummary | undefined = state.usageScope === "selected" ? selectedRun?.usage : state.globalUsage;

  if (!u || u.reportsTotal === 0) {
    rows.push(`${BOX.v}${pad(" No usage data recorded yet", innerW)}${BOX.v}`);
  } else {
    const line1 = ` In: ${formatTokens(u.inputTokens)}  Out: ${formatTokens(u.outputTokens)}  Cached: ${formatTokens(u.cachedTokens)}  Tot: ${formatTokens(u.totalTokens)}`;
    const costText = u.costKnown ? formatCost(u.estimatedCost) : "--";
    const line2 = ` Cost: ${costText}  (coverage: ${u.reportsWithUsage}/${u.reportsTotal} tasks reported)`;
    rows.push(`${BOX.v}${pad(sanitize(line1), innerW)}${BOX.v}`);
    rows.push(`${BOX.v}${pad(sanitize(line2), innerW)}${BOX.v}`);

    if (state.providerUsage && state.providerUsage.length > 0 && h > 5) {
      const provStr = state.providerUsage.map((p) => `${p.provider}${p.model ? `:${p.model}` : ""}: ${formatTokens(p.totalTokens)}`).join(" | ");
      rows.push(`${BOX.v}${pad(` Breakdown: ${sanitize(provStr)}`, innerW)}${BOX.v}`);
    }
  }

  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", innerW)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
  return rows.join("\n");
}

function renderProvidersPanel(state: DashboardState, w: number, h: number): string {
  const innerW = Math.max(10, w - 2);
  const title = pad(" PROVIDERS", innerW);
  const header = `${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];

  const provLines = state.providers.slice(0, h - 3).map((p) => {
    const name = p.name.padEnd(10);
    const mod = p.model.padEnd(18);
    const st = p.status;
    const txt = `${name} ${mod} ${st}`;
    return `${BOX.v}${pad(sanitize(txt), innerW)}${BOX.v}`;
  });

  rows.push(...provLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", innerW)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
  return rows.join("\n");
}

function renderEventsPanel(state: DashboardState, w: number, h: number): string {
  const innerW = Math.max(10, w - 2);
  const scrollNotice = state.activityScroll > 0 ? ` (scroll: +${state.activityScroll})` : "";
  const title = pad(` LIVE ACTIVITY [ ] scroll]${scrollNotice}`, innerW);
  const header = `${BOX.tl}${BOX.h.repeat(innerW)}${BOX.tr}\n${BOX.v}${title}${BOX.v}`;
  const rows: string[] = [header];

  const visibleCount = Math.max(1, h - 3);
  const scrolledEvents = state.events.slice(state.activityScroll, state.activityScroll + visibleCount);

  const evLines = scrolledEvents.map((e) => {
    const t = new Date(e.ts).toISOString().slice(11, 19);
    const tid = e.taskId ? e.taskId.slice(0, 8) : "------";
    const type = sanitize(e.type).slice(0, 12).padEnd(12);
    const msg = sanitize(e.msg);
    const txt = `${t} ${tid} ${type} ${msg}`;
    return `${BOX.v}${pad(txt, innerW)}${BOX.v}`;
  });

  rows.push(...evLines);
  while (rows.length < h - 1) rows.push(`${BOX.v}${pad("", innerW)}${BOX.v}`);
  rows.push(`${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}`);
  return rows.join("\n");
}

function renderFooter(state: DashboardState, cols: number): string {
  const modal = state.adminModal;
  if (modal) {
    if (modal.type === "confirm-abort") return pad(`Confirm abort ${modal.runId}? (y/n)  Esc cancel`, cols);
    if (modal.type === "confirm-abort-all") return pad(`Type ABORT and press Enter to confirm abort ALL: ${modal.confirmBuffer ?? ""}  Esc cancel`, cols);
    if (modal.type === "new-run") return pad(`Enter plan path (or press Enter for demo plan, Esc cancel): ${modal.planPath ?? ""}`, cols);
    if (modal.type === "details") return pad(`Details for ${modal.runId} (press Enter/Esc to close)`, cols);
  }
  if (state.lastError) {
    return pad(`ERROR: ${sanitize(state.lastError).slice(0, cols - 20)}  (r to clear)`, cols);
  }
  return pad("↑/k ↓/j select  Enter details  r refresh  n new-run  a abort-sel  x abort-all  u usage  [ ] scroll  q quit", cols);
}
