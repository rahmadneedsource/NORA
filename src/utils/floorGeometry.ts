import type {
  FloorPlanSpec,
  RoomZone,
  RouteEdge,
  RouteNode,
  WallSegment,
} from '../data/blueprints';
import type { DepthFrameSummary } from './depthEstimator';

export function snapToGrid(v: number, step = 0.25): number {
  return Math.round(v / step) * step;
}

function mergeIntervals(intervals: Array<[number, number]>, mergeGap = 0.08): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = merged[merged.length - 1];
    if (s <= last[1] + mergeGap) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function groupEdgeLines(
  rawEdges: Array<{ coord: number; s: number; e: number }>,
  coordTol = 0.26,
): Array<{ coord: number; spans: Array<[number, number]> }> {
  const sorted = [...rawEdges].sort((a, b) => a.coord - b.coord);
  const groups: Array<{ minC: number; maxC: number; intervals: Array<[number, number]> }> = [];

  for (const edge of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(edge.coord - last.minC) <= coordTol) {
      last.maxC = Math.max(last.maxC, edge.coord);
      last.intervals.push([edge.s, edge.e]);
    } else {
      groups.push({ minC: edge.coord, maxC: edge.coord, intervals: [[edge.s, edge.e]] });
    }
  }

  return groups.map((g) => ({
    coord: Number(((g.minC + g.maxC) / 2).toFixed(2)),
    spans: mergeIntervals(g.intervals, 0.12),
  }));
}

function subtractBlockers(
  start: number,
  end: number,
  blockers: Array<[number, number]>,
  minLen = 0.14,
): Array<[number, number]> {
  let spans: Array<[number, number]> = [[start, end]];
  for (const [bStart, bEnd] of blockers) {
    const next: Array<[number, number]> = [];
    for (const [s, e] of spans) {
      if (bEnd <= s + 0.02 || bStart >= e - 0.02) {
        next.push([s, e]);
      } else {
        if (bStart - s >= minLen) next.push([s, bStart]);
        if (e - bEnd >= minLen) next.push([bEnd, e]);
      }
    }
    spans = next;
  }
  return spans;
}

export function synthesizePerimeterWalls(rooms: RoomZone[]): {
  walls: WallSegment[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const horizEdges: Array<{ coord: number; s: number; e: number }> = [];
  const vertEdges: Array<{ coord: number; s: number; e: number }> = [];

  for (const r of rooms) {
    const x0 = r.bounds.x - r.bounds.w / 2;
    const x1 = r.bounds.x + r.bounds.w / 2;
    const z0 = r.bounds.z - r.bounds.d / 2;
    const z1 = r.bounds.z + r.bounds.d / 2;
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minZ = Math.min(minZ, z0);
    maxZ = Math.max(maxZ, z1);

    horizEdges.push({ coord: z0, s: x0, e: x1 });
    horizEdges.push({ coord: z1, s: x0, e: x1 });
    vertEdges.push({ coord: x0, s: z0, e: z1 });
    vertEdges.push({ coord: x1, s: z0, e: z1 });
  }

  if (!Number.isFinite(minX)) {
    minX = -5;
    maxX = 5;
    minZ = -5;
    maxZ = 5;
  }

  const wallThickness = 0.22;
  const walls: WallSegment[] = [];

  // Merge collinear edge intervals & exclude any span cutting through another room's interior
  for (const line of groupEdgeLines(horizEdges)) {
    const isFrontCutaway = Math.abs(line.coord - maxZ) < 0.28;
    const isBackExterior = Math.abs(line.coord - minZ) < 0.28;
    const h = isFrontCutaway ? 1.45 : isBackExterior ? 2.05 : 2.0;

    const interiorBlockers: Array<[number, number]> = [];
    for (const r of rooms) {
      const rT = r.bounds.z - r.bounds.d / 2;
      const rB = r.bounds.z + r.bounds.d / 2;
      if (line.coord > rT + 0.16 && line.coord < rB - 0.16) {
        interiorBlockers.push([r.bounds.x - r.bounds.w / 2 + 0.04, r.bounds.x + r.bounds.w / 2 - 0.04]);
      }
    }

    for (const [rawS, rawE] of line.spans) {
      for (const [s, e] of subtractBlockers(rawS, rawE, interiorBlockers)) {
        const len = e - s;
        if (len < 0.15) continue;
        walls.push({
          x: Number(((s + e) / 2).toFixed(3)),
          z: line.coord,
          w: Number((len + wallThickness).toFixed(3)),
          d: wallThickness,
          h,
        });
      }
    }
  }

  for (const line of groupEdgeLines(vertEdges)) {
    const isOuterSide = Math.abs(line.coord - minX) < 0.28 || Math.abs(line.coord - maxX) < 0.28;
    const h = isOuterSide ? 2.05 : 2.0;

    const interiorBlockers: Array<[number, number]> = [];
    for (const r of rooms) {
      const rL = r.bounds.x - r.bounds.w / 2;
      const rR = r.bounds.x + r.bounds.w / 2;
      if (line.coord > rL + 0.16 && line.coord < rR - 0.16) {
        interiorBlockers.push([r.bounds.z - r.bounds.d / 2 + 0.04, r.bounds.z + r.bounds.d / 2 - 0.04]);
      }
    }

    for (const [rawS, rawE] of line.spans) {
      for (const [s, e] of subtractBlockers(rawS, rawE, interiorBlockers)) {
        const len = e - s;
        if (len < 0.15) continue;
        walls.push({
          x: line.coord,
          z: Number(((s + e) / 2).toFixed(3)),
          w: wallThickness,
          d: Number((len + wallThickness).toFixed(3)),
          h,
        });
      }
    }
  }

  return { walls, bounds: { minX, maxX, minZ, maxZ } };
}

function segmentIntersectsRect(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { ix: number; iz: number } | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dz = z2 - z1;

  const checks: Array<[number, number]> = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dz, z1 - minZ],
    [dz, maxZ - z1],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  const tm = (t0 + t1) / 2;
  return { ix: x1 + tm * dx, iz: z1 + tm * dz };
}

export function splitWallWithGap(wall: WallSegment, cutPos: number, gapHalf = 0.56): WallSegment[] {
  const isHorizontal = wall.w >= wall.d;
  const start = isHorizontal ? wall.x - wall.w / 2 : wall.z - wall.d / 2;
  const end = isHorizontal ? wall.x + wall.w / 2 : wall.z + wall.d / 2;
  const len = end - start;
  // Preserve corner joints on long walls so doorway openings never tear apart 90-degree corners
  const clampedCut =
    len >= gapHalf * 2 + 0.55
      ? Math.max(start + 0.24 + gapHalf, Math.min(end - 0.24 - gapHalf, cutPos))
      : cutPos;
  const gapStart = clampedCut - gapHalf;
  const gapEnd = clampedCut + gapHalf;
  if (gapEnd <= start || gapStart >= end) return [wall];

  const out: WallSegment[] = [];
  if (gapStart - start >= 0.14) {
    const seg = gapStart - start;
    out.push(
      isHorizontal
        ? { ...wall, x: start + seg / 2, w: seg }
        : { ...wall, z: start + seg / 2, d: seg },
    );
  }
  if (end - gapEnd >= 0.14) {
    const seg = end - gapEnd;
    out.push(
      isHorizontal
        ? { ...wall, x: gapEnd + seg / 2, w: seg }
        : { ...wall, z: gapEnd + seg / 2, d: seg },
    );
  }
  return out;
}

export function carveDoorwaysInWalls(
  walls: WallSegment[],
  nodes: RouteNode[],
  edges: RouteEdge[],
  rooms: RoomZone[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): WallSegment[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let current = [...walls];

  // Carve doorways around explicit doorway waypoints across any matching wall(s) on the seam
  const doorwayWaypoints = nodes.filter((n) => !n.roomId);
  if (doorwayWaypoints.length > 0) {
    for (const wp of doorwayWaypoints) {
      const next: WallSegment[] = [];
      for (const w of current) {
        const isHoriz = w.w >= w.d;
        const perpDist = isHoriz ? Math.abs(wp.z - w.z) : Math.abs(wp.x - w.x);
        const spanHalf = (isHoriz ? w.w : w.d) / 2;
        const alongDist = isHoriz ? Math.abs(wp.x - w.x) : Math.abs(wp.z - w.z);
        if (perpDist <= 0.45 && alongDist <= spanHalf + 0.2) {
          const cutPos = isHoriz ? wp.x : wp.z;
          next.push(...splitWallWithGap(w, cutPos, 0.56));
        } else {
          next.push(w);
        }
      }
      current = next;
    }
  } else {
    for (const [idA, idB] of edges) {
      const a = nodeMap.get(idA);
      const b = nodeMap.get(idB);
      if (!a || !b) continue;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;

      let bestIdx = -1;
      let bestDist = Infinity;
      let bestCut = 0;
      for (let i = 0; i < current.length; i++) {
        const wall = current[i];
        const hit = segmentIntersectsRect(
          a.x,
          a.z,
          b.x,
          b.z,
          wall.x - wall.w / 2 - 0.12,
          wall.x + wall.w / 2 + 0.12,
          wall.z - wall.d / 2 - 0.12,
          wall.z + wall.d / 2 + 0.12,
        );
        if (!hit) continue;
        const dMid = Math.hypot(hit.ix - midX, hit.iz - midZ);
        if (dMid < bestDist) {
          bestDist = dMid;
          bestIdx = i;
          bestCut = wall.w >= wall.d ? hit.ix : hit.iz;
        }
      }
      if (bestIdx !== -1) {
        const pieces = splitWallWithGap(current[bestIdx], bestCut, 0.54);
        current.splice(bestIdx, 1, ...pieces);
      }
    }
  }

  // Prune tiny isolated leftover sticks (< 0.48m) sitting detached between two door openings
  current = current.filter((w) => Math.max(w.w, w.d) >= 0.48);

  const maxWallZ = current.reduce(
    (m, w) => (w.w >= w.d ? Math.max(m, w.z) : m),
    bounds.maxZ,
  );
  const frontWall = current.find(
    (w) => w.w >= w.d && Math.abs(w.z - maxWallZ) < 0.35 && w.w > 2.4,
  );
  if (frontWall) {
    const frontWallsCount = current.filter(
      (w) => w.w >= w.d && Math.abs(w.z - maxWallZ) < 0.35,
    ).length;
    if (frontWallsCount === 1) {
      const entryX = rooms[0]?.bounds.x ?? frontWall.x;
      current = current.flatMap((w) =>
        w === frontWall ? splitWallWithGap(w, entryX, 0.62) : [w],
      );
    }
  }

  return current;
}

function computeDoorWaypoint(roomA: RoomZone, roomB: RoomZone): { x: number; z: number } {
  const a = roomA.bounds;
  const b = roomB.bounds;
  const overlapZ =
    Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  const overlapX =
    Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);

  if (overlapZ >= 0.35 && overlapZ >= overlapX) {
    return {
      x: Number(((a.x < b.x ? a.x + a.w / 2 + b.x - b.w / 2 : a.x - a.w / 2 + b.x + b.w / 2) / 2).toFixed(2)),
      z: Number(((Math.max(a.z - a.d / 2, b.z - b.d / 2) + Math.min(a.z + a.d / 2, b.z + b.d / 2)) / 2).toFixed(2)),
    };
  }
  if (overlapX >= 0.35) {
    return {
      x: Number(((Math.max(a.x - a.w / 2, b.x - b.w / 2) + Math.min(a.x + a.w / 2, b.x + b.w / 2)) / 2).toFixed(2)),
      z: Number(((a.z < b.z ? a.z + a.d / 2 + b.z - b.d / 2 : a.z - a.d / 2 + b.z + b.d / 2) / 2).toFixed(2)),
    };
  }
  return {
    x: Number(((a.x + b.x) / 2).toFixed(2)),
    z: Number(((a.z + b.z) / 2).toFixed(2)),
  };
}

function scoreRoomAdjacency(roomA: RoomZone, roomB: RoomZone): number {
  const a = roomA.bounds;
  const b = roomB.bounds;
  const gapX = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const gapZ = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  const overlapZ =
    Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  const overlapX =
    Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const centerDist = Math.hypot(a.x - b.x, a.z - b.z);

  if (gapX <= 0.45 && overlapZ >= 0.7) {
    return gapX * 10 + centerDist * 0.05;
  }
  if (gapZ <= 0.45 && overlapX >= 0.7) {
    return gapZ * 10 + centerDist * 0.05;
  }
  return 100 + (gapX + gapZ) * 20 + centerDist;
}

export function buildRouteGraphForRooms(rooms: RoomZone[]): {
  nodes: RouteNode[];
  edges: RouteEdge[];
} {
  if (rooms.length === 0) return { nodes: [], edges: [] };
  if (rooms.length === 1) {
    return {
      nodes: [{ id: `rn_${rooms[0].id}`, roomId: rooms[0].id, x: rooms[0].bounds.x, z: rooms[0].bounds.z }],
      edges: [],
    };
  }

  const pairs: Array<[string, string]> = [];
  const connected = new Set<number>([0]);
  while (connected.size < rooms.length) {
    let bestU = 0;
    let bestV = 0;
    let bestScore = Infinity;
    for (const u of connected) {
      for (let v = 0; v < rooms.length; v++) {
        if (connected.has(v)) continue;
        const score = scoreRoomAdjacency(rooms[u], rooms[v]);
        if (score < bestScore) {
          bestScore = score;
          bestU = u;
          bestV = v;
        }
      }
    }
    pairs.push([rooms[bestU].id, rooms[bestV].id]);
    connected.add(bestV);
  }

  return buildRouteGraphFromDoorPairs(rooms, pairs);
}

export function buildRouteGraphFromDoorPairs(
  rooms: RoomZone[],
  doorPairs: Array<[string, string]>,
): { nodes: RouteNode[]; edges: RouteEdge[] } {
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const nodes: RouteNode[] = rooms.map((r) => ({
    id: `rn_${r.id}`,
    roomId: r.id,
    x: r.bounds.x,
    z: r.bounds.z,
  }));
  const edges: RouteEdge[] = [];
  const seen = new Set<string>();

  for (const [idA, idB] of doorPairs) {
    if (idA === idB) continue;
    const roomA = roomMap.get(idA);
    const roomB = roomMap.get(idB);
    if (!roomA || !roomB) continue;
    const key = idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const door = computeDoorWaypoint(roomA, roomB);
    const wpId = `wp_${idA}_${idB}`;
    nodes.push({ id: wpId, x: door.x, z: door.z });
    edges.push([`rn_${idA}`, wpId]);
    edges.push([wpId, `rn_${idB}`]);
  }

  return { nodes, edges };
}

export function extractDoorPairsFromRoute(
  rooms: RoomZone[],
  nodes: RouteNode[],
  edges: RouteEdge[],
): Array<[string, string]> {
  const validRoomIds = new Set(rooms.map((r) => r.id));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }

  const pairs: Array<[string, string]> = [];
  const seenPairs = new Set<string>();

  const addPair = (ra: string, rb: string) => {
    if (ra === rb || !validRoomIds.has(ra) || !validRoomIds.has(rb)) return;
    const key = ra < rb ? `${ra}::${rb}` : `${rb}::${ra}`;
    if (!seenPairs.has(key)) {
      seenPairs.add(key);
      pairs.push([ra, rb]);
    }
  };

  // Detect whether graph uses explicit wp_<A>_<B> door waypoints
  const wpNodes = nodes.filter((n) => !n.roomId && n.id.startsWith('wp_'));
  let usedExplicitWp = false;
  for (const wp of wpNodes) {
    const nbrs = adj.get(wp.id) ?? [];
    if (nbrs.length === 2) {
      const rA = nodeById.get(nbrs[0])?.roomId;
      const rB = nodeById.get(nbrs[1])?.roomId;
      if (rA && rB && validRoomIds.has(rA) && validRoomIds.has(rB)) {
        addPair(rA, rB);
        usedExplicitWp = true;
      }
    }
  }
  if (usedExplicitWp) {
    return pairs;
  }

  // For hand-authored corridor/junction graphs, keep only wall-adjacent pairs along BFS paths
  const candidatePairs: Array<{ a: string; b: string; score: number }> = [];
  for (const r of rooms) {
    const startNodes = nodes.filter((n) => n.roomId === r.id).map((n) => n.id);
    for (const startId of startNodes) {
      const visited = new Set<string>([startId]);
      const queue = [...(adj.get(startId) ?? [])];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const curNode = nodeById.get(cur);
        if (!curNode) continue;
        if (curNode.roomId && curNode.roomId !== r.id && validRoomIds.has(curNode.roomId)) {
          const other = roomById.get(curNode.roomId);
          if (other) {
            candidatePairs.push({ a: r.id, b: other.id, score: scoreRoomAdjacency(r, other) });
          }
          continue;
        }
        for (const nxt of adj.get(cur) ?? []) {
          if (!visited.has(nxt)) queue.push(nxt);
        }
      }
    }
  }

  // Only connect direct adjacent pairs (score < 100) + keep graph connected as fallback MST
  candidatePairs.sort((x, y) => x.score - y.score);
  const parent = new Map(rooms.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  for (const cand of candidatePairs) {
    const pa = find(cand.a);
    const pb = find(cand.b);
    if (cand.score < 50 || pa !== pb) {
      addPair(cand.a, cand.b);
      parent.set(pa, pb);
    }
  }

  return pairs;
}

export function snapRoomsToManhattanGrid(
  rooms: RoomZone[],
  depthProfiles: DepthFrameSummary[] = [],
  hasUserSizeHint = false,
  anchorRoomId?: string,
): RoomZone[] {
  const meanDepthWidth =
    depthProfiles.length > 0
      ? depthProfiles.reduce((acc, d) => acc + d.estCorridorWidthM, 0) / depthProfiles.length
      : null;

  const snapped = rooms.map((r) => {
    let rawW = r.bounds.w;
    let rawD = r.bounds.d;
    if (!hasUserSizeHint && meanDepthWidth !== null && r.category === 'hallway' && rawW > 2.8) {
      rawW = Math.max(1.5, Math.min(rawW, meanDepthWidth * 1.35));
    }

    const w = Math.max(1.25, snapToGrid(rawW));
    const d = Math.max(1.25, snapToGrid(rawD));
    const x = snapToGrid(r.bounds.x);
    const z = snapToGrid(r.bounds.z);
    return {
      ...r,
      bounds: { x, z, w, d },
      labelPos: [x, 1.35, z] as [number, number, number],
    };
  });

  // Pass 1: Resolve room-on-room overlaps along minimum penetration axis
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < snapped.length; i++) {
      for (let j = i + 1; j < snapped.length; j++) {
        const jIsAnchor = anchorRoomId !== undefined && snapped[j].id === anchorRoomId;
        const fixedRoom = jIsAnchor ? snapped[j] : snapped[i];
        const movableRoom = jIsAnchor ? snapped[i] : snapped[j];
        const a = fixedRoom.bounds;
        const b = movableRoom.bounds;

        const overlapX =
          Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const overlapZ =
          Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);

        if (overlapX > 0.08 && overlapZ > 0.08) {
          if (overlapX <= overlapZ) {
            const dir = b.x >= a.x ? 1 : -1;
            b.x = snapToGrid(a.x + dir * (a.w / 2 + b.w / 2));
          } else {
            const dir = b.z >= a.z ? 1 : -1;
            b.z = snapToGrid(a.z + dir * (a.d / 2 + b.d / 2));
          }
          movableRoom.labelPos = [b.x, 1.35, b.z];
        }
      }
    }
  }

  // Pass 2: Close tiny gaps (<= 0.55m) when running full layout snap (not single-room nudge)
  if (!anchorRoomId) {
    for (let i = 0; i < snapped.length; i++) {
      for (let j = i + 1; j < snapped.length; j++) {
        const a = snapped[i].bounds;
        const b = snapped[j].bounds;

        const overlapZ =
          Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
        if (overlapZ >= 0.75) {
          const gapLR = b.x - b.w / 2 - (a.x + a.w / 2);
          if (gapLR > 0.01 && gapLR <= 0.55) {
            b.x = snapToGrid(a.x + a.w / 2 + b.w / 2);
            snapped[j].labelPos = [b.x, 1.35, b.z];
          }
          const gapRL = a.x - a.w / 2 - (b.x + b.w / 2);
          if (gapRL > 0.01 && gapRL <= 0.55) {
            b.x = snapToGrid(a.x - a.w / 2 - b.w / 2);
            snapped[j].labelPos = [b.x, 1.35, b.z];
          }
        }

        const overlapX =
          Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        if (overlapX >= 0.75) {
          const gapTB = b.z - b.d / 2 - (a.z + a.d / 2);
          if (gapTB > 0.01 && gapTB <= 0.55) {
            b.z = snapToGrid(a.z + a.d / 2 + b.d / 2);
            snapped[j].labelPos = [b.x, 1.35, b.z];
          }
          const gapBT = a.z - a.d / 2 - (b.z + b.d / 2);
          if (gapBT > 0.01 && gapBT <= 0.55) {
            b.z = snapToGrid(a.z - a.d / 2 - b.d / 2);
            snapped[j].labelPos = [b.x, 1.35, b.z];
          }
        }
      }
    }
  }

  return snapped;
}

/**
 * Hitung ulang dinding, bukaan pintu, rute navigasi, plinth, & kamera dari susunan ruangan terkini.
 */
export function rebuildFloorLayout(
  floor: FloorPlanSpec,
  options?: { snapOverlaps?: boolean; anchorRoomId?: string; doorPairs?: Array<[string, string]> },
): FloorPlanSpec {
  const baseRooms = options?.snapOverlaps
    ? snapRoomsToManhattanGrid(floor.rooms, [], true, options?.anchorRoomId)
    : floor.rooms.map((r) => ({
        ...r,
        labelPos: [r.bounds.x, 1.35, r.bounds.z] as [number, number, number],
      }));

  const { walls: rawWalls, bounds } = synthesizePerimeterWalls(baseRooms);
  const roomById = new Map(baseRooms.map((r) => [r.id, r]));

  let doorPairs: Array<[string, string]>;
  if (options?.doorPairs !== undefined) {
    doorPairs = options.doorPairs;
  } else {
    const extracted = extractDoorPairsFromRoute(baseRooms, floor.routeNodes, floor.routeEdges);
    // Prune doors between rooms that have been dragged far apart (>0.75m gap)
    doorPairs = extracted.filter(([aId, bId]) => {
      const rA = roomById.get(aId);
      const rB = roomById.get(bId);
      if (!rA || !rB) return false;
      return scoreRoomAdjacency(rA, rB) <= 115;
    });

    if (baseRooms.length >= 2) {
      const parent = new Map(baseRooms.map((r) => [r.id, r.id]));
      const find = (x: string): string => {
        let p = parent.get(x) ?? x;
        while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
        parent.set(x, p);
        return p;
      };
      const existingKeys = new Set<string>();
      for (const [aId, bId] of doorPairs) {
        const key = aId < bId ? `${aId}::${bId}` : `${bId}::${aId}`;
        existingKeys.add(key);
        parent.set(find(aId), find(bId));
      }

      const allPairs: Array<{ a: string; b: string; score: number }> = [];
      for (let i = 0; i < baseRooms.length; i++) {
        for (let j = i + 1; j < baseRooms.length; j++) {
          allPairs.push({
            a: baseRooms[i].id,
            b: baseRooms[j].id,
            score: scoreRoomAdjacency(baseRooms[i], baseRooms[j]),
          });
        }
      }
      allPairs.sort((x, y) => x.score - y.score);
      for (const cand of allPairs) {
        const pa = find(cand.a);
        const pb = find(cand.b);
        if (pa !== pb) {
          const key = cand.a < cand.b ? `${cand.a}::${cand.b}` : `${cand.b}::${cand.a}`;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            doorPairs.push(cand.a < cand.b ? [cand.a, cand.b] : [cand.b, cand.a]);
          }
          parent.set(pa, pb);
        }
      }
    }
  }

  const route =
    options?.doorPairs !== undefined
      ? buildRouteGraphFromDoorPairs(baseRooms, doorPairs)
      : doorPairs.length > 0
        ? buildRouteGraphFromDoorPairs(baseRooms, doorPairs)
        : buildRouteGraphForRooms(baseRooms);

  const walls = carveDoorwaysInWalls(rawWalls, route.nodes, route.edges, baseRooms, bounds);
  const cx = Number(((bounds.minX + bounds.maxX) / 2).toFixed(2));
  const cz = Number(((bounds.minZ + bounds.maxZ) / 2).toFixed(2));
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 4);

  const validIds = new Set(baseRooms.map((r) => r.id));
  const defaultFromRoomId = validIds.has(floor.defaultFromRoomId)
    ? floor.defaultFromRoomId
    : baseRooms[0]?.id ?? floor.defaultFromRoomId;
  const defaultToRoomId =
    validIds.has(floor.defaultToRoomId) && floor.defaultToRoomId !== defaultFromRoomId
      ? floor.defaultToRoomId
      : baseRooms.find((r) => r.id !== defaultFromRoomId)?.id ?? defaultFromRoomId;

  return {
    ...floor,
    rooms: baseRooms,
    walls,
    floorBounds: bounds,
    plinth: {
      x: cx,
      z: cz,
      w: Number((bounds.maxX - bounds.minX + 0.6).toFixed(2)),
      d: Number((bounds.maxZ - bounds.minZ + 0.6).toFixed(2)),
    },
    isoCamera: {
      pos: [cx - span * 0.72, Math.max(8.5, span * 1.05), cz + span * 0.92],
      target: [cx, 0.35, cz],
    },
    topCamera: {
      pos: [cx, Math.max(11.5, span * 1.45), cz + 0.01],
      target: [cx, 0, cz],
    },
    routeNodes: route.nodes,
    routeEdges: route.edges,
    defaultFromRoomId,
    defaultToRoomId,
    nightLightPositions: [
      [cx, 0.45, cz],
      ...(baseRooms[1] ? [[baseRooms[1].bounds.x, 0.45, baseRooms[1].bounds.z] as [number, number, number]] : []),
    ],
  };
}
