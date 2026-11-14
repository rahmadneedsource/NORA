import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  DoorOpen,
  Layers,
  Magnet,
  Plus,
  RotateCw,
  Sofa,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FloorPlanSpec,
  FurnitureItem,
  FurnitureKind,
  HazardFinding,
  RoomCategory,
  RoomZone,
} from '../data/blueprints';
import {
  buildRouteGraphForRooms,
  extractDoorPairsFromRoute,
  rebuildFloorLayout,
  snapToGrid,
} from '../utils/floorGeometry';

export type LayoutEditMode = 'rooms' | 'furniture' | 'doors';

export interface LayoutEditorPanelProps {
  floor: FloorPlanSpec;
  hazards: HazardFinding[];
  onApplyFloorUpdate: (nextFloor: FloorPlanSpec, nextHazards?: HazardFinding[]) => void;
  onClose: () => void;
}

const ROOM_CATEGORIES: Array<{ value: RoomCategory; label: string }> = [
  { value: 'bedroom', label: 'Kamar Tidur' },
  { value: 'bathroom', label: 'Kamar Mandi / Toilet' },
  { value: 'kitchen', label: 'Dapur' },
  { value: 'living', label: 'Ruang Tamu / Santai' },
  { value: 'hallway', label: 'Lorong / Koridor' },
  { value: 'entrance', label: 'Pintu Masuk / Teras' },
  { value: 'balcony', label: 'Balkon' },
];

const FURNITURE_KINDS: Array<{ value: FurnitureKind; label: string; w: number; d: number }> = [
  { value: 'bed', label: 'Kasur / Ranjang', w: 1.5, d: 2.0 },
  { value: 'sofa', label: 'Sofa / Kursi', w: 1.7, d: 0.9 },
  { value: 'table', label: 'Meja / Meja Kerja', w: 1.2, d: 0.7 },
  { value: 'toilet', label: 'Kloset', w: 0.5, d: 0.7 },
  { value: 'sink', label: 'Wastafel', w: 0.65, d: 0.5 },
  { value: 'counter', label: 'Meja Dapur / Kitchen Set', w: 1.5, d: 0.65 },
  { value: 'cabinet', label: 'Rak / Lemari', w: 1.0, d: 0.5 },
  { value: 'rug', label: 'Keset / Karpet', w: 1.1, d: 0.7 },
  { value: 'cable', label: 'Kabel Melintang', w: 1.0, d: 0.18 },
  { value: 'plant', label: 'Pot Tanaman', w: 0.45, d: 0.45 },
  { value: 'grabbar', label: 'Grab Bar', w: 0.14, d: 0.9 },
];

function isPointInsideRoom(x: number, z: number, r: RoomZone): boolean {
  return (
    Math.abs(x - r.bounds.x) <= r.bounds.w / 2 + 0.12 &&
    Math.abs(z - r.bounds.z) <= r.bounds.d / 2 + 0.12
  );
}

interface ViewProjection {
  cx: number;
  cz: number;
  scale: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function computeMagneticRoomSnap(
  roomId: string,
  candX: number,
  candZ: number,
  w: number,
  d: number,
  rooms: RoomZone[],
  threshold = 0.3,
): { x: number; z: number; guideX?: number; guideZ?: number } {
  let bestX = snapToGrid(candX, 0.05);
  let bestXDist = threshold;
  let guideX: number | undefined;

  let bestZ = snapToGrid(candZ, 0.05);
  let bestZDist = threshold;
  let guideZ: number | undefined;

  for (const other of rooms) {
    if (other.id === roomId) continue;
    const oL = other.bounds.x - other.bounds.w / 2;
    const oR = other.bounds.x + other.bounds.w / 2;
    const oT = other.bounds.z - other.bounds.d / 2;
    const oB = other.bounds.z + other.bounds.d / 2;

    const xTargets: Array<{ cx: number; guide: number }> = [
      { cx: oL - w / 2, guide: oL },
      { cx: oR + w / 2, guide: oR },
      { cx: oL + w / 2, guide: oL },
      { cx: oR - w / 2, guide: oR },
    ];
    for (const t of xTargets) {
      const dist = Math.abs(candX - t.cx);
      if (dist < bestXDist) {
        bestXDist = dist;
        bestX = t.cx;
        guideX = t.guide;
      }
    }

    const zTargets: Array<{ cz: number; guide: number }> = [
      { cz: oT - d / 2, guide: oT },
      { cz: oB + d / 2, guide: oB },
      { cz: oT + d / 2, guide: oT },
      { cz: oB - d / 2, guide: oB },
    ];
    for (const t of zTargets) {
      const dist = Math.abs(candZ - t.cz);
      if (dist < bestZDist) {
        bestZDist = dist;
        bestZ = t.cz;
        guideZ = t.guide;
      }
    }
  }

  // Slide cleanly along outer walls instead of clipping inside neighboring rooms
  let slid = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const other of rooms) {
      if (other.id === roomId) continue;
      const ox = other.bounds.x;
      const oz = other.bounds.z;
      const ow = other.bounds.w;
      const od = other.bounds.d;
      const overlapX = Math.min(bestX + w / 2, ox + ow / 2) - Math.max(bestX - w / 2, ox - ow / 2);
      const overlapZ = Math.min(bestZ + d / 2, oz + od / 2) - Math.max(bestZ - d / 2, oz - od / 2);

      if (overlapX > 0.06 && overlapZ > 0.06) {
        slid = true;
        if (overlapX <= overlapZ) {
          const pushRight = candX >= ox;
          bestX = pushRight ? ox + ow / 2 + w / 2 : ox - ow / 2 - w / 2;
          guideX = pushRight ? ox + ow / 2 : ox - ow / 2;
        } else {
          const pushDown = candZ >= oz;
          bestZ = pushDown ? oz + od / 2 + d / 2 : oz - od / 2 - d / 2;
          guideZ = pushDown ? oz + od / 2 : oz - od / 2;
        }
      }
    }
  }
  if (slid) {
    if (guideX !== undefined && Math.abs(bestX - w / 2 - guideX) > 0.05 && Math.abs(bestX + w / 2 - guideX) > 0.05) {
      guideX = undefined;
    }
    if (guideZ !== undefined && Math.abs(bestZ - d / 2 - guideZ) > 0.05 && Math.abs(bestZ + d / 2 - guideZ) > 0.05) {
      guideZ = undefined;
    }
  }

  return {
    x: Number(bestX.toFixed(2)),
    z: Number(bestZ.toFixed(2)),
    guideX,
    guideZ,
  };
}

export default function LayoutEditorPanel({
  floor,
  hazards,
  onApplyFloorUpdate,
  onClose,
}: LayoutEditorPanelProps) {
  const [mode, setMode] = useState<LayoutEditMode>('rooms');
  const [selectedRoomId, setSelectedRoomId] = useState<string>(floor.rooms[0]?.id ?? '');
  const [selectedFurnitureId, setSelectedFurnitureId] = useState<string>(
    floor.furniture.find((f) => !f.showOnlyInRemediation)?.id ?? floor.furniture[0]?.id ?? '',
  );
  const [moveContentsWithRoom, setMoveContentsWithRoom] = useState(true);
  const [doorRoomA, setDoorRoomA] = useState<string>(floor.rooms[0]?.id ?? '');
  const [doorRoomB, setDoorRoomB] = useState<string>(floor.rooms[1]?.id ?? floor.rooms[0]?.id ?? '');
  const [pendingDoorRoomId, setPendingDoorRoomId] = useState<string | null>(null);

  const [frozenViewBounds, setFrozenViewBounds] = useState<ViewProjection | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; z?: number }>({});

  const svgRef = useRef<SVGSVGElement | null>(null);
  const idSeqRef = useRef(0);
  const dragRafRef = useRef<number | null>(null);
  const pendingDragClientRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    kind: 'room' | 'furniture';
    id: string;
    pointerId: number;
    startWorldX: number;
    startWorldZ: number;
    viewAtStart: ViewProjection;
    origFloor: FloorPlanSpec;
    origHazards: HazardFinding[];
    attachedFurnitureIds: string[];
    attachedHazardIds: string[];
  } | null>(null);

  const selectedRoom =
    floor.rooms.find((r) => r.id === selectedRoomId) ?? floor.rooms[0] ?? null;
  const visibleFurniture = useMemo(
    () => floor.furniture.filter((f) => !f.showOnlyInRemediation),
    [floor.furniture],
  );
  const selectedFurniture =
    visibleFurniture.find((f) => f.id === selectedFurnitureId) ?? visibleFurniture[0] ?? null;

  const effectiveDoorRoomA = floor.rooms.some((r) => r.id === doorRoomA)
    ? doorRoomA
    : floor.rooms[0]?.id ?? '';
  const effectiveDoorRoomB =
    floor.rooms.some((r) => r.id === doorRoomB) && doorRoomB !== effectiveDoorRoomA
      ? doorRoomB
      : floor.rooms.find((r) => r.id !== effectiveDoorRoomA)?.id ?? effectiveDoorRoomA;

  const doorPairs = useMemo(
    () => extractDoorPairsFromRoute(floor.rooms, floor.routeNodes, floor.routeEdges),
    [floor.rooms, floor.routeNodes, floor.routeEdges],
  );

  // Canvas view projection: cover floorBounds with generous margin so rooms can be dragged outward
  const svgW = 348;
  const svgH = 236;
  const computedViewBounds = useMemo<ViewProjection>(() => {
    const pad = 1.6;
    const minX = floor.floorBounds.minX - pad;
    const maxX = floor.floorBounds.maxX + pad;
    const minZ = floor.floorBounds.minZ - pad;
    const maxZ = floor.floorBounds.maxZ + pad;
    const spanX = Math.max(4, maxX - minX);
    const spanZ = Math.max(4, maxZ - minZ);
    const scale = Math.min((svgW - 16) / spanX, (svgH - 16) / spanZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    return { cx, cz, scale, minX, maxX, minZ, maxZ };
  }, [floor.floorBounds]);

  // Freeze projection while dragging so coordinate space never shifts under the cursor
  const viewBounds = frozenViewBounds ?? computedViewBounds;

  const toCanvas = (wx: number, wz: number, vb: ViewProjection = viewBounds): [number, number] => [
    svgW / 2 + (wx - vb.cx) * vb.scale,
    svgH / 2 + (wz - vb.cz) * vb.scale,
  ];

  const clientToWorld = (
    clientX: number,
    clientY: number,
    vb: ViewProjection = viewBounds,
  ): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / Math.max(1, rect.width)) * svgW;
    const sy = ((clientY - rect.top) / Math.max(1, rect.height)) * svgH;
    return [
      vb.cx + (sx - svgW / 2) / vb.scale,
      vb.cz + (sy - svgH / 2) / vb.scale,
    ];
  };

  const commitRoomUpdate = (
    roomId: string,
    updater: (r: RoomZone) => RoomZone,
    deltaX = 0,
    deltaZ = 0,
    baseFloor: FloorPlanSpec = floor,
    baseHazards: HazardFinding[] = hazards,
    attachedFIds?: string[],
    attachedHIds?: string[],
    snapOverlaps = false,
  ) => {
    const target = baseFloor.rooms.find((r) => r.id === roomId);
    if (!target) return;

    const nextRooms = baseFloor.rooms.map((r) => (r.id === roomId ? updater(r) : r));
    let nextFurniture = baseFloor.furniture;
    let nextHazards = baseHazards;

    if ((deltaX !== 0 || deltaZ !== 0) && moveContentsWithRoom) {
      const fSet = new Set(
        attachedFIds ??
          baseFloor.furniture
            .filter((f) => isPointInsideRoom(f.x, f.z, target))
            .map((f) => f.id),
      );
      nextFurniture = baseFloor.furniture.map((f) =>
        fSet.has(f.id)
          ? { ...f, x: Number((f.x + deltaX).toFixed(2)), z: Number((f.z + deltaZ).toFixed(2)) }
          : f,
      );

      const hSet = new Set(
        attachedHIds ??
          baseHazards
            .filter((h) => h.roomId === roomId || isPointInsideRoom(h.position[0], h.position[2], target))
            .map((h) => h.id),
      );
      nextHazards = baseHazards.map((h) =>
        hSet.has(h.id)
          ? {
              ...h,
              position: [
                Number((h.position[0] + deltaX).toFixed(2)),
                h.position[1],
                Number((h.position[2] + deltaZ).toFixed(2)),
              ],
            }
          : h,
      );
    }

    const rebuilt = rebuildFloorLayout(
      {
        ...baseFloor,
        rooms: nextRooms,
        furniture: nextFurniture,
      },
      snapOverlaps ? { snapOverlaps: true, anchorRoomId: roomId } : undefined,
    );

    let finalFurniture = rebuilt.furniture;
    let finalHazards = nextHazards;

    if (snapOverlaps && moveContentsWithRoom) {
      for (const preRoom of nextRooms) {
        const postRoom = rebuilt.rooms.find((r) => r.id === preRoom.id);
        if (!postRoom) continue;
        const sdx = Number((postRoom.bounds.x - preRoom.bounds.x).toFixed(2));
        const sdz = Number((postRoom.bounds.z - preRoom.bounds.z).toFixed(2));
        if (Math.abs(sdx) < 0.01 && Math.abs(sdz) < 0.01) continue;

        finalFurniture = finalFurniture.map((f) =>
          isPointInsideRoom(f.x, f.z, preRoom)
            ? { ...f, x: Number((f.x + sdx).toFixed(2)), z: Number((f.z + sdz).toFixed(2)) }
            : f,
        );
        finalHazards = finalHazards.map((h) =>
          h.roomId === preRoom.id || isPointInsideRoom(h.position[0], h.position[2], preRoom)
            ? {
                ...h,
                position: [
                  Number((h.position[0] + sdx).toFixed(2)),
                  h.position[1],
                  Number((h.position[2] + sdz).toFixed(2)),
                ],
              }
            : h,
        );
      }
    }

    onApplyFloorUpdate({ ...rebuilt, furniture: finalFurniture }, finalHazards);
  };

  const handleRoomResize = (dw: number, dd: number) => {
    if (!selectedRoom) return;
    commitRoomUpdate(
      selectedRoom.id,
      (r) => {
        const w = Math.max(1.25, Math.min(10, Number(snapToGrid(r.bounds.w + dw).toFixed(2))));
        const d = Math.max(1.25, Math.min(10, Number(snapToGrid(r.bounds.d + dd).toFixed(2))));
        return { ...r, bounds: { ...r.bounds, w, d } };
      },
      0,
      0,
      floor,
      hazards,
      undefined,
      undefined,
      true,
    );
  };

  const handleRoomMove = (dx: number, dz: number) => {
    if (!selectedRoom) return;
    commitRoomUpdate(
      selectedRoom.id,
      (r) => ({
        ...r,
        bounds: {
          ...r.bounds,
          x: Number(snapToGrid(r.bounds.x + dx).toFixed(2)),
          z: Number(snapToGrid(r.bounds.z + dz).toFixed(2)),
        },
      }),
      dx,
      dz,
      floor,
      hazards,
      undefined,
      undefined,
      true,
    );
  };

  const handleAddRoom = () => {
    const ref = selectedRoom ?? floor.rooms[floor.rooms.length - 1];
    idSeqRef.current += 1;
    const newId = `ruang_${Date.now().toString(36).slice(-4)}_${idSeqRef.current}`;
    const newW = 2.5;
    const newD = ref ? ref.bounds.d : 2.5;
    // Place outside right edge of existing rooms so newly added room never overlaps existing rooms
    const newX = snapToGrid(floor.floorBounds.maxX + newW / 2);
    const newZ = ref ? ref.bounds.z : 0;

    const nextRoom: RoomZone = {
      id: newId,
      label: `Ruang ${floor.rooms.length + 1}`,
      category: 'hallway',
      floorStyle: 'tile',
      bounds: { x: newX, z: newZ, w: newW, d: newD },
      labelPos: [newX, 1.35, newZ],
    };
    const nextRooms = [...floor.rooms, nextRoom];
    const existingPairs = extractDoorPairsFromRoute(floor.rooms, floor.routeNodes, floor.routeEdges);
    const closestNeighbor = floor.rooms.reduce<RoomZone | null>((best, cur) => {
      if (!best) return cur;
      const dCur = Math.hypot(cur.bounds.x - newX, cur.bounds.z - newZ);
      const dBest = Math.hypot(best.bounds.x - newX, best.bounds.z - newZ);
      return dCur < dBest ? cur : best;
    }, null);
    const nextPairs: Array<[string, string]> = closestNeighbor
      ? [...existingPairs, [closestNeighbor.id, newId]]
      : existingPairs;
    const rebuilt = rebuildFloorLayout(
      { ...floor, rooms: nextRooms },
      { doorPairs: nextPairs },
    );
    onApplyFloorUpdate(rebuilt);
    setSelectedRoomId(newId);
    setMode('rooms');
  };

  const handleDeleteRoom = () => {
    if (!selectedRoom || floor.rooms.length <= 1) return;
    const nextRooms = floor.rooms.filter((r) => r.id !== selectedRoom.id);
    const nextFurniture = floor.furniture.filter((f) => !isPointInsideRoom(f.x, f.z, selectedRoom));
    const nextHazards = hazards.filter(
      (h) => h.roomId !== selectedRoom.id && !isPointInsideRoom(h.position[0], h.position[2], selectedRoom),
    );
    const nextPairs = doorPairs.filter(([a, b]) => a !== selectedRoom.id && b !== selectedRoom.id);
    const rebuilt = rebuildFloorLayout(
      { ...floor, rooms: nextRooms, furniture: nextFurniture },
      { doorPairs: nextPairs.length > 0 || nextRooms.length <= 1 ? nextPairs : undefined },
    );
    onApplyFloorUpdate(rebuilt, nextHazards);
    setSelectedRoomId(nextRooms[0]?.id ?? '');
  };

  const commitFurnitureUpdate = (
    itemId: string,
    updater: (f: FurnitureItem) => FurnitureItem,
    baseFloor: FloorPlanSpec = floor,
  ) => {
    const nextFurniture = baseFloor.furniture.map((f) => (f.id === itemId ? updater(f) : f));
    onApplyFloorUpdate({ ...baseFloor, furniture: nextFurniture });
  };

  const handleAddFurniture = () => {
    const anchor = selectedRoom ?? floor.rooms[0];
    idSeqRef.current += 1;
    const newId = `furn_${Date.now().toString(36).slice(-4)}_${idSeqRef.current}`;
    const nextItem: FurnitureItem = {
      id: newId,
      kind: 'table',
      x: Number((anchor?.bounds.x ?? 0).toFixed(2)),
      z: Number((anchor?.bounds.z ?? 0).toFixed(2)),
      w: 1.1,
      d: 0.7,
    };
    onApplyFloorUpdate({ ...floor, furniture: [...floor.furniture, nextItem] });
    setSelectedFurnitureId(newId);
    setMode('furniture');
  };

  const handleDeleteFurniture = () => {
    if (!selectedFurniture) return;
    const nextList = floor.furniture.filter((f) => f.id !== selectedFurniture.id);
    onApplyFloorUpdate({ ...floor, furniture: nextList });
    const fallback = nextList.find((f) => !f.showOnlyInRemediation);
    setSelectedFurnitureId(fallback?.id ?? '');
  };

  const handleToggleDoorPair = (idA: string, idB: string) => {
    if (!idA || !idB || idA === idB) return;
    const exists = doorPairs.some(
      ([a, b]) => (a === idA && b === idB) || (a === idB && b === idA),
    );
    const nextPairs = exists
      ? doorPairs.filter(([a, b]) => !((a === idA && b === idB) || (a === idB && b === idA)))
      : [...doorPairs, [idA, idB] as [string, string]];
    const rebuilt = rebuildFloorLayout(floor, { doorPairs: nextPairs });
    onApplyFloorUpdate(rebuilt);
  };

  const handleAutoDoors = () => {
    const autoRoute = buildRouteGraphForRooms(floor.rooms);
    const autoPairs = extractDoorPairsFromRoute(floor.rooms, autoRoute.nodes, autoRoute.edges);
    const rebuilt = rebuildFloorLayout(floor, { doorPairs: autoPairs });
    onApplyFloorUpdate(rebuilt);
  };

  const handleSnapClean = () => {
    const rebuilt = rebuildFloorLayout(floor, { snapOverlaps: true });
    let finalFurniture = rebuilt.furniture;
    let finalHazards = hazards;

    if (moveContentsWithRoom) {
      for (const preRoom of floor.rooms) {
        const postRoom = rebuilt.rooms.find((r) => r.id === preRoom.id);
        if (!postRoom) continue;
        const sdx = Number((postRoom.bounds.x - preRoom.bounds.x).toFixed(2));
        const sdz = Number((postRoom.bounds.z - preRoom.bounds.z).toFixed(2));
        if (Math.abs(sdx) < 0.01 && Math.abs(sdz) < 0.01) continue;

        finalFurniture = finalFurniture.map((f) =>
          isPointInsideRoom(f.x, f.z, preRoom)
            ? { ...f, x: Number((f.x + sdx).toFixed(2)), z: Number((f.z + sdz).toFixed(2)) }
            : f,
        );
        finalHazards = finalHazards.map((h) =>
          h.roomId === preRoom.id || isPointInsideRoom(h.position[0], h.position[2], preRoom)
            ? {
                ...h,
                position: [
                  Number((h.position[0] + sdx).toFixed(2)),
                  h.position[1],
                  Number((h.position[2] + sdz).toFixed(2)),
                ],
              }
            : h,
        );
      }
    }

    onApplyFloorUpdate({ ...rebuilt, furniture: finalFurniture }, finalHazards);
  };

  const applyDragAtClient = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const [wx, wz] = clientToWorld(clientX, clientY, drag.viewAtStart);
    const rawDx = wx - drag.startWorldX;
    const rawDz = wz - drag.startWorldZ;

    if (drag.kind === 'room') {
      const origRoom = drag.origFloor.rooms.find((r) => r.id === drag.id);
      if (!origRoom) return;
      const snapped = computeMagneticRoomSnap(
        drag.id,
        origRoom.bounds.x + rawDx,
        origRoom.bounds.z + rawDz,
        origRoom.bounds.w,
        origRoom.bounds.d,
        drag.origFloor.rooms,
      );
      setSnapGuides({ x: snapped.guideX, z: snapped.guideZ });
      const dx = Number((snapped.x - origRoom.bounds.x).toFixed(2));
      const dz = Number((snapped.z - origRoom.bounds.z).toFixed(2));
      commitRoomUpdate(
        drag.id,
        (r) => ({ ...r, bounds: { ...r.bounds, x: snapped.x, z: snapped.z } }),
        dx,
        dz,
        drag.origFloor,
        drag.origHazards,
        drag.attachedFurnitureIds,
        drag.attachedHazardIds,
      );
    } else {
      const origItem = drag.origFloor.furniture.find((f) => f.id === drag.id);
      if (!origItem) return;
      const nx = Number(snapToGrid(origItem.x + rawDx, 0.05).toFixed(2));
      const nz = Number(snapToGrid(origItem.z + rawDz, 0.05).toFixed(2));
      commitFurnitureUpdate(
        drag.id,
        (f) => ({ ...f, x: nx, z: nz }),
        drag.origFloor,
      );
    }
  };

  const handleCanvasPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    pendingDragClientRef.current = { x: ev.clientX, y: ev.clientY };
    if (dragRafRef.current !== null) return;
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null;
      const pt = pendingDragClientRef.current;
      if (pt) applyDragAtClient(pt.x, pt.y);
    });
  };

  const endDrag = () => {
    if (dragRafRef.current !== null) {
      window.cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const pendingPt = pendingDragClientRef.current;
    if (pendingPt && dragRef.current) {
      applyDragAtClient(pendingPt.x, pendingPt.y);
    }
    pendingDragClientRef.current = null;
    const drag = dragRef.current;
    if (drag) {
      try {
        svgRef.current?.releasePointerCapture?.(drag.pointerId);
      } catch {
        // Ignore if not captured
      }
    }
    dragRef.current = null;
    setFrozenViewBounds(null);
    setSnapGuides({});
  };

  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const step = 1.0;
    for (let gx = Math.ceil(viewBounds.minX); gx <= Math.floor(viewBounds.maxX); gx += step) {
      const [sx] = toCanvas(gx, 0);
      lines.push({ x1: sx, y1: 0, x2: sx, y2: svgH });
    }
    for (let gz = Math.ceil(viewBounds.minZ); gz <= Math.floor(viewBounds.maxZ); gz += step) {
      const [, sy] = toCanvas(0, gz);
      lines.push({ x1: 0, y1: sy, x2: svgW, y2: sy });
    }
    return lines;
  }, [viewBounds]);

  return (
    <section
      className="panel-card layout-editor-card"
      data-testid="layout-editor-panel"
      aria-label="Editor Layout Manual"
    >
      <div className="card-header-row">
        <div>
          <h2 className="card-title">Atur Layout Manual</h2>
          <p className="card-sub">
            Seret di denah 2D atau ubah ukuran — 3D Dollhouse langsung ikut berubah
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="btn-chip"
            data-testid="btn-layout-snap"
            title="Rapikan ruangan agar dinding menempel rapat tanpa tumpang tindih"
            onClick={handleSnapClean}
          >
            <Magnet size={13} />
            <span>Snap Rapi</span>
          </button>
          <button
            type="button"
            className="btn-chip"
            data-testid="btn-layout-close"
            onClick={onClose}
            aria-label="Tutup Editor Layout"
          >
            <X size={13} />
            <span>Selesai</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="layout-mode-tabs" role="tablist" aria-label="Objek yang diedit">
        <button
          type="button"
          data-testid="layout-mode-rooms"
          className={`btn-chip ${mode === 'rooms' ? 'active' : ''}`}
          onClick={() => setMode('rooms')}
        >
          <Layers size={13} />
          <span>Ruangan ({floor.rooms.length})</span>
        </button>
        <button
          type="button"
          data-testid="layout-mode-furniture"
          className={`btn-chip ${mode === 'furniture' ? 'active' : ''}`}
          onClick={() => setMode('furniture')}
        >
          <Sofa size={13} />
          <span>Furnitur ({visibleFurniture.length})</span>
        </button>
        <button
          type="button"
          data-testid="layout-mode-doors"
          className={`btn-chip ${mode === 'doors' ? 'active' : ''}`}
          onClick={() => {
            setPendingDoorRoomId(null);
            setMode('doors');
          }}
        >
          <DoorOpen size={13} />
          <span>Pintu ({doorPairs.length})</span>
        </button>
      </div>

      {/* Interactive 2D Floorplan Drag & Snap Canvas */}
      <div className="layout-svg-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="layout-svg"
          data-testid="layout-editor-svg"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {gridLines.map((l, idx) => (
            <line
              key={idx}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="rgba(13,37,63,0.08)"
              strokeWidth={1}
            />
          ))}

          {/* Rooms */}
          {floor.rooms.map((room) => {
            const [cx, cy] = toCanvas(room.bounds.x, room.bounds.z);
            const rw = room.bounds.w * viewBounds.scale;
            const rd = room.bounds.d * viewBounds.scale;
            const isSelected =
              (mode === 'rooms' && selectedRoom?.id === room.id) ||
              (mode === 'doors' && pendingDoorRoomId === room.id);

            return (
              <g
                key={room.id}
                style={{ cursor: mode === 'rooms' ? 'grab' : mode === 'doors' ? 'pointer' : 'default' }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  if (mode === 'doors') {
                    if (!pendingDoorRoomId) {
                      setPendingDoorRoomId(room.id);
                    } else if (pendingDoorRoomId === room.id) {
                      setPendingDoorRoomId(null);
                    } else {
                      handleToggleDoorPair(pendingDoorRoomId, room.id);
                      setPendingDoorRoomId(null);
                    }
                    return;
                  }
                  setSelectedRoomId(room.id);
                  if (mode === 'rooms') {
                    const vb = computedViewBounds;
                    const [wx, wz] = clientToWorld(ev.clientX, ev.clientY, vb);
                    setFrozenViewBounds(vb);
                    try {
                      svgRef.current?.setPointerCapture?.(ev.pointerId);
                    } catch {
                      // Ignore in synthetic tests without pointerId
                    }
                    dragRef.current = {
                      kind: 'room',
                      id: room.id,
                      pointerId: ev.pointerId,
                      startWorldX: wx,
                      startWorldZ: wz,
                      viewAtStart: vb,
                      origFloor: floor,
                      origHazards: hazards,
                      attachedFurnitureIds: floor.furniture
                        .filter((f) => isPointInsideRoom(f.x, f.z, room))
                        .map((f) => f.id),
                      attachedHazardIds: hazards
                        .filter(
                          (h) =>
                            h.roomId === room.id ||
                            isPointInsideRoom(h.position[0], h.position[2], room),
                        )
                        .map((h) => h.id),
                    };
                  }
                }}
              >
                <rect
                  x={cx - rw / 2}
                  y={cy - rd / 2}
                  width={rw}
                  height={rd}
                  rx={4}
                  fill={room.floorStyle === 'tile' ? '#EFE8DD' : '#E7CFAF'}
                  stroke={isSelected ? '#F4721E' : '#8A7B6A'}
                  strokeWidth={isSelected ? 2.4 : 1.2}
                />
                <text
                  x={cx}
                  y={cy - 4}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill="#0D253F"
                  pointerEvents="none"
                >
                  {room.label.slice(0, 16)}
                </text>
                <text
                  x={cx}
                  y={cy + 8}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="600"
                  fill="#4D6080"
                  pointerEvents="none"
                >
                  {room.bounds.w.toFixed(2)}×{room.bounds.d.toFixed(2)}m
                </text>
              </g>
            );
          })}

          {/* Walls preview (shows carved doorways!) */}
          {floor.walls.map((w, idx) => {
            const [cx, cy] = toCanvas(w.x, w.z);
            const ww = Math.max(2, w.w * viewBounds.scale);
            const wd = Math.max(2, w.d * viewBounds.scale);
            return (
              <rect
                key={idx}
                x={cx - ww / 2}
                y={cy - wd / 2}
                width={ww}
                height={wd}
                fill="#0D253F"
                opacity={0.78}
                pointerEvents="none"
              />
            );
          })}

          {/* Doorway connection markers */}
          {doorPairs.map(([idA, idB]) => {
            const ra = floor.rooms.find((r) => r.id === idA);
            const rb = floor.rooms.find((r) => r.id === idB);
            if (!ra || !rb) return null;
            const [ax, ay] = toCanvas(ra.bounds.x, ra.bounds.z);
            const [bx, by] = toCanvas(rb.bounds.x, rb.bounds.z);
            const wp = floor.routeNodes.find(
              (n) => n.id === `wp_${idA}_${idB}` || n.id === `wp_${idB}_${idA}`,
            );
            const [wx, wy] = wp ? toCanvas(wp.x, wp.z) : [(ax + bx) / 2, (ay + by) / 2];
            return (
              <g key={`${idA}-${idB}`} pointerEvents="none">
                <line
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke="#059669"
                  strokeWidth={1.6}
                  strokeDasharray="3 3"
                  opacity={mode === 'doors' ? 0.95 : 0.45}
                />
                <circle
                  cx={wx}
                  cy={wy}
                  r={mode === 'doors' ? 4.5 : 3}
                  fill="#10B981"
                  stroke="#FFFFFF"
                  strokeWidth={1.2}
                />
              </g>
            );
          })}

          {/* Furniture items */}
          {visibleFurniture.map((f) => {
            const [cx, cy] = toCanvas(f.x, f.z);
            const fw = Math.max(6, f.w * viewBounds.scale);
            const fd = Math.max(6, f.d * viewBounds.scale);
            const rotDeg = ((f.rotY ?? 0) * 180) / Math.PI;
            const isSelected = mode === 'furniture' && selectedFurniture?.id === f.id;
            return (
              <g
                key={f.id}
                transform={`translate(${cx}, ${cy}) rotate(${-rotDeg})`}
                style={{ cursor: mode === 'furniture' ? 'grab' : 'pointer' }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  setSelectedFurnitureId(f.id);
                  if (mode !== 'furniture') {
                    setMode('furniture');
                    return;
                  }
                  const vb = computedViewBounds;
                  const [wx, wz] = clientToWorld(ev.clientX, ev.clientY, vb);
                  setFrozenViewBounds(vb);
                  try {
                    svgRef.current?.setPointerCapture?.(ev.pointerId);
                  } catch {
                    // Ignore in synthetic tests
                  }
                  dragRef.current = {
                    kind: 'furniture',
                    id: f.id,
                    pointerId: ev.pointerId,
                    startWorldX: wx,
                    startWorldZ: wz,
                    viewAtStart: vb,
                    origFloor: floor,
                    origHazards: hazards,
                    attachedFurnitureIds: [],
                    attachedHazardIds: [],
                  };
                }}
              >
                <rect
                  x={-fw / 2}
                  y={-fd / 2}
                  width={fw}
                  height={fd}
                  rx={2.5}
                  fill={isSelected ? 'rgba(244, 114, 30, 0.38)' : 'rgba(77, 96, 128, 0.34)'}
                  stroke={isSelected ? '#F4721E' : '#2E4360'}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {/* Front facing edge marker */}
                <line
                  x1={-fw / 3}
                  y1={fd / 2 - 1.5}
                  x2={fw / 3}
                  y2={fd / 2 - 1.5}
                  stroke={isSelected ? '#9A3412' : '#0D253F'}
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* Magnetic Snap Alignment Guides */}
          {snapGuides.x !== undefined && (
            <line
              x1={toCanvas(snapGuides.x, 0)[0]}
              y1={0}
              x2={toCanvas(snapGuides.x, 0)[0]}
              y2={svgH}
              stroke="#06B6D4"
              strokeWidth={1.6}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
          {snapGuides.z !== undefined && (
            <line
              x1={0}
              y1={toCanvas(0, snapGuides.z)[1]}
              x2={svgW}
              y2={toCanvas(0, snapGuides.z)[1]}
              stroke="#06B6D4"
              strokeWidth={1.6}
              strokeDasharray="4 3"
              pointerEvents="none"
            />
          )}
        </svg>
        <div className="layout-svg-hint">
          {mode === 'rooms' && 'Seret kotak ruangan untuk geser posisi • Kotak terluar = dinding & celah pintu'}
          {mode === 'furniture' && 'Klik & seret objek furnitur • Garis tebal menandakan sisi hadap depan'}
          {mode === 'doors' &&
            (pendingDoorRoomId
              ? 'Klik ruangan kedua di denah untuk membuka/menutup pintu penghubung'
              : 'Klik 2 ruangan berurutan di denah untuk menyambung atau menutup pintu')}
        </div>
      </div>

      {/* Inspector: Rooms */}
      {mode === 'rooms' && selectedRoom && (
        <div className="layout-inspector">
          <div className="layout-inspector-top">
            <label className="layout-check">
              <input
                type="checkbox"
                checked={moveContentsWithRoom}
                onChange={(e) => setMoveContentsWithRoom(e.target.checked)}
              />
              <span>Geser furnitur &amp; pin ikut ruangan</span>
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="btn-chip"
                data-testid="btn-add-room"
                onClick={handleAddRoom}
              >
                <Plus size={12} />
                <span>Ruang</span>
              </button>
              {floor.rooms.length > 1 && (
                <button
                  type="button"
                  className="btn-chip"
                  data-testid="btn-delete-room"
                  onClick={handleDeleteRoom}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="layout-form-grid">
            <div className="form-group compact">
              <label htmlFor="edit-room-label">Nama Ruangan</label>
              <input
                id="edit-room-label"
                data-testid="input-room-label"
                type="text"
                value={selectedRoom.label}
                onChange={(e) =>
                  commitRoomUpdate(selectedRoom.id, (r) => ({ ...r, label: e.target.value }))
                }
              />
            </div>

            <div className="form-group compact">
              <label htmlFor="edit-room-cat">Tipe &amp; Lantai</label>
              <select
                id="edit-room-cat"
                value={selectedRoom.category}
                onChange={(e) => {
                  const cat = e.target.value as RoomCategory;
                  commitRoomUpdate(selectedRoom.id, (r) => ({
                    ...r,
                    category: cat,
                    floorStyle: cat === 'bathroom' || cat === 'kitchen' || cat === 'hallway' ? 'tile' : 'wood',
                  }));
                }}
              >
                {ROOM_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="layout-dim-row">
            <div className="layout-stepper">
              <span>Lebar (X)</span>
              <div className="stepper-btns">
                <button
                  type="button"
                  data-testid="btn-room-w-dec"
                  onClick={() => handleRoomResize(-0.25, 0)}
                >
                  −
                </button>
                <strong>{selectedRoom.bounds.w.toFixed(2)} m</strong>
                <button
                  type="button"
                  data-testid="btn-room-w-inc"
                  onClick={() => handleRoomResize(0.25, 0)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="layout-stepper">
              <span>Panjang (Z)</span>
              <div className="stepper-btns">
                <button
                  type="button"
                  data-testid="btn-room-d-dec"
                  onClick={() => handleRoomResize(0, -0.25)}
                >
                  −
                </button>
                <strong>{selectedRoom.bounds.d.toFixed(2)} m</strong>
                <button
                  type="button"
                  data-testid="btn-room-d-inc"
                  onClick={() => handleRoomResize(0, 0.25)}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className="layout-nudge-row">
            <span>Geser posisi (±0.25m):</span>
            <div className="nudge-btns">
              <button type="button" title="Geser Kiri" onClick={() => handleRoomMove(-0.25, 0)}>
                <ArrowLeft size={13} />
              </button>
              <button type="button" title="Geser Atas/Belakang" onClick={() => handleRoomMove(0, -0.25)}>
                <ArrowUp size={13} />
              </button>
              <button type="button" title="Geser Bawah/Depan" onClick={() => handleRoomMove(0, 0.25)}>
                <ArrowDown size={13} />
              </button>
              <button type="button" title="Geser Kanan" onClick={() => handleRoomMove(0.25, 0)}>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspector: Furniture */}
      {mode === 'furniture' && (
        <div className="layout-inspector">
          <div className="layout-inspector-top">
            <select
              aria-label="Pilih Objek Furnitur"
              value={selectedFurniture?.id ?? ''}
              onChange={(e) => setSelectedFurnitureId(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            >
              {visibleFurniture.map((f, idx) => (
                <option key={f.id} value={f.id}>
                  #{idx + 1} {FURNITURE_KINDS.find((k) => k.value === f.kind)?.label ?? f.kind} ({f.x.toFixed(1)}, {f.z.toFixed(1)})
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-chip"
              data-testid="btn-add-furniture"
              onClick={handleAddFurniture}
            >
              <Plus size={12} />
              <span>Objek</span>
            </button>
            {selectedFurniture && (
              <button
                type="button"
                className="btn-chip"
                data-testid="btn-delete-furniture"
                onClick={handleDeleteFurniture}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>

          {selectedFurniture && (
            <>
              <div className="layout-form-grid">
                <div className="form-group compact">
                  <label htmlFor="edit-furn-kind">Jenis Objek</label>
                  <select
                    id="edit-furn-kind"
                    value={selectedFurniture.kind}
                    onChange={(e) => {
                      const nextKind = e.target.value as FurnitureKind;
                      const preset = FURNITURE_KINDS.find((k) => k.value === nextKind);
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        kind: nextKind,
                        w: preset?.w ?? f.w,
                        d: preset?.d ?? f.d,
                        hideInRemediation: nextKind === 'cable' || nextKind === 'rug',
                      }));
                    }}
                  >
                    {FURNITURE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group compact">
                  <label>Arah Hadap</label>
                  <button
                    type="button"
                    className="btn-secondary"
                    data-testid="btn-rotate-furniture"
                    style={{ width: '100%', justifyContent: 'center', height: '34px' }}
                    onClick={() =>
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        rotY: Number((((f.rotY ?? 0) + Math.PI / 2) % (Math.PI * 2)).toFixed(4)),
                      }))
                    }
                  >
                    <RotateCw size={13} />
                    <span>Putar 90°</span>
                  </button>
                </div>
              </div>

              <div className="layout-dim-row">
                <div className="layout-stepper">
                  <span>Lebar</span>
                  <div className="stepper-btns">
                    <button
                      type="button"
                      onClick={() =>
                        commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                          ...f,
                          w: Math.max(0.2, Number((f.w - 0.15).toFixed(2))),
                        }))
                      }
                    >
                      −
                    </button>
                    <strong>{selectedFurniture.w.toFixed(2)} m</strong>
                    <button
                      type="button"
                      onClick={() =>
                        commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                          ...f,
                          w: Math.min(4.5, Number((f.w + 0.15).toFixed(2))),
                        }))
                      }
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="layout-stepper">
                  <span>Panjang</span>
                  <div className="stepper-btns">
                    <button
                      type="button"
                      onClick={() =>
                        commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                          ...f,
                          d: Math.max(0.2, Number((f.d - 0.15).toFixed(2))),
                        }))
                      }
                    >
                      −
                    </button>
                    <strong>{selectedFurniture.d.toFixed(2)} m</strong>
                    <button
                      type="button"
                      onClick={() =>
                        commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                          ...f,
                          d: Math.min(4.5, Number((f.d + 0.15).toFixed(2))),
                        }))
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="layout-nudge-row">
                <span>Geser posisi (±0.20m):</span>
                <div className="nudge-btns">
                  <button
                    type="button"
                    onClick={() =>
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        x: Number((f.x - 0.2).toFixed(2)),
                      }))
                    }
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        z: Number((f.z - 0.2).toFixed(2)),
                      }))
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        z: Number((f.z + 0.2).toFixed(2)),
                      }))
                    }
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      commitFurnitureUpdate(selectedFurniture.id, (f) => ({
                        ...f,
                        x: Number((f.x + 0.2).toFixed(2)),
                      }))
                    }
                  >
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Inspector: Doors */}
      {mode === 'doors' && (
        <div className="layout-inspector">
          <div className="layout-form-grid">
            <div className="form-group compact">
              <label htmlFor="door-room-a">Ruangan 1</label>
              <select
                id="door-room-a"
                value={effectiveDoorRoomA}
                onChange={(e) => setDoorRoomA(e.target.value)}
              >
                {floor.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group compact">
              <label htmlFor="door-room-b">Ruangan 2</label>
              <select
                id="door-room-b"
                value={effectiveDoorRoomB}
                onChange={(e) => setDoorRoomB(e.target.value)}
              >
                {floor.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn-secondary"
              data-testid="btn-toggle-door"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={!effectiveDoorRoomA || !effectiveDoorRoomB || effectiveDoorRoomA === effectiveDoorRoomB}
              onClick={() => handleToggleDoorPair(effectiveDoorRoomA, effectiveDoorRoomB)}
            >
              <DoorOpen size={13} />
              <span>Buka / Tutup Pintu</span>
            </button>
            <button
              type="button"
              className="btn-chip"
              data-testid="btn-auto-doors"
              onClick={handleAutoDoors}
            >
              Auto Pintu
            </button>
          </div>

          <div className="door-pairs-list">
            {doorPairs.length === 0 ? (
              <span style={{ fontSize: '11.5px', color: 'var(--slate)' }}>
                Belum ada pintu penghubung antar ruangan.
              </span>
            ) : (
              doorPairs.map(([a, b]) => {
                const labelA = floor.rooms.find((r) => r.id === a)?.label ?? a;
                const labelB = floor.rooms.find((r) => r.id === b)?.label ?? b;
                return (
                  <div key={`${a}-${b}`} className="door-pair-chip">
                    <span>
                      {labelA} ↔ {labelB}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleDoorPair(a, b)}
                      title="Tutup pintu ini"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </section>
  );
}
