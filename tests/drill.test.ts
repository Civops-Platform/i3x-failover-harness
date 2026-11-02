// The drill against a fake redundant pair (tests/fake-pair.ts): a correct pair
// passes with a measured RTO; a pair that loses or duplicates a write is caught.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runDrill } from "../src/index";
import { fakePair, type FakeOptions } from "./fake-pair";

async function drill(o: FakeOptions, cycles = 3) {
  const pair = await fakePair(o);
  try {
    const report = await runDrill({
      endpoints: pair.endpoints(), elementId: "record:drill", valueTemplate: '{"value":{"key":"{{key}}"}}', cycles,
      kill: () => pair.killLeader(), restart: () => pair.restartDown(),
      settleMs: 200, rtoTargetMs: 3000, retryMs: 20, gapMs: 5, writeTimeoutMs: 1000, readyTimeoutMs: 3000,
    });
    return { report, pair };
  } finally { await pair.close(); }
}

test("a correct pair passes: RTO measured per cycle, every acknowledged write present exactly once", async () => {
  const { report } = await drill({ takeoverMs: 300 });
  assert.equal(report.pass, true, report.failures.join("; "));
  assert.equal(report.cycles.length, 3);
  for (const c of report.cycles) {
    assert.ok(c.rtoMs !== null && c.rtoMs >= 280 && c.rtoMs < 1500, `RTO near the 300 ms takeover, got ${c.rtoMs}`);
    assert.ok(c.restartedInMs !== null);
  }
  assert.equal(report.writeRtoMs.max, Math.max(...report.cycles.map((c) => c.rtoMs!)));
  assert.ok(report.acknowledgedWrites > 20);
  assert.deepEqual(report.lost, []);
  assert.deepEqual(report.duplicated, []);
  assert.ok(report.attempts > report.acknowledgedWrites, "retries happened across the kills");
});

test("a lost acknowledgement retried under the same key is not a duplicate", async () => {
  const { report, pair } = await drill({ takeoverMs: 200, misbehave: { mode: "ackLost", atWrite: 5 } }, 1);
  assert.equal(report.pass, true, report.failures.join("; "));
  assert.equal(new Set(pair.versions.map((v) => JSON.stringify(v.value))).size, pair.versions.length, "stored once");
});

test("a write acknowledged but never stored is reported lost", async () => {
  const { report } = await drill({ takeoverMs: 200, misbehave: { mode: "lose", atWrite: 7 } }, 1);
  assert.equal(report.pass, false);
  assert.equal(report.lost.length, 1);
  assert.match(report.failures.join(), /missing from history/);
});

test("a retried write stored twice (key ignored) is reported duplicated", async () => {
  const { report } = await drill({ takeoverMs: 200, misbehave: { mode: "duplicate", atWrite: 7 } }, 1);
  assert.equal(report.pass, false);
  assert.equal(report.duplicated.length, 1);
  assert.equal(report.duplicated[0].count, 2);
});

test("a pair that never takes over fails the cycle on the RTO target", async () => {
  const { report } = await drill({ takeoverMs: 60_000 }, 1);
  assert.equal(report.pass, false);
  assert.equal(report.cycles[0].rtoMs, null);
  assert.match(report.failures.join(), /no write acknowledged within 3000 ms/);
});

test("a kill command that fails ends the drill as a failure, not a crash", async () => {
  const pair = await fakePair({ takeoverMs: 100 });
  try {
    const report = await runDrill({
      endpoints: pair.endpoints(), elementId: "record:drill", valueTemplate: '{"value":{"key":"{{key}}"}}', cycles: 3,
      kill: async () => { throw new Error("no such container"); }, restart: () => pair.restartDown(),
      settleMs: 100, rtoTargetMs: 1000, retryMs: 20, gapMs: 5, writeTimeoutMs: 1000, readyTimeoutMs: 2000,
    });
    assert.equal(report.pass, false);
    assert.match(report.failures[0], /cycle 1: kill failed: no such container/);
    assert.equal(report.cycles.length, 0);
  } finally { await pair.close(); }
});
