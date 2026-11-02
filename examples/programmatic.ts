// The drill from code instead of the CLI, with kill and restart as functions.
//
//   I3X_TOKEN=… npx tsx examples/programmatic.ts

import { runDrill, shell } from "../src/index";

const report = await runDrill({
  endpoints: ["http://127.0.0.1:8411/v1", "http://127.0.0.1:8412/v1"],
  token: process.env.I3X_TOKEN,
  elementId: "signal:ship-eta",
  valueTemplate: '{"value":{"status":"active","order":"{{key}}"}}',
  cycles: 5,
  kill: (cycle) => shell("sh examples/kill-leader.sh", { I3X_CYCLE: String(cycle) }),
  restart: () => shell("sh examples/restart-killed.sh"),
  log: console.log,
});
console.log(JSON.stringify({ pass: report.pass, writeRtoMs: report.writeRtoMs, lost: report.lost.length, duplicated: report.duplicated.length }));
