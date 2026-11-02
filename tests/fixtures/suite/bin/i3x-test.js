#!/usr/bin/env node
// Stand-in for CESMII's conformance CLI: polls GET /info for FAKE_SUITE_MS and
// writes a report in the suite's shape. Any failed poll is a failed test.
const [, , cmd, endpoint, ...rest] = process.argv;
const out = rest[rest.indexOf("--json") + 1];
const ms = Number(process.env.FAKE_SUITE_MS ?? 1500);
const t0 = Date.now();
let pass = 0, fail = 0;
(async () => {
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(`${endpoint}/info`); r.ok ? pass++ : fail++; } catch { fail++; }
    await new Promise((r) => setTimeout(r, 50));
  }
  const summary = { verdict: fail ? "Not compliant" : "Full 1.0 Compliance", counts: { pass, fail, warn: 0, skip: 0, total: pass + fail }, mustFailures: fail ? [{ id: "INFO" }] : [], mayFailures: [], warnings: [] };
  require("node:fs").writeFileSync(out, JSON.stringify({ generatedBy: "fake", summary, results: [] }));
  console.log(`Result: ${summary.verdict}`);
  process.exit(fail ? 1 : 0);
})();
