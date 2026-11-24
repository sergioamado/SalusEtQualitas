/** Distribui blocos sobrepostos em faixas lado a lado (como em qualquer calendário). */
export type Placed<T> = { item: T; start: number; end: number; lane: number; lanes: number };

export function placeInLanes<T>(items: { item: T; start: number; end: number }[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

/** Intervalos [início, fim) em minutos do dia que NÃO estão cobertos por `covered`. */
export function gaps(from: number, to: number, covered: [number, number][]): [number, number][] {
  const sorted = [...covered].sort((a, b) => a[0] - b[0]);
  const result: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of sorted) {
    if (e <= cursor) continue;
    if (s > cursor) result.push([cursor, Math.min(s, to)]);
    cursor = Math.max(cursor, e);
    if (cursor >= to) break;
  }
  if (cursor < to) result.push([cursor, to]);
  return result.filter(([s, e]) => e > s);
}
