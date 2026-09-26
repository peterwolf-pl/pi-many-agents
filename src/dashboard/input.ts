import type { DashboardState, DashboardAction } from "./state.ts";

export type Key = string;

export interface InputResult {
  action?: DashboardAction;
  quit?: boolean;
  refresh?: boolean;
  execute?:
    | { type: "abort"; runId?: string }
    | { type: "runPlan"; planPath?: string }
    | { type: "details"; runId: string };
}

export function handleKey(state: DashboardState, key: Key): InputResult {
  const modal = state.adminModal;

  if (key === "\u0003" || key === "q" || key === "Q") {
    return { quit: true };
  }

  if (modal) {
    if (key === "\u001b" || key === "Escape") {
      return { action: { type: "MODAL", modal: undefined } };
    }
    if (modal.type === "confirm-abort") {
      if (key === "y" || key === "Y") {
        return {
          action: { type: "MODAL", modal: undefined },
          execute: { type: "abort", runId: modal.runId },
        };
      }
      if (key === "n" || key === "N") {
        return { action: { type: "MODAL", modal: undefined } };
      }
      return {};
    }
    if (modal.type === "confirm-abort-all") {
      if (key === "\r" || key === "\n") {
        if ((modal.confirmBuffer ?? "").trim().toUpperCase() === "ABORT") {
          return {
            action: { type: "MODAL", modal: undefined },
            execute: { type: "abort" },
          };
        }
        return { action: { type: "MODAL", modal: undefined } };
      }
      if (key === "\b" || key === "\u007f") {
        const buf = (modal.confirmBuffer ?? "").slice(0, -1);
        return { action: { type: "MODAL_INPUT", text: buf } };
      }
      if (key.length === 1 && key >= " ") {
        const buf = (modal.confirmBuffer ?? "") + key;
        return { action: { type: "MODAL_INPUT", text: buf } };
      }
      return {};
    }
    if (modal.type === "new-run") {
      if (key === "\r" || key === "\n") {
        return {
          action: { type: "MODAL", modal: undefined },
          execute: { type: "runPlan", planPath: modal.planPath },
        };
      }
      if (key === "\b" || key === "\u007f") {
        const p = (modal.planPath ?? "").slice(0, -1);
        return { action: { type: "MODAL_INPUT", text: p } };
      }
      if (key.length === 1 && key >= " ") {
        const p = (modal.planPath ?? "") + key;
        return { action: { type: "MODAL_INPUT", text: p } };
      }
      return {};
    }
    if (modal.type === "details") {
      if (key === "\r" || key === "\n") {
        return { action: { type: "MODAL", modal: undefined } };
      }
      return {};
    }
    return {};
  }

  if (key === "r" || key === "R") {
    return { refresh: true };
  }

  if (key === "n" || key === "N") {
    return { action: { type: "MODAL", modal: { type: "new-run", planPath: "" } } };
  }

  if (key === "a" || key === "A") {
    if (state.selectedRunId) {
      return { action: { type: "MODAL", modal: { type: "confirm-abort", runId: state.selectedRunId } } };
    }
    return {};
  }

  if (key === "x" || key === "X") {
    return { action: { type: "MODAL", modal: { type: "confirm-abort-all", confirmBuffer: "" } } };
  }

  if (key === "u" || key === "U") {
    return { action: { type: "TOGGLE_USAGE_SCOPE" } };
  }

  if (key === "[" || key === "\u001b[5~") {
    return { action: { type: "SCROLL_ACTIVITY", delta: -5 } };
  }

  if (key === "]" || key === "\u001b[6~") {
    return { action: { type: "SCROLL_ACTIVITY", delta: 5 } };
  }

  if (key === "\u001b[A" || key === "k" || key === "K") {
    const idx = state.runs.findIndex((r) => r.id === state.selectedRunId);
    if (idx > 0) {
      const prev = state.runs[idx - 1].id;
      return { action: { type: "SELECT", runId: prev } };
    }
    return {};
  }

  if (key === "\u001b[B" || key === "j" || key === "J") {
    const idx = state.runs.findIndex((r) => r.id === state.selectedRunId);
    if (idx >= 0 && idx < state.runs.length - 1) {
      const next = state.runs[idx + 1].id;
      return { action: { type: "SELECT", runId: next } };
    }
    return {};
  }

  if (key === "\r" || key === "\n") {
    if (state.selectedRunId) {
      return {
        action: { type: "MODAL", modal: { type: "details", runId: state.selectedRunId } },
        execute: { type: "details", runId: state.selectedRunId },
      };
    }
    return {};
  }

  return {};
}
