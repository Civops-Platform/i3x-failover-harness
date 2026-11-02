// Run a caller-supplied shell command (kill or restart a node). Extra variables
// such as I3X_CYCLE are passed in the environment. A non-zero exit is an error.

import { spawn } from "node:child_process";

export function shell(cmd: string, env: Record<string, string> = {}, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("sh", ["-c", cmd], { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("exit", (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`command exited ${code}: ${cmd}`)); });
    p.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}
