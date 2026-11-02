// CESMII's i3X 1.0 conformance suite, run against one endpoint while the caller's
// command takes another node down part-way through. Passing means a client of the
// surviving endpoint saw nothing go wrong across the takeover.
//
// The suite is not bundled. Point `suite` at the conformance-tests folder of the
// i3X repository (github.com/cesmii/i3X); it has no dependencies of its own.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { reachable } from "./i3x";

export interface ConformanceOptions {
  suite: string;
  endpoint: string;
  token?: string;
  /** Where the suite writes its full JSON report. */
  jsonOut: string;
  /** Take the other node down. */
  kill: () => Promise<void>;
  killAfterMs: number;
  /** Run after the suite finishes (bring the node back). Optional. */
  restart?: () => Promise<void>;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export interface ConformanceReport {
  endpoint: string;
  killedAtMs: number | null;
  suiteFinishedAtMs: number;
  killedDuringRun: boolean;
  verdict: string | null;
  counts: { pass: number; fail: number; warn: number; skip: number; total: number } | null;
  mustFailures: unknown[];
  endpointUpAfter: boolean;
  jsonReport: string;
  pass: boolean;
  failures: string[];
}

export async function runConformanceUnderFailover(o: ConformanceOptions): Promise<ConformanceReport> {
  const cli = join(o.suite, "bin", "i3x-test.js");
  if (!existsSync(cli)) throw new Error(`no conformance suite at ${o.suite} (expected bin/i3x-test.js)`);
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  let killedAtMs: number | null = null;
  const args = [cli, "run", o.endpoint, ...(o.token ? ["--token", o.token] : []), "--json", o.jsonOut];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { for (const l of String(d).split("\n")) if (/Result:|passed|✗/.test(l)) log(l.trim()); });
  const killTimer = setTimeout(() => { killedAtMs = Date.now() - t0; log(`kill at ${killedAtMs} ms`); void o.kill(); }, o.killAfterMs);
  const code = await new Promise<number | null>((resolve) => {
    const guard = setTimeout(() => child.kill("SIGKILL"), o.timeoutMs ?? 600_000);
    child.on("exit", (c) => { clearTimeout(guard); resolve(c); });
  });
  clearTimeout(killTimer);
  const suiteFinishedAtMs = Date.now() - t0;
  if (o.restart) await o.restart();

  const failures: string[] = [];
  let summary: any = null;
  try { summary = JSON.parse(readFileSync(o.jsonOut, "utf8")).summary; } catch { failures.push(`the suite wrote no readable report (exit ${code})`); }
  const killedDuringRun = killedAtMs !== null && killedAtMs < suiteFinishedAtMs;
  if (!killedDuringRun) failures.push("the suite finished before the kill; lower --kill-after");
  const counts = summary?.counts ?? null;
  if (counts && counts.fail > 0) failures.push(`${counts.fail} conformance test(s) failed`);
  if (summary && summary.mustFailures?.length) failures.push(`${summary.mustFailures.length} MUST failure(s)`);
  const endpointUpAfter = await reachable({ base: o.endpoint.replace(/\/$/, ""), token: o.token });
  if (!endpointUpAfter) failures.push("the surviving endpoint did not answer /info after the run");
  return {
    endpoint: o.endpoint, killedAtMs, suiteFinishedAtMs, killedDuringRun,
    verdict: summary?.verdict ?? null, counts, mustFailures: summary?.mustFailures ?? [], endpointUpAfter,
    jsonReport: o.jsonOut, pass: failures.length === 0, failures,
  };
}
