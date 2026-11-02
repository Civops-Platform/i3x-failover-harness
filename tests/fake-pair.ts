// A fake redundant i3X pair for the tests: two HTTP servers over one shared store.
// Only one node (the leader) accepts writes; when the leader is killed the other
// takes over after `takeoverMs`. It honours Idempotency-Key unless told to misbehave:
//
//   lose        acknowledge one chosen write without storing it
//   duplicate   store one chosen write, answer 503 so the client retries, then store
//               the retry again (the key is ignored)
//   ackLost     store one chosen write and answer 503 (a lost acknowledgement), but
//               honour the key on the retry: correct behaviour the drill must accept

import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";

export interface FakeOptions { takeoverMs: number; misbehave?: { mode: "lose" | "duplicate" | "ackLost"; atWrite: number } }

export async function fakePair(o: FakeOptions) {
  const versions: Array<{ value: unknown; timestamp: string }> = [];
  const keys = new Map<string, number>();
  let writes = 0;
  let leader = 0;
  let leaderFrom = 0;
  const up = [true, true];
  const servers: Array<Server | null> = [null, null];
  const sockets: Array<Set<Socket>> = [new Set(), new Set()];
  const ports: number[] = [];

  const handler = (node: number) => createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const url = req.url ?? "";
      if (req.method === "GET" && url === "/v1/info") return json(200, { success: true, result: { specVersion: "1.0" } });
      if (req.method === "PUT" && url === "/v1/objects/value") {
        if (node !== leader || Date.now() < leaderFrom) return json(503, { detail: "not the write leader" });
        const u = JSON.parse(body).updates[0];
        const key = String(req.headers["idempotency-key"] ?? "");
        const ok = () => json(200, { success: true, results: [{ success: true, elementId: u.elementId, result: null }] });
        const m = o.misbehave;
        if (key && keys.has(key) && m?.mode !== "duplicate") return ok();
        const n = ++writes;
        if (m?.mode === "lose" && n === m.atWrite) return ok();
        versions.push({ value: u.value.value, timestamp: new Date().toISOString() });
        keys.set(key, versions.length);
        if ((m?.mode === "duplicate" || m?.mode === "ackLost") && n === m.atWrite) return json(503, { detail: "acknowledgement lost" });
        return ok();
      }
      if (req.method === "POST" && url === "/v1/objects/history") {
        const q = JSON.parse(body);
        return json(200, { success: true, results: [{ success: true, elementId: q.elementIds[0], result: { isComposition: false,
          values: versions.map((v) => ({ value: v.value, quality: "Good", timestamp: v.timestamp })) } }] });
      }
      json(404, { detail: "not found" });
    });
  });

  const listen = (node: number) => new Promise<void>((r) => {
    const s = handler(node);
    s.on("connection", (c) => { sockets[node].add(c); c.on("close", () => sockets[node].delete(c)); });
    s.listen(ports[node] ?? 0, "127.0.0.1", () => { ports[node] = (s.address() as { port: number }).port; servers[node] = s; up[node] = true; r(); });
  });
  await listen(0); await listen(1);

  return {
    endpoints: () => ports.map((p) => `http://127.0.0.1:${p}/v1`),
    get leader() { return leader; },
    versions,
    /** Kill the current leader: its server goes away at once, the other node leads after takeoverMs. */
    async killLeader() {
      const victim = leader;
      up[victim] = false;
      servers[victim]!.close();
      for (const c of sockets[victim]) c.destroy();
      servers[victim] = null;
      leader = 1 - victim;
      leaderFrom = Date.now() + o.takeoverMs;
    },
    async restartDown() { for (const n of [0, 1]) if (!up[n]) await listen(n); },
    async close() { for (const n of [0, 1]) { servers[n]?.close(); for (const c of sockets[n]) c.destroy(); } },
  };
}
