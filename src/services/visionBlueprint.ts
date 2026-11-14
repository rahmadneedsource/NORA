import type {
  FloorPlanSpec,
  FurnitureItem,
  FurnitureKind,
  HazardFinding,
  HouseBlueprint,
  RoomCategory,
  RoomZone,
  RouteEdge,
  RouteNode,
  SeverityLevel,
  SteadiPillar,
  WallSegment,
} from '../data/blueprints';
import type { KeyframeSample } from '../utils/videoFrames';
import type { DepthFrameSummary } from '../utils/depthEstimator';
import {
  buildRouteGraphForRooms,
  carveDoorwaysInWalls,
  snapRoomsToManhattanGrid,
  synthesizePerimeterWalls,
} from '../utils/floorGeometry';

export type VisionProvider = 'gemini' | 'openai' | 'demo';
export type ScanInputKind = 'video' | 'photos' | 'floorplan2d';

export interface VisionBlueprintResult {
  providerUsed: VisionProvider;
  modelUsed?: string;
  summary: string;
  blueprint: HouseBlueprint;
  isFallbackDemo: boolean;
}

interface RawAiRoom {
  id?: string;
  label?: string;
  category?: string;
  floorStyle?: string;
  x?: number;
  z?: number;
  w?: number;
  d?: number;
}

interface RawAiWall {
  x?: number;
  z?: number;
  w?: number;
  d?: number;
  h?: number;
}

interface RawAiFurniture {
  kind?: string;
  roomId?: string;
  wallSide?: string;
  x?: number;
  z?: number;
  w?: number;
  d?: number;
}

interface RawAiHazard {
  title?: string;
  pillar?: string;
  severity?: string;
  roomId?: string;
  x?: number;
  z?: number;
  clinicalRisk?: string;
  observation?: string;
  remediation?: string;
  evidenceFrameIndex?: number;
}

interface RawAiBlueprintResponse {
  summary?: string;
  floorLabel?: string;
  rooms?: RawAiRoom[];
  walls?: RawAiWall[];
  furniture?: RawAiFurniture[];
  hazards?: RawAiHazard[];
  routeNodes?: RouteNode[];
  routeEdges?: RouteEdge[];
}

const VALID_PILLARS: SteadiPillar[] = ['tripping', 'ergonomic', 'lighting', 'mobility'];
const VALID_CATEGORIES: RoomCategory[] = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living',
  'hallway',
  'entrance',
  'balcony',
];
const VALID_FURNITURE: FurnitureKind[] = [
  'bed',
  'sofa',
  'table',
  'toilet',
  'sink',
  'counter',
  'cabinet',
  'rug',
  'plant',
  'cable',
  'grabbar',
  'stairs',
];

function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePillar(p: string | undefined): SteadiPillar {
  const lower = (p ?? '').toLowerCase();
  if (lower.includes('trip') || lower.includes('slip') || lower.includes('kabel')) return 'tripping';
  if (lower.includes('ergo') || lower.includes('support') || lower.includes('grab')) return 'ergonomic';
  if (lower.includes('light') || lower.includes('visual') || lower.includes('gelap')) return 'lighting';
  if (lower.includes('mobil') || lower.includes('clear') || lower.includes('sempit')) return 'mobility';
  return VALID_PILLARS.includes(lower as SteadiPillar) ? (lower as SteadiPillar) : 'tripping';
}

function normalizeSeverity(s: string | undefined): SeverityLevel {
  const lower = (s ?? '').toLowerCase();
  return lower.includes('crit') || lower.includes('kritis') ? 'critical' : 'moderate';
}

function normalizeCategory(c: string | undefined): RoomCategory {
  const lower = (c ?? '').toLowerCase();
  if (lower.includes('bed') || lower.includes('tidur')) return 'bedroom';
  if (lower.includes('bath') || lower.includes('toilet') || lower.includes('wc')) return 'bathroom';
  if (lower.includes('kit') || lower.includes('dapur') || lower.includes('pantry')) return 'kitchen';
  if (lower.includes('liv') || lower.includes('tamu') || lower.includes('keluarga')) return 'living';
  if (lower.includes('entr') || lower.includes('pintu')) return 'entrance';
  if (lower.includes('balc') || lower.includes('teras')) return 'balcony';
  return VALID_CATEGORIES.includes(lower as RoomCategory) ? (lower as RoomCategory) : 'hallway';
}

function normalizeFurnitureKind(k: string | undefined): FurnitureKind {
  const lower = (k ?? '').toLowerCase();
  if (lower.includes('bed') || lower.includes('kasur')) return 'bed';
  if (lower.includes('toilet') || lower.includes('kloset')) return 'toilet';
  if (lower.includes('sink') || lower.includes('wastafel')) return 'sink';
  if (lower.includes('count') || lower.includes('dapur')) return 'counter';
  if (lower.includes('sofa') || lower.includes('kursi')) return 'sofa';
  if (lower.includes('table') || lower.includes('meja')) return 'table';
  if (lower.includes('cab') || lower.includes('lemari') || lower.includes('rak')) return 'cabinet';
  if (lower.includes('rug') || lower.includes('keset') || lower.includes('karpet')) return 'rug';
  if (lower.includes('cable') || lower.includes('kabel')) return 'cable';
  if (lower.includes('plant') || lower.includes('tanaman')) return 'plant';
  if (lower.includes('grab')) return 'grabbar';
  if (lower.includes('stair') || lower.includes('tangga')) return 'stairs';
  return VALID_FURNITURE.includes(lower as FurnitureKind) ? (lower as FurnitureKind) : 'table';
}

function normalizeAiResponseToBlueprint(
  parsed: RawAiBlueprintResponse,
  areaName: string,
  frames: KeyframeSample[],
  depthProfiles: DepthFrameSummary[] = [],
  hasUserSizeHint = false,
): HouseBlueprint {
  const rawRooms = Array.isArray(parsed.rooms) && parsed.rooms.length > 0 ? parsed.rooms : [];

  const rawNormalizedRooms: RoomZone[] =
    rawRooms.length > 0
      ? rawRooms.slice(0, 8).map((r, i) => {
          const category = normalizeCategory(r.category ?? r.label);
          const x = clampNum(r.x, (i % 2 === 0 ? -2.4 : 2.4), -6, 6);
          const z = clampNum(r.z, Math.floor(i / 2) * 3.8 - 2.2, -6, 6);
          const w = clampNum(r.w, 4.2, 2.2, 7.5);
          const d = clampNum(r.d, 4.0, 2.2, 7.5);
          const id = (r.id || `room_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, '_');
          return {
            id,
            label: (r.label || `Ruangan ${i + 1}`).trim(),
            category,
            floorStyle: category === 'bathroom' || r.floorStyle === 'tile' ? 'tile' : 'wood',
            bounds: { x, z, w, d },
            labelPos: [x, 1.35, z],
          };
        })
      : [
          {
            id: 'kamar_utama',
            label: 'Kamar Utama',
            category: 'bedroom',
            floorStyle: 'wood',
            bounds: { x: -2.5, z: 0.4, w: 4.8, d: 7.2 },
            labelPos: [-2.5, 1.35, 0.4],
          },
          {
            id: 'kamar_mandi',
            label: 'Toilet',
            category: 'bathroom',
            floorStyle: 'tile',
            bounds: { x: 2.5, z: -1.8, w: 4.4, d: 3.8 },
            labelPos: [2.5, 1.35, -1.8],
          },
          {
            id: 'area_dapur',
            label: 'Dapur & Jalur',
            category: 'kitchen',
            floorStyle: 'wood',
            bounds: { x: 2.5, z: 2.2, w: 4.4, d: 3.8 },
            labelPos: [2.5, 1.35, 2.2],
          },
        ];

  const rooms = snapRoomsToManhattanGrid(rawNormalizedRooms, depthProfiles, hasUserSizeHint);
  const { walls: synthesizedWalls, bounds } = synthesizePerimeterWalls(rooms);
  // Always use room-derived flush architectural walls when AI provides rooms, avoiding overhanging LLM wall artifacts
  const rawWalls: WallSegment[] =
    rawRooms.length > 0
      ? synthesizedWalls
      : Array.isArray(parsed.walls) && parsed.walls.length >= 3
        ? parsed.walls.map((w) => ({
            x: clampNum(w.x, 0, -8, 8),
            z: clampNum(w.z, 0, -8, 8),
            w: clampNum(w.w, 2.0, 0.16, 14),
            d: clampNum(w.d, 0.24, 0.16, 14),
            h: clampNum(w.h, 2.0, 0.8, 2.5),
          }))
        : synthesizedWalls;

  const furniture: FurnitureItem[] = (parsed.furniture ?? []).slice(0, 18).map((f, idx) => {
    const kind = normalizeFurnitureKind(f.kind);
    const fw = clampNum(f.w, kind === 'toilet' ? 0.65 : kind === 'sink' ? 0.75 : 1.35, 0.2, 4.5);
    const fd = clampNum(f.d, kind === 'cable' ? 0.2 : kind === 'toilet' ? 0.8 : 1.2, 0.2, 4.5);
    let fx = clampNum(f.x, 0, bounds.minX + 0.35, bounds.maxX - 0.35);
    let fz = clampNum(f.z, 0, bounds.minZ + 0.35, bounds.maxZ - 0.35);

    const explicitRoom = f.roomId
      ? rooms.find((r) => r.id === f.roomId || r.label.toLowerCase().includes(f.roomId!.toLowerCase()))
      : undefined;

    let nearestRoom = explicitRoom ?? rooms[0];
    if (!explicitRoom) {
      let minDist = Infinity;
      for (const r of rooms) {
        const dist = Math.hypot(fx - r.bounds.x, fz - r.bounds.z);
        if (dist < minDist) {
          minDist = dist;
          nearestRoom = r;
        }
      }
    }

    let rotY = 0;
    if (nearestRoom) {
      const margin = 0.2;
      const side = (f.wallSide ?? '').toLowerCase();

      if (side.includes('back') || side.includes('belakang') || side.includes('north')) {
        rotY = 0;
      } else if (side.includes('front') || side.includes('depan') || side.includes('south')) {
        rotY = Math.PI;
      } else if (side.includes('left') || side.includes('kiri') || side.includes('west')) {
        rotY = Math.PI / 2;
      } else if (side.includes('right') || side.includes('kanan') || side.includes('east')) {
        rotY = -Math.PI / 2;
      }

      const cosR = Math.abs(Math.cos(rotY));
      const sinR = Math.abs(Math.sin(rotY));
      const effHalfW = Math.min(
        (cosR * fw + sinR * fd) / 2,
        Math.max(0.15, nearestRoom.bounds.w / 2 - margin),
      );
      const effHalfD = Math.min(
        (sinR * fw + cosR * fd) / 2,
        Math.max(0.15, nearestRoom.bounds.d / 2 - margin),
      );

      if (side.includes('back') || side.includes('belakang') || side.includes('north')) {
        fz = nearestRoom.bounds.z - nearestRoom.bounds.d / 2 + effHalfD + margin;
      } else if (side.includes('front') || side.includes('depan') || side.includes('south')) {
        fz = nearestRoom.bounds.z + nearestRoom.bounds.d / 2 - effHalfD - margin;
      } else if (side.includes('left') || side.includes('kiri') || side.includes('west')) {
        fx = nearestRoom.bounds.x - nearestRoom.bounds.w / 2 + effHalfW + margin;
      } else if (side.includes('right') || side.includes('kanan') || side.includes('east')) {
        fx = nearestRoom.bounds.x + nearestRoom.bounds.w / 2 - effHalfW - margin;
      }

      fx = clampNum(
        fx,
        nearestRoom.bounds.x,
        nearestRoom.bounds.x - nearestRoom.bounds.w / 2 + effHalfW + margin,
        nearestRoom.bounds.x + nearestRoom.bounds.w / 2 - effHalfW - margin,
      );
      fz = clampNum(
        fz,
        nearestRoom.bounds.z,
        nearestRoom.bounds.z - nearestRoom.bounds.d / 2 + effHalfD + margin,
        nearestRoom.bounds.z + nearestRoom.bounds.d / 2 - effHalfD - margin,
      );
    }

    return {
      id: `ai_f_${idx + 1}`,
      kind,
      x: Number(fx.toFixed(2)),
      z: Number(fz.toFixed(2)),
      w: fw,
      d: fd,
      rotY: rotY !== 0 ? rotY : undefined,
      hideInRemediation: kind === 'cable' || kind === 'rug',
    };
  });

  // Always add contextual remediation grabbar near bathroom room
  const bathRoom = rooms.find((r) => r.category === 'bathroom') ?? rooms[0];
  furniture.push({
    id: 'ai_remed_grabbar',
    kind: 'grabbar',
    x: bathRoom.bounds.x - bathRoom.bounds.w * 0.35,
    z: bathRoom.bounds.z,
    w: 0.14,
    d: 1.05,
    showOnlyInRemediation: true,
  });

  const builtRoute = buildRouteGraphForRooms(rooms);
  const useParsedRoute =
    parsed.routeNodes && parsed.routeNodes.length >= 2 && parsed.routeEdges && parsed.routeEdges.length >= 1;
  const nodes: RouteNode[] = useParsedRoute ? [...parsed.routeNodes!] : [...builtRoute.nodes];
  const edges: RouteEdge[] = useParsedRoute ? [...parsed.routeEdges!] : [...builtRoute.edges];

  // Guarantee every room has a route node & reachable connection (no isolated rooms or sealed walls)
  for (const r of rooms) {
    if (!nodes.some((n) => n.roomId === r.id)) {
      nodes.push({ id: `rn_${r.id}`, roomId: r.id, x: r.bounds.x, z: r.bounds.z });
    }
  }
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const node = nodes.find((n) => n.roomId === r.id);
    if (!node) continue;
    const hasEdge = edges.some(([a, b]) => a === node.id || b === node.id);
    if (!hasEdge) {
      const prevNode = nodes.find((n) => n.roomId === rooms[0].id) ?? nodes[0];
      if (prevNode) edges.push([prevNode.id, node.id]);
    }
  }

  // Keep solid tall furniture slightly clear of doorway waypoints so doors aren't blocked
  const doorNodes = nodes.filter((n) => !n.roomId);
  for (const fItem of furniture) {
    if (fItem.kind === 'rug' || fItem.kind === 'cable' || fItem.kind === 'grabbar') continue;
    for (const dn of doorNodes) {
      const dx = fItem.x - dn.x;
      const dz = fItem.z - dn.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.65 && dist > 0.01) {
        const push = (0.68 - dist) / dist;
        fItem.x = Number((fItem.x + dx * push).toFixed(2));
        fItem.z = Number((fItem.z + dz * push).toFixed(2));
      }
    }
  }

  const walls = carveDoorwaysInWalls(rawWalls, nodes, edges, rooms, bounds);
  const floorId = 'ai_lantai_1';

  const hazards: HazardFinding[] = (parsed.hazards ?? []).slice(0, 8).map((h, idx) => {
    const room =
      rooms.find((r) => r.id === h.roomId || r.label.toLowerCase().includes((h.roomId ?? '').toLowerCase())) ??
      rooms[idx % rooms.length];
    const frameIdx =
      typeof h.evidenceFrameIndex === 'number' &&
      h.evidenceFrameIndex >= 1 &&
      h.evidenceFrameIndex <= frames.length
        ? h.evidenceFrameIndex
        : (idx % Math.max(1, frames.length)) + 1;
    const frameSample = frames[frameIdx - 1];
    let depthMatch = depthProfiles.find((d) => d.frameIndex === frameIdx);
    if (!depthMatch && depthProfiles.length > 0) {
      depthMatch = depthProfiles.reduce((best, cur) =>
        Math.abs(cur.frameIndex - frameIdx) < Math.abs(best.frameIndex - frameIdx) ? cur : best,
      );
    }

    return {
      id: `ai_h_${idx + 1}_${Date.now().toString(36).slice(-3)}`,
      floorId,
      roomId: room.id,
      title: (h.title || `Temuan Keamanan #${idx + 1}`).trim(),
      pillar: normalizePillar(h.pillar),
      severity: normalizeSeverity(h.severity),
      position: [
        clampNum(h.x, room.bounds.x + (idx % 2 === 0 ? 0.45 : -0.45), bounds.minX + 0.5, bounds.maxX - 0.5),
        0.45,
        clampNum(h.z, room.bounds.z + (idx % 3 === 0 ? -0.4 : 0.4), bounds.minZ + 0.5, bounds.maxZ - 0.5),
      ],
      clinicalRisk:
        h.clinicalRisk?.trim() || 'Meningkatkan risiko terpeleset atau tersandung pada lansia.',
      observation:
        h.observation?.trim() || `Terdeteksi pada keyframe #${frameIdx} di area ${room.label}.`,
      remediation:
        h.remediation?.trim() || 'Rapikan hambatan lantai dan pasang pencahayaan/pegangan bantu.',
      reviewed: false,
      evidenceImageUrl: frameSample?.dataUrl,
      evidenceFrameIndex: frameIdx,
      depthHeatmapUrl: depthMatch?.heatmapDataUrl,
      depthSummary: depthMatch?.summaryText,
    };
  });

  const bedroom = rooms.find((r) => r.category === 'bedroom') ?? rooms[0];
  const floor: FloorPlanSpec = {
    id: floorId,
    label: parsed.floorLabel?.trim() || 'Lantai 1 (AI)',
    floorBounds: bounds,
    plinth: {
      x: (bounds.minX + bounds.maxX) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2,
      w: bounds.maxX - bounds.minX + 0.6,
      d: bounds.maxZ - bounds.minZ + 0.6,
    },
    isoCamera: {
      pos: [-7.0, 10.6, 9.2],
      target: [(bounds.minX + bounds.maxX) / 2, 0.35, (bounds.minZ + bounds.maxZ) / 2],
    },
    topCamera: {
      pos: [(bounds.minX + bounds.maxX) / 2, 15.0, 0.01],
      target: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2],
    },
    rooms,
    walls,
    furniture,
    routeNodes: nodes,
    routeEdges: edges,
    defaultFromRoomId: bedroom.id,
    defaultToRoomId: bathRoom.id === bedroom.id && rooms[1] ? rooms[1].id : bathRoom.id,
    nightLightPositions: [
      [(bounds.minX + bounds.maxX) / 2, 0.45, (bounds.minZ + bounds.maxZ) / 2],
      [bathRoom.bounds.x, 0.45, bathRoom.bounds.z],
    ],
    hazards,
  };

  return {
    id: `ai_bp_${Date.now().toString(36)}`,
    name: `${areaName} (AI Dollhouse)`,
    subtitle: `Dihasilkan AI dari ${frames.length} media input • Tanpa Gaussian/GPU`,
    isAiGenerated: true,
    createdAt: new Date().toISOString(),
    floors: [floor],
  };
}

function buildBlueprintPrompt(
  areaName: string,
  frames: KeyframeSample[],
  inputKind: ScanInputKind,
  roomSizeHint?: string,
  depthProfiles?: DepthFrameSummary[],
  layoutHint?: string,
): string {
  const modeDesc =
    inputKind === 'floorplan2d'
      ? 'gambar denah 2D/sketsa ruangan'
      : inputKind === 'video'
        ? `${frames.length} keyframe berurutan dari video walkthrough`
        : `${frames.length} foto sudut ruangan`;

  const timeline = frames
    .map((f, idx) => {
      const timeOrName = inputKind === 'video' ? `${f.timeSec}s` : f.name;
      return f.panHint ? `Frame #${idx + 1} (${timeOrName}, ${f.panHint})` : `Frame #${idx + 1} (${timeOrName})`;
    })
    .join('; ');

  const sizeLine = roomSizeHint?.trim()
    ? `\nPATOKAN UKURAN PENGGUNA: "${roomSizeHint.trim()}" — jadikan ukuran ini sebagai acuan utama dimensi ruangan.`
    : '';

  const layoutLine = layoutHint?.trim()
    ? `\nKETERANGAN LETAK & SUSUNAN DENAH DARI PENGGUNA (PRIORITAS TINGGI — WAJIB DIIKUTI):\n"${layoutHint.trim()}"\nSusun posisi relatif ruangan (kiri/kanan/depan/belakang/bentuk-L), letak pintu penghubung, dan orientasi furnitur PERSIS sesuai keterangan pengguna di atas!`
    : '';

  const depthLine =
    depthProfiles && depthProfiles.length > 0
      ? `\nDATA SENSOR DEPTH AI (Depth Anything V2 - Estimasi Jarak, Lebar Lorong & Bukaan Pintu per Frame):\n${depthProfiles
          .map((d) => `- ${d.summaryText}`)
          .join('\n')}\nWAJIB gunakan angka lebar (meter), deteksi bukaan pintu/lorong, dan sisi kiri/kanan terdekat dari Depth AI ini untuk kalibrasi ukuran ruangan & posisi dinding!`
      : '';

  return `Anda adalah Arsitek Digital Twin & Occupational Therapist klinis berbasis protokol CDC STEADI.
Analisis ${modeDesc} [${timeline}] untuk area "${areaName}" dan ubah menjadi JSON Blueprint 3D Dollhouse dalam skala meter (koordinat X: -5.5..+5.5, Z: -5.5..+5.5).${sizeLine}${layoutLine}${depthLine}

ATURAN KETAT AKURASI GEOMETRI:
1. REKONSTRUKSI TRAJEKTORI KAMERA & SKALA NYATA DULU: Lacak urutan gerak kamera (lurus/belok kiri/kanan/melewati pintu) antar frame dan hitung dimensi ruang dari patokan benda nyata: ubin keramik (30×30 / 40×40 / 60×60 cm), daun pintu (~0.75–0.85 m), dan kloset (~0.40×0.70 m).
2. ZONA BERSEBELAHAN TANPA TUMPAH-TINDIH (MANHATTAN GRID): Petakan HANYA ruangan/zona yang BENAR-BENAR terlihat (category: bedroom, bathroom, kitchen, living, hallway, entrance) dengan bounds {x, z, w, d} kelipatan 0.25m yang saling menempel tepi-ke-tepi secara akurat dan TIDAK saling tumpang tindih. JANGAN mengarang ruangan yang tidak terlihat.
3. FURNITUR MENEMPEL DINDING YANG BENAR: Cantumkan furnitur yang benar-benar terlihat (bed, toilet, sink, counter, sofa, table, rug, cable, plant) beserta "roomId" dan "wallSide" ("back" | "left" | "right" | "front" | "center") agar otomatis menghadap & menempel rapi ke dinding.
4. TEMUAN KLINIS STEADI PRESISI: Laporkan 2–5 temuan jatuh yang benar-benar tampak pada gambar, sertakan koordinat (x, z) di dalam ruangan terkait dan "evidenceFrameIndex" (1..${frames.length}) yang paling jelas memperlihatkannya.
5. RUTE & WAYPOINT PINTU: Sertakan "routeNodes" (1 node di tengah setiap ruangan dengan "roomId" + node waypoint tepat di tengah bukaan pintu antar zona) dan "routeEdges" yang menghubungkannya melewati pintu.

Balas HANYA JSON valid dengan urutan field ini:
{
  "cameraTrajectory": "Urutan arah kamera per frame, misal: Frame 1-3 di lorong wastafel menghadap ke pintu, Frame 4-7 belok masuk ke bilik kloset",
  "scaleEstimation": "Misal: Terlihat ~5x7 ubin 40cm (~2.0m x 2.8m), lebar pintu ~0.8m, Depth AI lorong ~1.55m",
  "observedFixtures": ["pintu", "ubin keramik", "kloset"],
  "summary": "Ringkasan audit ruang dalam 1-2 kalimat bahasa Indonesia",
  "floorLabel": "Lantai 1",
  "rooms": [
    {"id": "lorong_1", "label": "Area Urinoir & Pintu", "category": "hallway", "floorStyle": "tile", "x": 0, "z": 1.4, "w": 2.4, "d": 2.4},
    {"id": "toilet_1", "label": "Bilik Toilet", "category": "bathroom", "floorStyle": "tile", "x": 0, "z": -1.2, "w": 2.4, "d": 2.8}
  ],
  "furniture": [{"kind": "toilet", "roomId": "toilet_1", "wallSide": "back", "x": 0, "z": -2.1, "w": 0.65, "d": 0.85}],
  "routeNodes": [
    {"id": "n_toilet", "roomId": "toilet_1", "x": 0, "z": 0},
    {"id": "wp_pintu", "x": 0, "z": 1.5}
  ],
  "routeEdges": [["n_toilet", "wp_pintu"]],
  "hazards": [{
    "title": "Judul risiko singkat",
    "pillar": "tripping | ergonomic | lighting | mobility",
    "severity": "critical | moderate",
    "roomId": "toilet_1",
    "x": 0.2,
    "z": 1.1,
    "clinicalRisk": "Dampak medis bagi lansia",
    "observation": "Hal yang tampak pada foto",
    "remediation": "Langkah perbaikan konkret",
    "evidenceFrameIndex": 1
  }]
}`;
}

function extractJsonObject(rawText: string): RawAiBlueprintResponse {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Respons AI tidak mengandung JSON blueprint yang valid.');
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as RawAiBlueprintResponse;
}

function buildOfflineDemoBlueprint(
  areaName: string,
  frames: KeyframeSample[],
  inputKind: ScanInputKind,
): VisionBlueprintResult {
  const f1 = frames[0];
  const f2 = frames[1] ?? frames[0];
  const f3 = frames[2] ?? frames[0];
  const f4 = frames[3] ?? frames[0];

  const syntheticParsed: RawAiBlueprintResponse = {
    summary: `Mode Demo Offline (${inputKind === 'floorplan2d' ? 'Konversi Denah 2D → 3D' : `${frames.length} keyframe diproses`}). Teridentifikasi 4 ruangan dan 4 titik risiko CDC STEADI untuk "${areaName}". Isi API Key Gemini/OpenAI di tab Pindai untuk pemetaan AI langsung dari foto rumah Anda.`,
    floorLabel: 'Lantai 1 (Hasil Pindai)',
    rooms: [
      { id: 'kamar_lansia', label: 'Kamar Lansia', category: 'bedroom', floorStyle: 'wood', x: -2.6, z: 1.5, w: 4.8, d: 6.2 },
      { id: 'toilet_utama', label: 'Toilet', category: 'bathroom', floorStyle: 'tile', x: -2.6, z: -3.2, w: 4.8, d: 3.2 },
      { id: 'dapur_bersih', label: 'Dapur & Pantry', category: 'kitchen', floorStyle: 'tile', x: 2.5, z: -2.6, w: 4.6, d: 4.4 },
      { id: 'ruang_santai', label: 'Ruang Santai', category: 'living', floorStyle: 'wood', x: 2.5, z: 2.1, w: 4.6, d: 5.0 },
    ],
    walls: [
      { x: -0.1, z: -4.8, w: 9.8, d: 0.26, h: 2.1 },
      { x: -5.0, z: -0.1, w: 0.26, d: 9.6, h: 2.1 },
      { x: 4.8, z: -0.1, w: 0.26, d: 9.6, h: 2.1 },
      { x: -2.8, z: 4.6, w: 4.4, d: 0.26, h: 1.45 },
      { x: 2.9, z: 4.6, w: 3.8, d: 0.26, h: 1.45 },
      // Partition bedroom & toilet with doorway
      { x: -3.7, z: -1.6, w: 2.6, d: 0.22, h: 2.0 },
      { x: -0.2, z: -3.3, w: 0.22, d: 3.0, h: 2.0 },
      // Partition living & kitchen
      { x: 2.5, z: -0.4, w: 4.6, d: 0.22, h: 1.85 },
      { x: -0.2, z: 2.4, w: 0.22, d: 4.4, h: 1.9 },
    ],
    furniture: [
      { kind: 'bed', x: -3.6, z: 2.2, w: 2.3, d: 2.1 },
      { kind: 'rug', x: -1.8, z: 2.2, w: 1.3, d: 2.2 },
      { kind: 'cable', x: -1.2, z: 0.5, w: 1.2, d: 0.2 },
      { kind: 'toilet', x: -4.0, z: -3.9, w: 0.65, d: 0.88 },
      { kind: 'sink', x: -1.8, z: -4.1, w: 1.2, d: 0.58 },
      { kind: 'counter', x: 3.8, z: -3.1, w: 1.1, d: 2.8 },
      { kind: 'sofa', x: 3.8, z: 2.2, w: 1.1, d: 2.5 },
      { kind: 'table', x: 2.1, z: 2.2, w: 0.85, d: 1.4 },
      { kind: 'plant', x: 4.1, z: 0.4, w: 0.65, d: 0.65 },
    ],
    hazards: [
      {
        title: `Kabel charger melintang di tepi ranjang (${areaName})`,
        pillar: 'tripping',
        severity: 'critical',
        roomId: 'kamar_lansia',
        x: -1.2,
        z: 0.5,
        clinicalRisk: 'Sangat rentan membuat kaki lansia tersangkut saat bangun menuju toilet.',
        observation: `Tercatat pada sampel media #${f1?.index ?? 1}.`,
        remediation: 'Pasang pelindung kabel menempel ke dinding dan pindahkan stop kontak lebih tinggi.',
        evidenceFrameIndex: f1?.index ?? 1,
      },
      {
        title: 'Ambang pintu toilet minim pencahayaan senja/malam',
        pillar: 'lighting',
        severity: 'critical',
        roomId: 'toilet_utama',
        x: -1.4,
        z: -1.7,
        clinicalRisk: 'Adaptasi penglihatan lansia terhadap gelap lambat, memicu salah pijak di ambang ubin.',
        observation: `Area transisi pada sampel media #${f2?.index ?? 1} tampak kurang kontras.`,
        remediation: 'Tambahkan lampu malam sensor gerak 3000K pada kusen bawah pintu.',
        evidenceFrameIndex: f2?.index ?? 1,
      },
      {
        title: 'Belum tersedia grab bar di sisi kloset toilet',
        pillar: 'ergonomic',
        severity: 'critical',
        roomId: 'toilet_utama',
        x: -4.6,
        z: -3.8,
        clinicalRisk: 'Risiko tergelincir di lantai basah saat berdiri dari posisi duduk tanpa pegangan.',
        observation: `Terlihat dinding polos di samping kloset pada media #${f3?.index ?? 1}.`,
        remediation: 'Pasang wall grab bar stainless 60 cm di ketinggian 85-90 cm.',
        evidenceFrameIndex: f3?.index ?? 1,
      },
      {
        title: 'Celah jalur antara sofa & meja kurang dari 80 cm',
        pillar: 'mobility',
        severity: 'moderate',
        roomId: 'ruang_santai',
        x: 1.5,
        z: 2.0,
        clinicalRisk: 'Menghambat pergerakan alat bantu jalan walker atau tongkat kaki 4.',
        observation: `Estimasi ruang lintasan padat pada media #${f4?.index ?? 1}.`,
        remediation: 'Geser coffee table 25 cm menjauhi jalur utama koridor.',
        evidenceFrameIndex: f4?.index ?? 1,
      },
    ],
    routeNodes: [
      { id: 'n_kamar', roomId: 'kamar_lansia', x: -2.2, z: 1.2 },
      { id: 'wp_hall_w', x: -1.3, z: -0.5 },
      { id: 'wp_bath_door', x: -1.3, z: -1.6 },
      { id: 'n_toilet', roomId: 'toilet_utama', x: -2.6, z: -3.2 },
      { id: 'wp_kitchen_door', x: -0.1, z: -1.1 },
      { id: 'n_dapur', roomId: 'dapur_bersih', x: 2.0, z: -2.6 },
      { id: 'wp_living_door', x: -0.1, z: -0.2 },
      { id: 'n_ruang', roomId: 'ruang_santai', x: 1.8, z: 1.5 },
    ],
    routeEdges: [
      ['n_kamar', 'wp_hall_w'],
      ['wp_hall_w', 'wp_bath_door'],
      ['wp_bath_door', 'n_toilet'],
      ['wp_hall_w', 'wp_kitchen_door'],
      ['wp_kitchen_door', 'n_dapur'],
      ['wp_hall_w', 'wp_living_door'],
      ['wp_living_door', 'n_ruang'],
    ],
  };

  return {
    providerUsed: 'demo',
    summary: syntheticParsed.summary ?? '',
    blueprint: normalizeAiResponseToBlueprint(syntheticParsed, areaName, frames),
    isFallbackDemo: true,
  };
}

export async function generateBlueprintAndAudit(params: {
  provider: VisionProvider;
  apiKey?: string;
  areaName: string;
  roomSizeHint?: string;
  layoutHint?: string;
  inputKind: ScanInputKind;
  frames: KeyframeSample[];
  depthProfiles?: DepthFrameSummary[];
}): Promise<VisionBlueprintResult> {
  const { provider, apiKey, areaName, roomSizeHint, layoutHint, inputKind, frames, depthProfiles } = params;

  if (provider === 'demo') {
    return buildOfflineDemoBlueprint(areaName, frames, inputKind);
  }

  const prompt = buildBlueprintPrompt(areaName, frames, inputKind, roomSizeHint, depthProfiles, layoutHint);

  const resp = await fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      prompt,
      frames: frames.map((f) => ({
        mimeType: f.mimeType,
        base64: f.base64,
      })),
      clientApiKey: apiKey?.trim() || undefined,
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    modelUsed?: string;
    rawText?: string;
    error?: string;
  };

  if (!resp.ok || !data.rawText) {
    throw new Error(data.error || `Server audit error (${resp.status}).`);
  }

  const parsed = extractJsonObject(data.rawText);

  return {
    providerUsed: provider,
    modelUsed: data.modelUsed,
    summary:
      parsed.summary ??
      `Blueprint 3D & audit klinis berhasil dibuat oleh ${provider === 'gemini' ? 'Gemini Vision' : 'OpenAI Vision'}.`,
    blueprint: normalizeAiResponseToBlueprint(
      parsed,
      areaName,
      frames,
      depthProfiles,
      Boolean(roomSizeHint?.trim()),
    ),
    isFallbackDemo: false,
  };
}
