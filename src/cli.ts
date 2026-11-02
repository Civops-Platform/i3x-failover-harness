#!/usr/bin/env -S node --import tsx
// i3x-failover drill | conformance — see README.md. The bearer token is read from
// I3X_TOKEN (not a flag, so it stays out of the process list).

import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runDrill } from "./drill";
import { runConformanceUnderFailover } from "./conformance";
import { shell } from "./shell";

const [mode, ...rest] = process.argv.slice(2);
const token = process.env.I3X_TOKEN || undefined;
const say = (l: string) => console.log(l);
const save = (path: string, report: unknown) => { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, JSON.stringify(report, null, 2)); };

if (mode === "drill") {
  const { values: a } = parseArgs({ args: rest, options: {
    endpoint: { type: "string", multiple: true }, element: { type: "string" }, value: { type: "string" },
    kill: { type: "string" }, restart: { type: "string" }, cycles: { type: "string", default: "20" },
    "rto-target": { type: "string", default: "30000" }, settle: { type: "string", default: "1500" },
    "write-timeout": { type: "string", default: "15000" }, out: { type: "string", default: "reports/failover-drill.json" },
  } });
  if (!a.endpoint?.length || !a.element || !a.kill || !a.restart) {
    console.error("usage: i3x-failover drill --endpoint URL --endpoint URL --element ID --kill CMD --restart CMD [--value JSON] [--cycles N] [--rto-target MS] [--out FILE]");
    process.exit(2);
  }
  mkdirSync(dirname(resolve(a.out!)), { recursive: true });
  const report = await runDrill({
    endpoints: a.endpoint, token, elementId: a.element, cycles: Number(a.cycles),
    valueTemplate: a.value ?? '{"value":{"key":"{{key}}"}}',
    kill: (c) => shell(a.kill!, { I3X_CYCLE: String(c) }), restart: (c) => shell(a.restart!, { I3X_CYCLE: String(c) }),
    rtoTargetMs: Number(a["rto-target"]), settleMs: Number(a.settle), writeTimeoutMs: Number(a["write-timeout"]), log: say,
  });
  save(a.out!, report);
  say(JSON.stringify({ pass: report.pass, writeRtoMs: report.writeRtoMs, acknowledgedWrites: report.acknowledgedWrites, lost: report.lost.length, duplicated: report.duplicated.length, failures: report.failures }));
  process.exit(report.pass ? 0 : 1);
} else if (mode === "conformance") {
  const { values: a } = parseArgs({ args: rest, options: {
    endpoint: { type: "string" }, kill: { type: "string" }, restart: { type: "string" },
    "kill-after": { type: "string", default: "1000" }, suite: { type: "string", default: process.env.I3X_SUITE },
    out: { type: "string", default: "reports/conformance-failover.json" },
  } });
  if (!a.endpoint || !a.kill || !a.suite) {
    console.error("usage: i3x-failover conformance --endpoint URL --kill CMD [--kill-after MS] [--restart CMD] [--suite DIR | I3X_SUITE] [--out FILE]");
    process.exit(2);
  }
  mkdirSync(dirname(resolve(a.out!)), { recursive: true });
  const report = await runConformanceUnderFailover({
    suite: a.suite, endpoint: a.endpoint, token, jsonOut: a.out!, killAfterMs: Number(a["kill-after"]),
    kill: () => shell(a.kill!), restart: a.restart ? () => shell(a.restart!) : undefined, log: say,
  });
  say(JSON.stringify({ pass: report.pass, verdict: report.verdict, counts: report.counts, killedAtMs: report.killedAtMs, suiteFinishedAtMs: report.suiteFinishedAtMs, failures: report.failures }));
  process.exit(report.pass ? 0 : 1);
} else {
  console.error("usage: i3x-failover drill … | i3x-failover conformance …  (see README.md)");
  process.exit(2);
}
