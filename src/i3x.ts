// The three i3X 1.0 calls the harness makes, over plain fetch: GET /info,
// PUT /objects/value (one update, with an Idempotency-Key) and POST /objects/history.

export interface Target { base: string; token?: string }

const headers = (t: Target, extra: Record<string, string> = {}) => ({
  "content-type": "application/json",
  ...(t.token ? { authorization: `Bearer ${t.token}` } : {}),
  ...extra,
});

/** true when GET /info answers 200 within the timeout. */
export async function reachable(t: Target, timeoutMs = 2000): Promise<boolean> {
  try {
    const r = await fetch(`${t.base}/info`, { headers: headers(t), signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer();
    return r.ok;
  } catch { return false; }
}

/**
 * One write. Acknowledged means HTTP 200 and the item's `success: true`; anything
 * else (refused, 5xx, timeout, connection reset) is not acknowledged and the caller
 * retries with the same key.
 */
export async function writeValue(t: Target, elementId: string, value: unknown, idempotencyKey: string, timeoutMs: number):
  Promise<{ acked: boolean; status: number; detail?: string }> {
  try {
    const r = await fetch(`${t.base}/objects/value`, {
      method: "PUT", signal: AbortSignal.timeout(timeoutMs),
      headers: headers(t, { "idempotency-key": idempotencyKey }),
      body: JSON.stringify({ updates: [{ elementId, value }] }),
    });
    const text = await r.text();
    let b: any = null;
    try { b = JSON.parse(text); } catch { /* not JSON */ }
    const item = b?.results?.[0];
    if (r.status === 200 && item?.success === true) return { acked: true, status: 200 };
    return { acked: false, status: r.status, detail: item?.responseDetail?.detail ?? b?.detail ?? text.slice(0, 200) };
  } catch (e) {
    return { acked: false, status: 0, detail: (e as Error).message };
  }
}

/** Every value the server holds for one element between two times, as i3X returns them. */
export async function history(t: Target, elementId: string, startTime: string, endTime: string, timeoutMs = 30_000):
  Promise<Array<{ value: unknown; quality?: string; timestamp?: string }>> {
  const r = await fetch(`${t.base}/objects/history`, {
    method: "POST", signal: AbortSignal.timeout(timeoutMs), headers: headers(t),
    body: JSON.stringify({ elementIds: [elementId], startTime, endTime }),
  });
  const b = await r.json() as any;
  const item = b?.results?.[0];
  if (r.status !== 200 || !item?.success) throw new Error(`history read of ${elementId} failed: HTTP ${r.status} ${JSON.stringify(item?.responseDetail ?? b).slice(0, 200)}`);
  return item.result?.values ?? [];
}
