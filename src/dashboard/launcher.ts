import { spawnSync, type SpawnOptions } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export interface LauncherOptions {
  cwd?: string;
  inline?: boolean;
  newWindow?: boolean;
  nodePath?: string;
  binPath?: string;
}

export function isDarwin(): boolean {
  return process.platform === "darwin";
}

export function posixEscape(str: string): string {
  // safe single quote escape for POSIX: ' -> '\'' 
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export function launchDashboard(opts: LauncherOptions = {}): { launched: boolean; message?: string; inline: boolean } {
  const cwd = opts.cwd ?? process.cwd();
  const inline = !!opts.inline;
  const forceNew = !!opts.newWindow;
  const darwin = isDarwin();

  if (inline || (!darwin && !forceNew)) {
    // inline path: never call osascript
    return { launched: false, inline: true, message: darwin ? undefined : "non-darwin: running inline" };
  }

  // darwin + not inline: use osascript to open new Terminal window
  const node = opts.nodePath ?? process.execPath;
  const bin = opts.binPath ?? fileURLToPath(new URL("../../bin/pi-many-agents.js", import.meta.url));
  const args = ["dashboard", "--inline"];

  const escapedCwd = posixEscape(resolve(cwd));
  const escapedNode = posixEscape(resolve(node));
  const escapedBin = posixEscape(resolve(bin));

  const appleScript = `tell application "Terminal"
    activate
    do script "cd ${escapedCwd} && ${escapedNode} ${escapedBin} ${args.map((a) => posixEscape(a)).join(" ")}"
end tell`;

  try {
    const result = spawnSync("/usr/bin/osascript", ["-e", appleScript], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd,
      // NO shell: true anywhere
    });
    if (result.status === 0) {
      return { launched: true, inline: false, message: "opened new Terminal.app window" };
    }
    const err = result.stderr?.toString() ?? "osascript failed";
    return { launched: false, inline: true, message: `Failed to open Terminal.app: ${err}. falling back to inline` };
  } catch (e) {
    return { launched: false, inline: true, message: `launcher error: ${(e as Error).message}. running inline` };
  }
}

export function runInlineDashboard(): void {
  // This would import and start app, but to avoid circular in launcher, the CLI calls it
  // For direct, see cli integration
}
