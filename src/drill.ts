// Write-RTO drill. One client writes continuously through whichever endpoint
// answers, retrying each write with its own Idempotency-Key until it is
// acknowledged and moving to the next endpoint on any failure. Each cycle runs the
// caller's `kill` (take a node down), measures the time from the moment the kill
// command returns until a write attempt sent after that is acknowledged (the write
// RTO a client sees), then runs the
// caller's `restart` and waits for every endpoint to answer /info again.
//
// At the end the element's history is read back over plain i3X and reconciled
// against what the client was told: every acknowledged write must be there exactly
// once. A write that was applied but whose acknowledgement was lost is retried
// under the same key, so it too must appear once, not twice.
//
// The harness never decides which node to kill or how; that is the caller's command,
// so it works the same against any redundant i3X server.

import { history, reachable, writeValue, type Target } from "./i3x";

export interface DrillOptions {
  endpoints: string[];
  token?: string;
  /** A writable element whose history keeps every version (a record, or a historised value). */
  elementId: string;
  /** The value to write, with every "{{key}}" replaced by the write's unique key. */
  valueTemplate: string;
  cycles: number;
  kill: (cycle: number) => Promise<void>;
  restart: (cycle: number) => Promise<void>;
  /** Writing time before each kill, so every cycle starts from a steady state. */
  settleMs?: number;
  /** A cycle with no acknowledged write within this time counts as failed. */
  rtoTargetMs?: number;
  writeTimeoutMs?: number;
  /** Pause between a failed attempt and the retry on the next endpoint. */
  retryMs?: number;
  /** Pause between acknowledged writes. */
  gapMs?: number;
  /** Longest wait for all endpoints to answer after a restart. */
  readyTimeoutMs?: number;
  /** Prefix for the write keys, so two runs never share one. Default: a random run id. */
  runId?: string;
  log?: (line: string) => void;
}

export interface DrillReport {
  ranAt: string;
  runId: string;
  endpoints: string[];
  elementId: string;
  cycles: Array<{ cycle: number; rtoMs: number | null; killCommandMs: number; restartedInMs: number | null }>;
  writeRtoMs: { max: number | null; median: number | null; target: number };
  acknowledgedWrites: number;
  attempts: number;
  readBack: { values: number; matched: number };
  lost: string[];
  duplicated: Array<{ key: string; count: number }>;
  /** Writes the server holds although the client never got an acknowledgement (allowed: the client gave up or the run ended). */
  appliedUnacknowledged: string[];
  pass: boolean;
  failures: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runDrill(o: DrillOptions): Promise<DrillReport> {
  const settle = o.settleMs ?? 1500, target = o.rtoTargetMs ?? 30_000, wto = o.writeTimeoutMs ?? 15_000;
  const retry = o.retryMs ?? 100, gap = o.gapMs ?? 50, readyTimeout = o.readyTimeoutMs ?? 120_000;
  const runId = o.runId ?? `d${Math.random().toString(36).slice(2, 8)}`;
  const log = o.log ?? (() => {});
  const targets: Target[] = o.endpoints.map((base) => ({ base: base.replace(/\/$/, ""), token: o.token }));
  const startedAt = new Date(Date.now() - 60_000).toISOString();

  const acked: Array<{ key: string; at: number; sentAt: number }> = [];
  const issued: string[] = [];
  let attempts = 0;
  let writing = true;
  let seq = 0;
  const writer = (async () => {
    let ep = 0;
    while (writing) {
      const key = `${runId}-${seq++}`;
      issued.push(key);
      const value = JSON.parse(o.valueTemplate.replaceAll("{{key}}", key));
      while (writing) {
        attempts++;
        const sentAt = Date.now();
        const r = await writeValue(targets[ep % targets.length], o.elementId, value, key, wto);
        if (r.acked) { acked.push({ key, at: Date.now(), sentAt }); break; }
        ep++;
        await sleep(retry);
      }
      await sleep(gap);
    }
  })();

  const allReady = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < readyTimeout) {
      if ((await Promise.all(targets.map((t) => reachable(t)))).every(Boolean)) return Date.now() - t0;
      await sleep(250);
    }
    return null;
  };

  const failures: string[] = [];
  if ((await allReady()) === null) failures.push("not every endpoint answered /info before the first cycle");
  const cycles: DrillReport["cycles"] = [];
  for (let c = 1; c <= o.cycles && !failures.length; c++) {
    await sleep(settle);
    // The clock starts when the kill command returns, so a kill command must not
    // return until the node is down (a SIGKILL'd process or container is).
    const k0 = Date.now();
    try { await o.kill(c); } catch (e) { failures.push(`cycle ${c}: kill failed: ${(e as Error).message}`); break; }
    const before = acked.length;
    const t0 = Date.now();
    const killCommandMs = t0 - k0;
    let rtoMs: number | null = null;
    while (Date.now() - t0 < target) {
      // An attempt sent before the kill and answered just after it says nothing about the takeover.
      const hit = acked.slice(before).find((a) => a.sentAt >= t0);
      if (hit) { rtoMs = hit.at - t0; break; }
      await sleep(25);
    }
    if (rtoMs === null) failures.push(`cycle ${c}: no write acknowledged within ${target} ms of the kill`);
    try { await o.restart(c); } catch (e) { failures.push(`cycle ${c}: restart failed: ${(e as Error).message}`); }
    const restartedInMs = await allReady();
    if (restartedInMs === null) failures.push(`cycle ${c}: endpoints not all back within ${readyTimeout} ms of the restart`);
    cycles.push({ cycle: c, rtoMs, killCommandMs, restartedInMs });
    log(`cycle ${c}: write RTO ${rtoMs ?? "none"} ms, all endpoints back ${restartedInMs ?? "never"} ms after restart`);
  }
  await sleep(settle);
  writing = false;
  await writer;

  // Read back through any endpoint that answers.
  const endTime = new Date(Date.now() + 60_000).toISOString();
  let values: Array<{ value: unknown }> | null = null;
  for (const t of targets) { try { values = await history(t, o.elementId, startedAt, endTime); break; } catch (e) { log(`read-back via ${t.base}: ${(e as Error).message}`); } }
  if (!values) throw new Error("no endpoint answered the history read-back");

  const count = new Map<string, number>();
  const ours = new RegExp(`"(${runId.replace(/[^\w-]/g, "")}-\\d+)"`, "g");
  for (const v of values) for (const m of JSON.stringify(v.value).matchAll(ours)) count.set(m[1], (count.get(m[1]) ?? 0) + 1);
  const ackedKeys = new Set(acked.map((a) => a.key));
  const lost = acked.filter((a) => !count.has(a.key)).map((a) => a.key);
  const duplicated = [...count].filter(([, n]) => n > 1).map(([key, n]) => ({ key, count: n }));
  const appliedUnacknowledged = [...count.keys()].filter((k) => !ackedKeys.has(k));
  if (lost.length) failures.push(`${lost.length} acknowledged write(s) missing from history`);
  if (duplicated.length) failures.push(`${duplicated.length} write(s) present more than once`);
  if (!acked.length) failures.push("no write was ever acknowledged");

  const rtos = cycles.map((c) => c.rtoMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return {
    ranAt: new Date().toISOString(), runId, endpoints: o.endpoints, elementId: o.elementId, cycles,
    writeRtoMs: { max: rtos.at(-1) ?? null, median: rtos.length ? rtos[Math.floor(rtos.length / 2)] : null, target },
    acknowledgedWrites: acked.length, attempts,
    readBack: { values: values.length, matched: [...count.values()].reduce((a, b) => a + b, 0) },
    lost, duplicated, appliedUnacknowledged,
    pass: failures.length === 0 && cycles.length === o.cycles,
    failures,
  };
}
