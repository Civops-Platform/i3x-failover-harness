// The conformance mode with a stand-in suite (tests/fixtures/suite) against the
// fake pair: the kill lands during the run, the survivor keeps answering, and a
// run where the client's own endpoint dies is reported as a failure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConformanceUnderFailover } from "../src/index";
import { fakePair } from "./fake-pair";

const SUITE = join(import.meta.dirname, "fixtures", "suite");

test("kill the other node mid-run: the surviving endpoint stays compliant", async () => {
  const pair = await fakePair({ takeoverMs: 100 });
  const dir = mkdtempSync(join(tmpdir(), "i3x-fo-"));
  try {
    const survivor = pair.endpoints()[1];
    const r = await runConformanceUnderFailover({ suite: SUITE, endpoint: survivor, jsonOut: join(dir, "r.json"), killAfterMs: 400, kill: () => pair.killLeader(), restart: () => pair.restartDown() });
    assert.equal(r.pass, true, r.failures.join("; "));
    assert.equal(r.killedDuringRun, true);
    assert.equal(r.verdict, "Full 1.0 Compliance");
    assert.ok(r.counts!.pass > 5);
  } finally { await pair.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("if the endpoint under test is the one that dies, the run fails", async () => {
  const pair = await fakePair({ takeoverMs: 100 });
  const dir = mkdtempSync(join(tmpdir(), "i3x-fo-"));
  try {
    const r = await runConformanceUnderFailover({ suite: SUITE, endpoint: pair.endpoints()[0], jsonOut: join(dir, "r.json"), killAfterMs: 400, kill: () => pair.killLeader() });
    assert.equal(r.pass, false);
    assert.ok(r.counts!.fail > 0);
    assert.equal(r.endpointUpAfter, false);
  } finally { await pair.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a kill scheduled after the suite finishes is flagged", async () => {
  const pair = await fakePair({ takeoverMs: 100 });
  const dir = mkdtempSync(join(tmpdir(), "i3x-fo-"));
  try {
    const r = await runConformanceUnderFailover({ suite: SUITE, endpoint: pair.endpoints()[1], jsonOut: join(dir, "r.json"), killAfterMs: 60_000, kill: () => pair.killLeader() });
    assert.equal(r.killedDuringRun, false);
    assert.match(r.failures.join(), /lower --kill-after/);
  } finally { await pair.close(); rmSync(dir, { recursive: true, force: true }); }
});
