import type {
  DashboardSnapshot,
  RunDetails,
  TaskView,
  ProviderStatus,
  RunSummary,
  UsageSummary,
  ProviderUsageSummary,
} from "../daemon/store.ts";
import type { ProtocolMessage } from "../types.ts";

export interface DashboardState {
  daemon: {
    status: "online" | "offline" | "connecting";
    pid?: number;
    lastRefresh: number;
  };
  runs: RunSummary[];
  selectedRunId?: string;
  tasks: TaskView[];
  allTasks?: TaskView[];
  providers: ProviderStatus[];
  events: Array<{ ts: number; type: string; taskId?: string; msg: string }>;
  globalUsage?: UsageSummary;
  providerUsage?: ProviderUsageSummary[];
  usageScope: "selected" | "global";
  activityScroll: number;
  lastError?: string;
  adminModal?: {
    type: "confirm-abort" | "confirm-abort-all" | "new-run" | "details";
    runId?: string;
    planPath?: string;
    confirmBuffer?: string;
  };
  dimensions: { cols: number; rows: number };
  lastAction?: string;
}

export type DashboardAction =
  | { type: "SNAPSHOT"; payload: DashboardSnapshot }
  | { type: "EVENT"; payload: unknown; requestId?: string }
  | { type: "DETAILS"; runId: string; payload: RunDetails }
  | { type: "PROVIDERS"; payload: { providers: ProviderStatus[] } }
  | { type: "SELECT"; runId: string }
  | { type: "MODAL"; modal: DashboardState["adminModal"] }
  | { type: "MODAL_INPUT"; text: string }
  | { type: "ERROR"; error: string }
  | { type: "RECONNECT"; status: "online" | "offline" | "connecting" }
  | { type: "RESIZE"; cols: number; rows: number }
  | { type: "TOGGLE_USAGE_SCOPE" }
  | { type: "SCROLL_ACTIVITY"; delta: number }
  | { type: "CLEAR_ERROR" };

const MAX_EVENTS = 50;

function toEventLog(msg: ProtocolMessage | any): { ts: number; type: string; taskId?: string; msg: string } {
  const ts = Date.now();
  if (msg && typeof msg === "object") {
    const type = msg.type ?? "event";
    const taskId = msg.taskId;
    const summary = msg.summary ?? msg.error ?? JSON.stringify(msg).slice(0, 80);
    return { ts, type: String(type), taskId: taskId ? String(taskId) : undefined, msg: String(summary) };
  }
  return { ts, type: "event", msg: String(msg).slice(0, 80) };
}

export function initialState(dimensions = { cols: 80, rows: 24 }): DashboardState {
  return {
    daemon: { status: "connecting", lastRefresh: Date.now() },
    runs: [],
    tasks: [],
    providers: [],
    events: [],
    usageScope: "selected",
    activityScroll: 0,
    dimensions,
  };
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "SNAPSHOT": {
      const s = action.payload;
      const runs = s.runs ?? [];
      const selected = state.selectedRunId && runs.some((r) => r.id === state.selectedRunId) ? state.selectedRunId : runs[0]?.id;
      const allTasks = s.tasks ?? state.allTasks ?? [];
      const selectedTasks = selected ? allTasks.filter((t) => t.runId === selected) : [];
      return {
        ...state,
        daemon: {
          status: s.daemon.running ? "online" : "offline",
          pid: s.daemon.pid,
          lastRefresh: s.daemon.lastRefresh,
        },
        runs,
        selectedRunId: selected,
        allTasks,
        tasks: selectedTasks.length > 0 ? selectedTasks : (selected === state.selectedRunId ? state.tasks : []),
        providers: s.providers ?? state.providers,
        events: [...(s.recentEvents ?? []).map(toEventLog), ...state.events].slice(0, MAX_EVENTS),
        globalUsage: s.usage,
        providerUsage: s.providerUsage,
        lastError: undefined,
      };
    }
    case "EVENT": {
      const ev = toEventLog(action.payload);
      const newEvents = [ev, ...state.events].slice(0, MAX_EVENTS);
      // if event indicates run state change, could trigger refresh but here just log
      return { ...state, events: newEvents };
    }
    case "DETAILS": {
      if (action.runId !== state.selectedRunId) return state;
      return {
        ...state,
        tasks: action.payload.tasks ?? [],
        events: [...action.payload.events.map(toEventLog), ...state.events].slice(0, MAX_EVENTS),
      };
    }
    case "PROVIDERS": {
      return { ...state, providers: action.payload.providers ?? [] };
    }
    case "SELECT": {
      if (!state.runs.some((r) => r.id === action.runId)) return state;
      const allTasks = state.allTasks ?? [];
      const runTasks = allTasks.filter((t) => t.runId === action.runId);
      return { ...state, selectedRunId: action.runId, tasks: runTasks };
    }
    case "MODAL": {
      return { ...state, adminModal: action.modal };
    }
    case "MODAL_INPUT": {
      if (!state.adminModal) return state;
      if (state.adminModal.type === "confirm-abort-all") {
        return {
          ...state,
          adminModal: { ...state.adminModal, confirmBuffer: action.text },
        };
      }
      if (state.adminModal.type === "new-run") {
        return {
          ...state,
          adminModal: { ...state.adminModal, planPath: action.text },
        };
      }
      return state;
    }
    case "ERROR": {
      return { ...state, lastError: action.error };
    }
    case "RECONNECT": {
      return {
        ...state,
        daemon: { ...state.daemon, status: action.status },
      };
    }
    case "TOGGLE_USAGE_SCOPE": {
      return {
        ...state,
        usageScope: state.usageScope === "selected" ? "global" : "selected",
      };
    }
    case "SCROLL_ACTIVITY": {
      const maxScroll = Math.max(0, state.events.length - 5);
      const newScroll = Math.min(Math.max(0, state.activityScroll + action.delta), maxScroll);
      return { ...state, activityScroll: newScroll };
    }
    case "RESIZE": {
      return { ...state, dimensions: { cols: action.cols, rows: action.rows } };
    }
    case "CLEAR_ERROR": {
      return { ...state, lastError: undefined };
    }
    default:
      return state;
  }
}
