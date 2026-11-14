export type SteadiPillar = 'tripping' | 'ergonomic' | 'lighting' | 'mobility';
export type SeverityLevel = 'critical' | 'moderate';

export type RoomCategory =
  | 'bedroom'
  | 'bathroom'
  | 'kitchen'
  | 'living'
  | 'hallway'
  | 'entrance'
  | 'balcony';

export type FurnitureKind =
  | 'bed'
  | 'sofa'
  | 'table'
  | 'toilet'
  | 'sink'
  | 'counter'
  | 'cabinet'
  | 'rug'
  | 'plant'
  | 'cable'
  | 'grabbar'
  | 'stairs';

export interface HazardFinding {
  id: string;
  floorId: string;
  roomId: string;
  title: string;
  pillar: SteadiPillar;
  severity: SeverityLevel;
  position: [number, number, number];
  clinicalRisk: string;
  observation: string;
  remediation: string;
  reviewed: boolean;
  evidenceImageUrl?: string;
  evidenceFrameIndex?: number;
  depthHeatmapUrl?: string;
  depthSummary?: string;
}

export interface RoomZone {
  id: string;
  label: string;
  category: RoomCategory;
  floorStyle: 'wood' | 'tile';
  bounds: {
    x: number;
    z: number;
    w: number;
    d: number;
  };
  labelPos: [number, number, number];
}

export interface WallSegment {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  w: number;
  d: number;
  rotY?: number;
  hideInRemediation?: boolean;
  showOnlyInRemediation?: boolean;
}

export interface RouteNode {
  id: string;
  roomId?: string;
  x: number;
  z: number;
}

export type RouteEdge = [string, string];

export interface FloorPlanSpec {
  id: string;
  label: string;
  floorBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  plinth: {
    x: number;
    z: number;
    w: number;
    d: number;
  };
  isoCamera: {
    pos: [number, number, number];
    target: [number, number, number];
  };
  topCamera: {
    pos: [number, number, number];
    target: [number, number, number];
  };
  rooms: RoomZone[];
  walls: WallSegment[];
  furniture: FurnitureItem[];
  routeNodes: RouteNode[];
  routeEdges: RouteEdge[];
  defaultFromRoomId: string;
  defaultToRoomId: string;
  nightLightPositions: [number, number, number][];
  hazards: HazardFinding[];
}

export interface HouseBlueprint {
  id: string;
  name: string;
  subtitle: string;
  isAiGenerated?: boolean;
  createdAt?: string;
  floors: FloorPlanSpec[];
}

export const PILLAR_LABELS: Record<SteadiPillar, string> = {
  tripping: 'Tripping & Slipping',
  ergonomic: 'Ergonomic & Support',
  lighting: 'Visual & Lighting',
  mobility: 'Mobility Clearance',
};

function pointToSegmentDistanceSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const c1 = vx * wx + vz * wz;
  if (c1 <= 0) return wx * wx + wz * wz;
  const c2 = vx * vx + vz * vz;
  if (c2 <= c1) {
    const dx = px - bx;
    const dz = pz - bz;
    return dx * dx + dz * dz;
  }
  const b = c1 / c2;
  const projX = ax + b * vx;
  const projZ = az + b * vz;
  const dx = px - projX;
  const dz = pz - projZ;
  return dx * dx + dz * dz;
}

/**
 * Menghitung jalur aman terpendek (BFS) antar ruangan di satu lantai
 * serta mengidentifikasi hambatan aktif di dekat lintasan.
 */
export function findSafeRoute(
  floor: FloorPlanSpec,
  fromRoomId: string,
  toRoomId: string,
  activeHazards: HazardFinding[],
): {
  points: [number, number, number][];
  hazardsOnRoute: HazardFinding[];
} {
  if (!fromRoomId || !toRoomId || fromRoomId === toRoomId) {
    return { points: [], hazardsOnRoute: [] };
  }

  const startNode = floor.routeNodes.find((n) => n.roomId === fromRoomId);
  const endNode = floor.routeNodes.find((n) => n.roomId === toRoomId);
  if (!startNode || !endNode) {
    return { points: [], hazardsOnRoute: [] };
  }

  const adj = new Map<string, string[]>();
  for (const node of floor.routeNodes) {
    adj.set(node.id, []);
  }
  for (const [a, b] of floor.routeEdges) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }

  const queue: string[] = [startNode.id];
  const prev = new Map<string, string | null>([[startNode.id, null]]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === endNode.id) break;
    for (const next of adj.get(cur) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }

  if (!prev.has(endNode.id)) {
    return { points: [], hazardsOnRoute: [] };
  }

  const nodeMap = new Map(floor.routeNodes.map((n) => [n.id, n]));
  const chain: RouteNode[] = [];
  let cursor: string | null = endNode.id;
  while (cursor) {
    const node = nodeMap.get(cursor);
    if (node) chain.unshift(node);
    cursor = prev.get(cursor) ?? null;
  }

  const points: [number, number, number][] = chain.map((n) => [n.x, 0.1, n.z]);

  const hazardsOnRoute = activeHazards.filter((h) => {
    for (let i = 0; i < points.length - 1; i++) {
      const dSq = pointToSegmentDistanceSq(
        h.position[0],
        h.position[2],
        points[i][0],
        points[i][2],
        points[i + 1][0],
        points[i + 1][2],
      );
      if (dSq <= 2.35 * 2.35) return true;
    }
    return false;
  });

  return { points, hazardsOnRoute };
}

export const PRESET_BLUEPRINTS: HouseBlueprint[] = [
  {
    id: 'rumah_2_lantai',
    name: 'Rumah Lansia 2 Lantai (Demo NORA)',
    subtitle: 'Dollhouse 3D Parametrik • Rute Kamar Tidur ke Toilet',
    floors: [
      {
        id: 'lantai_1',
        label: 'Lantai 1',
        floorBounds: { minX: -6.5, maxX: 6.5, minZ: -7.0, maxZ: 6.6 },
        plinth: { x: 0, z: -0.2, w: 13.6, d: 14.2 },
        isoCamera: { pos: [-7.8, 11.4, 10.2], target: [0.1, 0.4, -0.3] },
        topCamera: { pos: [0, 16.5, 0.01], target: [0, 0, -0.2] },
        defaultFromRoomId: 'kamar_tidur',
        defaultToRoomId: 'toilet',
        nightLightPositions: [
          [-0.8, 0.45, 0.6],
          [0.2, 0.45, -2.5],
          [-0.9, 0.45, -5.2],
        ],
        rooms: [
          {
            id: 'kamar_tidur',
            label: 'Kamar Tidur',
            category: 'bedroom',
            floorStyle: 'wood',
            bounds: { x: -3.8, z: 2.65, w: 5.2, d: 7.7 },
            labelPos: [-3.9, 1.35, 3.0],
          },
          {
            id: 'toilet',
            label: 'Toilet',
            category: 'bathroom',
            floorStyle: 'tile',
            bounds: { x: -0.4, z: -5.35, w: 5.6, d: 3.1 },
            labelPos: [-0.9, 1.45, -5.4],
          },
          {
            id: 'dapur',
            label: 'Dapur',
            category: 'kitchen',
            floorStyle: 'tile',
            bounds: { x: 4.45, z: -4.05, w: 3.9, d: 5.7 },
            labelPos: [4.4, 1.45, -4.4],
          },
          {
            id: 'ruang_tamu',
            label: 'Ruang Tamu',
            category: 'living',
            floorStyle: 'wood',
            bounds: { x: 4.45, z: 2.7, w: 3.9, d: 7.6 },
            labelPos: [4.4, 1.4, 2.3],
          },
          {
            id: 'pintu_masuk',
            label: 'Pintu Masuk',
            category: 'entrance',
            floorStyle: 'wood',
            bounds: { x: 0.65, z: 4.9, w: 3.7, d: 3.2 },
            labelPos: [0.5, 1.15, 5.2],
          },
          {
            id: 'lorong',
            label: 'Lorong',
            category: 'hallway',
            floorStyle: 'wood',
            bounds: { x: 0.65, z: -0.25, w: 3.7, d: 7.1 },
            labelPos: [0.65, 1.25, -0.25],
          },
        ],
        walls: [
          // Outer Perimeter
          { x: 0, z: -7.0, w: 13.0, d: 0.26, h: 2.15 },
          { x: -6.5, z: -0.2, w: 0.26, d: 13.86, h: 2.15 },
          { x: 6.5, z: -0.2, w: 0.26, d: 13.86, h: 2.15 },
          { x: -3.75, z: 6.6, w: 5.5, d: 0.26, h: 1.45 },
          { x: 3.85, z: 6.6, w: 5.3, d: 0.26, h: 1.45 },
          // Bedroom partitions with doorway at Z -0.2..+1.5
          { x: -3.8, z: -1.2, w: 5.2, d: 0.24, h: 2.0 },
          { x: -1.2, z: -0.7, w: 0.24, d: 1.0, h: 2.0 },
          { x: -1.2, z: 4.0, w: 0.24, d: 5.0, h: 2.0 },
          // Toilet partitions with doorway at X -0.6..+1.0
          { x: -3.2, z: -5.35, w: 0.24, d: 3.1, h: 2.0 },
          { x: 2.4, z: -5.35, w: 0.24, d: 3.1, h: 2.0 },
          { x: -1.9, z: -3.8, w: 2.6, d: 0.24, h: 2.0 },
          { x: 1.7, z: -3.8, w: 1.4, d: 0.24, h: 2.0 },
          // Kitchen & Living room dividers with doorways
          { x: 4.5, z: -1.2, w: 3.8, d: 0.22, h: 1.85 },
          { x: 2.5, z: -3.45, w: 0.24, d: 0.7, h: 2.0 },
          { x: 2.5, z: 3.85, w: 0.24, d: 5.3, h: 1.85 },
        ],
        furniture: [
          { id: 'f_bed', kind: 'bed', x: -4.9, z: 2.8, w: 2.5, d: 2.2 },
          { id: 'f_nightstand', kind: 'cabinet', x: -5.7, z: 0.9, w: 0.75, d: 0.7 },
          { id: 'f_bedrug', kind: 'rug', x: -3.0, z: 2.8, w: 1.6, d: 2.5, hideInRemediation: true },
          { id: 'f_cable', kind: 'cable', x: -2.0, z: 1.2, w: 1.4, d: 0.2, hideInRemediation: true },
          { id: 'f_toilet', kind: 'toilet', x: -2.1, z: -6.1, w: 0.68, d: 0.9 },
          { id: 'f_sink', kind: 'sink', x: 0.85, z: -6.3, w: 1.25, d: 0.62 },
          {
            id: 'f_grabbar',
            kind: 'grabbar',
            x: -2.98,
            z: -5.9,
            w: 0.14,
            d: 1.15,
            showOnlyInRemediation: true,
          },
          {
            id: 'f_hallbar',
            kind: 'grabbar',
            x: -0.98,
            z: -0.65,
            w: 0.14,
            d: 0.85,
            showOnlyInRemediation: true,
          },
          { id: 'f_counter', kind: 'counter', x: 5.55, z: -4.7, w: 1.05, d: 3.1 },
          { id: 'f_din_table', kind: 'table', x: 3.9, z: -2.7, w: 1.5, d: 1.0 },
          { id: 'f_sofa', kind: 'sofa', x: 5.55, z: 2.6, w: 1.15, d: 2.85 },
          { id: 'f_coffee', kind: 'table', x: 3.9, z: 2.6, w: 0.85, d: 1.65 },
          { id: 'f_hallrug', kind: 'rug', x: 0.5, z: 2.4, w: 1.05, d: 2.4, hideInRemediation: true },
          { id: 'f_plant1', kind: 'plant', x: -5.6, z: 5.6, w: 0.7, d: 0.7 },
          { id: 'f_plant2', kind: 'plant', x: 5.6, z: -0.2, w: 0.7, d: 0.7 },
        ],
        routeNodes: [
          { id: 'n_bed', roomId: 'kamar_tidur', x: -3.2, z: 1.5 },
          { id: 'n_bed_door', x: -1.2, z: 0.65 },
          { id: 'n_hall_mid', roomId: 'lorong', x: 0.2, z: 0.65 },
          { id: 'n_hall_north', roomId: 'lorong', x: 0.2, z: -2.4 },
          { id: 'n_toilet_door', x: 0.2, z: -3.8 },
          { id: 'n_toilet', roomId: 'toilet', x: -1.0, z: -5.3 },
          { id: 'n_kitchen', roomId: 'dapur', x: 3.6, z: -2.2 },
          { id: 'n_living', roomId: 'ruang_tamu', x: 3.3, z: 0.4 },
          { id: 'n_entrance', roomId: 'pintu_masuk', x: 0.4, z: 4.8 },
        ],
        routeEdges: [
          ['n_bed', 'n_bed_door'],
          ['n_bed_door', 'n_hall_mid'],
          ['n_hall_mid', 'n_hall_north'],
          ['n_hall_north', 'n_toilet_door'],
          ['n_toilet_door', 'n_toilet'],
          ['n_hall_north', 'n_kitchen'],
          ['n_hall_mid', 'n_living'],
          ['n_hall_mid', 'n_entrance'],
        ],
        hazards: [
          {
            id: 'h1',
            floorId: 'lantai_1',
            roomId: 'kamar_tidur',
            title: 'Kabel lampu tidur melintang di ambang pintu kamar',
            pillar: 'tripping',
            severity: 'critical',
            position: [-1.8, 0.35, 1.1],
            clinicalRisk:
              'Risiko kaki lansia tersangkut saat bangun malam hari menuju toilet (pemicu utama fraktur panggul).',
            observation:
              'Kabel daya memotong rute keluar dari sisi tempat tidur ke bukaan pintu.',
            remediation:
              'Tempelkan cable raceway sepanjang dinding ke nakas dan ikat sisa kabel di bawah meja.',
            reviewed: false,
          },
          {
            id: 'h2',
            floorId: 'lantai_1',
            roomId: 'toilet',
            title: 'Lorong menuju pintu toilet minim pencahayaan malam',
            pillar: 'lighting',
            severity: 'critical',
            position: [0.2, 0.55, -2.5],
            clinicalRisk:
              'Pupil lansia usia 70+ menyerap cahaya jauh lebih sedikit; transisi kamar gelap ke lorong memicu salah langkah.',
            observation:
              'Tidak ada lampu panduan rendah di koridor penghubung antara kamar tidur dan kamar mandi.',
            remediation:
              'Pasang lampu malam sensor gerak 3000K setinggi mata kaki di dua titik koridor.',
            reviewed: false,
          },
          {
            id: 'h3',
            floorId: 'lantai_1',
            roomId: 'toilet',
            title: 'Tidak ada grab bar di dinding samping kloset',
            pillar: 'ergonomic',
            severity: 'critical',
            position: [-2.8, 0.9, -5.9],
            clinicalRisk:
              'Permukaan ubin kamar mandi licin; tanpa tumpuan tangan, bangkit dari kloset berisiko hilang keseimbangan.',
            observation:
              'Dinding barat tepat di sebelah kloset masih polos tanpa pegangan anti-slip.',
            remediation:
              'Pasang wall grab bar stainless anti-slip panjang 60-80 cm di ketinggian 85-90 cm.',
            reviewed: false,
          },
          {
            id: 'h4',
            floorId: 'lantai_1',
            roomId: 'pintu_masuk',
            title: 'Keset lorong lepas tanpa karet anti-slip',
            pillar: 'mobility',
            severity: 'moderate',
            position: [0.5, 0.3, 2.4],
            clinicalRisk:
              'Keset mudah terlipat atau tergeser oleh ujung walker / tongkat kaki 4 saat manuver di lorong.',
            observation:
              'Karpet lorong tengah berada tepat di jalur utama antara ruang tamu dan pintu masuk.',
            remediation:
              'Lepas keset lepas atau ganti dengan alas lantai karet berprofil rendah yang menempel penuh.',
            reviewed: false,
          },
        ],
      },
      {
        id: 'lantai_2',
        label: 'Lantai 2',
        floorBounds: { minX: -5.5, maxX: 5.5, minZ: -5.5, maxZ: 5.5 },
        plinth: { x: 0, z: 0, w: 11.4, d: 11.4 },
        isoCamera: { pos: [-7.0, 10.6, 9.2], target: [0, 0.4, 0] },
        topCamera: { pos: [0, 15.0, 0.01], target: [0, 0, 0] },
        defaultFromRoomId: 'kamar_atas',
        defaultToRoomId: 'kamar_mandi_atas',
        nightLightPositions: [
          [0, 0.45, -1.2],
          [-2.0, 0.45, 2.1],
        ],
        rooms: [
          {
            id: 'kamar_atas',
            label: 'Kamar Tidur Atas',
            category: 'bedroom',
            floorStyle: 'wood',
            bounds: { x: -2.8, z: -2.2, w: 5.0, d: 6.2 },
            labelPos: [-2.9, 1.35, -2.2],
          },
          {
            id: 'ruang_keluarga',
            label: 'Ruang Keluarga',
            category: 'living',
            floorStyle: 'wood',
            bounds: { x: 2.6, z: 0.2, w: 5.2, d: 10.4 },
            labelPos: [2.7, 1.35, -0.4],
          },
          {
            id: 'kamar_mandi_atas',
            label: 'Toilet Atas',
            category: 'bathroom',
            floorStyle: 'tile',
            bounds: { x: -2.8, z: 3.1, w: 5.0, d: 4.2 },
            labelPos: [-2.9, 1.35, 3.2],
          },
        ],
        walls: [
          { x: 0, z: -5.4, w: 11.0, d: 0.26, h: 2.1 },
          { x: -5.4, z: 0, w: 0.26, d: 11.0, h: 2.1 },
          { x: 5.4, z: 0, w: 0.26, d: 11.0, h: 2.1 },
          { x: 0, z: 5.4, w: 11.0, d: 0.26, h: 1.5 },
          // Partitions
          { x: -2.8, z: 1.0, w: 5.0, d: 0.24, h: 2.0 },
          { x: -0.2, z: -3.2, w: 0.24, d: 4.4, h: 2.0 },
          { x: -0.2, z: 3.8, w: 0.24, d: 3.2, h: 2.0 },
        ],
        furniture: [
          { id: 'l2_bed', kind: 'bed', x: -3.7, z: -3.1, w: 2.4, d: 2.1 },
          { id: 'l2_sofa', kind: 'sofa', x: 3.9, z: -1.8, w: 1.15, d: 2.6 },
          { id: 'l2_table', kind: 'table', x: 2.3, z: -1.8, w: 0.85, d: 1.5 },
          { id: 'l2_stairs', kind: 'stairs', x: 3.8, z: 3.4, w: 2.1, d: 2.8 },
          { id: 'l2_toilet', kind: 'toilet', x: -4.2, z: 4.1, w: 0.68, d: 0.9 },
          { id: 'l2_sink', kind: 'sink', x: -2.3, z: 4.6, w: 1.2, d: 0.6 },
          {
            id: 'l2_grab',
            kind: 'grabbar',
            x: -5.15,
            z: 4.0,
            w: 0.14,
            d: 1.15,
            showOnlyInRemediation: true,
          },
          { id: 'l2_cable', kind: 'cable', x: 1.2, z: 0.5, w: 1.5, d: 0.2, hideInRemediation: true },
        ],
        routeNodes: [
          { id: 'l2_n_bed', roomId: 'kamar_atas', x: -1.9, z: -0.4 },
          { id: 'l2_n_fam', roomId: 'ruang_keluarga', x: 1.8, z: 0.5 },
          { id: 'l2_n_mid', roomId: 'ruang_keluarga', x: 0.7, z: -0.2 },
          { id: 'l2_n_door_wc', x: 0.7, z: 1.7 },
          { id: 'l2_n_wc', roomId: 'kamar_mandi_atas', x: -2.0, z: 2.9 },
        ],
        routeEdges: [
          ['l2_n_bed', 'l2_n_mid'],
          ['l2_n_mid', 'l2_n_fam'],
          ['l2_n_mid', 'l2_n_door_wc'],
          ['l2_n_door_wc', 'l2_n_wc'],
        ],
        hazards: [
          {
            id: 'l2_h1',
            floorId: 'lantai_2',
            roomId: 'ruang_keluarga',
            title: 'Area puncak tangga tanpa pembatas kontras visual',
            pillar: 'lighting',
            severity: 'critical',
            position: [2.8, 0.55, 2.4],
            clinicalRisk:
              'Risiko terperosok di undakan teratas tangga pada malam hari bila anak tangga tidak ditandai warna kontras.',
            observation:
              'Bibir tangga lantai 2 menghadap langsung ke area jalan ruang keluarga tanpa penanda neon/lampu langkah.',
            remediation:
              'Pasang strip anti-slip berfosfor di bibir tangga atas dan lampu sensor gerak dinding.',
            reviewed: false,
          },
          {
            id: 'l2_h2',
            floorId: 'lantai_2',
            roomId: 'kamar_mandi_atas',
            title: 'Kloset lantai 2 belum memiliki pegangan bantu samping',
            pillar: 'ergonomic',
            severity: 'moderate',
            position: [-4.6, 0.85, 4.1],
            clinicalRisk:
              'Memicu tekanan lutut berlebih dan risiko jatuh ke samping saat berdiri dari posisi duduk.',
            observation:
              'Dinding sisi kiri kloset masih kosong tanpa tumpuan lipat atau tetap.',
            remediation:
              'Tambahkan wall grab bar anti-slip di dinding samping kloset lantai 2.',
            reviewed: false,
          },
        ],
      },
    ],
  },
  {
    id: 'apartemen_studio',
    name: 'Apartemen Studio Lansia (1 Lantai Ringkas)',
    subtitle: 'Unit Compact • Kamar Tidur, Pantry, & Kamar Mandi',
    floors: [
      {
        id: 'studio_1',
        label: 'Lantai 1',
        floorBounds: { minX: -5.0, maxX: 5.0, minZ: -4.5, maxZ: 4.5 },
        plinth: { x: 0, z: 0, w: 10.6, d: 9.6 },
        isoCamera: { pos: [-6.8, 10.2, 8.6], target: [0, 0.3, 0] },
        topCamera: { pos: [0, 14.0, 0.01], target: [0, 0, 0] },
        defaultFromRoomId: 'studio_tidur',
        defaultToRoomId: 'studio_wc',
        nightLightPositions: [
          [0.0, 0.45, 0.2],
          [2.4, 0.45, -1.6],
        ],
        rooms: [
          {
            id: 'studio_tidur',
            label: 'Area Tidur',
            category: 'bedroom',
            floorStyle: 'wood',
            bounds: { x: -2.4, z: 0.4, w: 4.8, d: 7.6 },
            labelPos: [-2.4, 1.3, 0.4],
          },
          {
            id: 'studio_pantry',
            label: 'Pantry',
            category: 'kitchen',
            floorStyle: 'wood',
            bounds: { x: 2.5, z: 2.1, w: 4.6, d: 4.2 },
            labelPos: [2.5, 1.3, 2.0],
          },
          {
            id: 'studio_wc',
            label: 'Toilet',
            category: 'bathroom',
            floorStyle: 'tile',
            bounds: { x: 2.5, z: -2.2, w: 4.6, d: 4.0 },
            labelPos: [2.5, 1.35, -2.3],
          },
        ],
        walls: [
          { x: 0, z: -4.3, w: 10.0, d: 0.24, h: 2.0 },
          { x: -4.9, z: 0, w: 0.24, d: 8.8, h: 2.0 },
          { x: 4.9, z: 0, w: 0.24, d: 8.8, h: 2.0 },
          { x: -2.2, z: 4.3, w: 5.4, d: 0.24, h: 1.4 },
          { x: 3.1, z: 4.3, w: 3.6, d: 0.24, h: 1.4 },
          { x: 2.5, z: -0.2, w: 4.6, d: 0.22, h: 1.9 },
          { x: 0.2, z: -3.2, w: 0.22, d: 2.0, h: 1.9 },
        ],
        furniture: [
          { id: 's_bed', kind: 'bed', x: -3.2, z: -1.6, w: 2.3, d: 2.0 },
          { id: 's_counter', kind: 'counter', x: 3.9, z: 2.3, w: 1.0, d: 2.8 },
          { id: 's_toilet', kind: 'toilet', x: 3.8, z: -3.1, w: 0.65, d: 0.85 },
          { id: 's_sink', kind: 'sink', x: 1.8, z: -3.4, w: 1.1, d: 0.55 },
          {
            id: 's_grab',
            kind: 'grabbar',
            x: 4.68,
            z: -3.0,
            w: 0.14,
            d: 1.05,
            showOnlyInRemediation: true,
          },
          { id: 's_cable', kind: 'cable', x: -1.0, z: 0.8, w: 1.2, d: 0.2, hideInRemediation: true },
        ],
        routeNodes: [
          { id: 'sn_bed', roomId: 'studio_tidur', x: -1.6, z: -0.8 },
          { id: 'sn_mid', x: 0.0, z: 0.2 },
          { id: 'sn_pantry', roomId: 'studio_pantry', x: 2.1, z: 1.8 },
          { id: 'sn_wc_door', x: 0.2, z: -1.2 },
          { id: 'sn_wc', roomId: 'studio_wc', x: 2.4, z: -2.1 },
        ],
        routeEdges: [
          ['sn_bed', 'sn_mid'],
          ['sn_mid', 'sn_pantry'],
          ['sn_mid', 'sn_wc_door'],
          ['sn_wc_door', 'sn_wc'],
        ],
        hazards: [
          {
            id: 's_h1',
            floorId: 'studio_1',
            roomId: 'studio_tidur',
            title: 'Kabel ekstensi di tengah jalur kasur ke pantry',
            pillar: 'tripping',
            severity: 'critical',
            position: [-1.0, 0.35, 0.8],
            clinicalRisk: 'Berpotensi menjerat kaki saat melangkah tanpa alas kaki.',
            observation: 'Kabel tergeletak melintang di lantai studio.',
            remediation: 'Pindahkan stop kontak ke samping ranjang dan rapikan dengan cable clip.',
            reviewed: false,
          },
          {
            id: 's_h2',
            floorId: 'studio_1',
            roomId: 'studio_wc',
            title: 'Tidak ada grab bar di sisi kloset studio',
            pillar: 'ergonomic',
            severity: 'critical',
            position: [4.5, 0.85, -3.0],
            clinicalRisk: 'Kurang pegangan tumpuan di lantai kamar mandi yang mudah basah.',
            observation: 'Dinding di sebelah kloset polos tanpa pegangan.',
            remediation: 'Pasang wall grab bar stainless anti-slip setinggi 85 cm.',
            reviewed: false,
          },
        ],
      },
    ],
  },
];
