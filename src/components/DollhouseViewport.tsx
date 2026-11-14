import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AlertTriangle,
  ArrowUp,
  Bath,
  BedDouble,
  ChevronRight,
  CornerUpLeft,
  CornerUpRight,
  DoorOpen,
  Eye,
  Flag,
  Minus,
  Navigation,
  Play,
  Plus,
  RotateCcw,
  Sofa,
  Square,
  Trees,
  Utensils,
} from 'lucide-react';
import type {
  FloorPlanSpec,
  FurnitureItem,
  HazardFinding,
  RoomCategory,
  RoomZone,
  WallSegment,
} from '../data/blueprints';
import FloorplanMinimap, { type CameraPlanPose } from './FloorplanMinimap';

export type CameraViewMode = 'iso' | 'topdown' | 'firstperson';

interface GpsHudTelemetry {
  remainingMeters: number;
  turnCue: string;
  turnType: 'straight' | 'left' | 'right' | 'uturn' | 'arrived';
}

function createGpsChevronTexture(ribbonColor: string, arrowColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = ribbonColor;
    ctx.fillRect(0, 0, 128, 64);

    // Subtle glowing side rails
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(0, 2, 128, 4);
    ctx.fillRect(0, 58, 128, 4);

    // Bold GTA-style forward chevrons (>>>) pointing along +U
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    [22, 86].forEach((cx) => {
      ctx.beginPath();
      ctx.moveTo(cx - 14, 15);
      ctx.lineTo(cx + 12, 32);
      ctx.lineTo(cx - 14, 49);
      ctx.stroke();
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGpsRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  segments = 72,
  halfWidth = 0.14,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const totalLen = Math.max(0.5, curve.getLength());

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pt = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    tangent.y = 0;
    if (tangent.lengthSq() < 1e-5) tangent.set(0, 0, -1);
    tangent.normalize();
    side.crossVectors(tangent, up).normalize();

    const lx = pt.x - side.x * halfWidth;
    const lz = pt.z - side.z * halfWidth;
    const rx = pt.x + side.x * halfWidth;
    const rz = pt.z + side.z * halfWidth;

    positions.push(lx, 0.056, lz, rx, 0.056, rz);
    const u = (t * totalLen) / 0.42;
    uvs.push(u, 0, u, 1);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function canWalkAt(nx: number, nz: number, walls: WallSegment[], pad = 0.24): boolean {
  for (const w of walls) {
    if (
      Math.abs(nx - w.x) < w.w / 2 + pad &&
      Math.abs(nz - w.z) < w.d / 2 + pad
    ) {
      return false;
    }
  }
  return true;
}

function computeGpsNavigation(
  camX: number,
  camZ: number,
  fwdX: number,
  fwdZ: number,
  routePath: [number, number, number][],
): GpsHudTelemetry | null {
  if (routePath.length < 2) return null;

  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < routePath.length; i++) {
    const d = Math.hypot(routePath[i][0] - camX, routePath[i][2] - camZ);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  }

  let remainingMeters = 0;
  for (let i = nearestIdx; i < routePath.length - 1; i++) {
    remainingMeters += Math.hypot(
      routePath[i + 1][0] - routePath[i][0],
      routePath[i + 1][2] - routePath[i][2],
    );
  }
  const dest = routePath[routePath.length - 1];
  const directDist = Math.hypot(dest[0] - camX, dest[2] - camZ);
  if (nearestIdx === routePath.length - 1) {
    remainingMeters = directDist;
  }

  if (directDist < 0.7) {
    return { remainingMeters: 0, turnCue: 'Tiba di Tujuan', turnType: 'arrived' };
  }

  const targetIdx = Math.min(routePath.length - 1, nearestIdx + 1);
  const tx = routePath[targetIdx][0] - camX;
  const tz = routePath[targetIdx][2] - camZ;
  const tLen = Math.hypot(tx, tz) || 1;
  const fLen = Math.hypot(fwdX, fwdZ) || 1;

  const dot = (fwdX / fLen) * (tx / tLen) + (fwdZ / fLen) * (tz / tLen);
  // 2D cross in XZ plane (Y up): fwdX * tz - fwdZ * tx > 0 means target is to the RIGHT
  const cross = (fwdX / fLen) * (tz / tLen) - (fwdZ / fLen) * (tx / tLen);

  if (dot < -0.5) {
    return { remainingMeters, turnCue: 'Putar Arah ke Jalur', turnType: 'uturn' };
  }
  if (cross > 0.34) {
    return { remainingMeters, turnCue: 'Belok Kanan', turnType: 'right' };
  }
  if (cross < -0.34) {
    return { remainingMeters, turnCue: 'Belok Kiri', turnType: 'left' };
  }
  return { remainingMeters, turnCue: 'Ikuti Jalur Lurus', turnType: 'straight' };
}

interface ProjectedRoomBadge {
  id: string;
  label: string;
  category: RoomCategory;
  x: number;
  y: number;
  visible: boolean;
}

interface ProjectedHazardPin {
  id: string;
  index: number;
  title: string;
  severity: HazardFinding['severity'];
  reviewed: boolean;
  x: number;
  y: number;
  visible: boolean;
}

export interface DollhouseViewportProps {
  floors: FloorPlanSpec[];
  activeFloor: FloorPlanSpec;
  hazards: HazardFinding[];
  selectedHazardId: string | null;
  fromRoomId: string;
  toRoomId: string;
  routePath: [number, number, number][];
  hasRouteRisk: boolean;
  cameraMode: CameraViewMode;
  cameraFocusTick: number;
  resetCameraTick: number;
  seniorNightLevel: number;
  remediationActive: boolean;
  showWayfinding: boolean;
  placingPinMode: boolean;
  onSelectFloor: (floorId: string) => void;
  onSelectRoom: (roomId: string) => void;
  onSelectHazard: (id: string) => void;
  onAddPinAt: (pos: [number, number, number]) => void;
  onCameraModeChange: (mode: CameraViewMode) => void;
  onResetCamera: () => void;
  onOpenHazardSummary: () => void;
}

interface ArchMaterials {
  woodFloor: THREE.MeshStandardMaterial;
  tileFloor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallTop: THREE.MeshStandardMaterial;
  plinth: THREE.MeshStandardMaterial;
  oak: THREE.MeshStandardMaterial;
  fabricLight: THREE.MeshStandardMaterial;
  fabricBeige: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  rug: THREE.MeshStandardMaterial;
  plantLeaf: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  grabbar: THREE.MeshStandardMaterial;
  nightGlow: THREE.MeshStandardMaterial;
  disposables: Array<{ dispose: () => void }>;
}

function createArchitecturalMaterials(): ArchMaterials {
  const disposables: Array<{ dispose: () => void }> = [];

  // Procedural Striped Oak Wood Floor
  const woodCanvas = document.createElement('canvas');
  woodCanvas.width = 256;
  woodCanvas.height = 256;
  const wCtx = woodCanvas.getContext('2d');
  if (wCtx) {
    wCtx.fillStyle = '#E6D2BC';
    wCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) {
      wCtx.fillStyle = i % 2 === 0 ? '#E1CBB3' : '#EBDBC9';
      wCtx.fillRect(i * 32, 0, 31, 256);
      wCtx.fillStyle = 'rgba(138, 102, 68, 0.12)';
      wCtx.fillRect(i * 32 + 31, 0, 1, 256);
    }
  }
  const woodTex = new THREE.CanvasTexture(woodCanvas);
  woodTex.wrapS = THREE.RepeatWrapping;
  woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(5, 5);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  disposables.push(woodTex);

  // Procedural Clean Bathroom / Kitchen Tile Floor
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 128;
  tileCanvas.height = 128;
  const tCtx = tileCanvas.getContext('2d');
  if (tCtx) {
    tCtx.fillStyle = '#F3EEE8';
    tCtx.fillRect(0, 0, 128, 128);
    tCtx.strokeStyle = '#E0D6CA';
    tCtx.lineWidth = 2;
    tCtx.strokeRect(0, 0, 64, 64);
    tCtx.strokeRect(64, 0, 64, 64);
    tCtx.strokeRect(0, 64, 64, 64);
    tCtx.strokeRect(64, 64, 64, 64);
  }
  const tileTex = new THREE.CanvasTexture(tileCanvas);
  tileTex.wrapS = THREE.RepeatWrapping;
  tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(4, 4);
  tileTex.colorSpace = THREE.SRGBColorSpace;
  disposables.push(tileTex);

  const woodFloor = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.72, metalness: 0.03 });
  const tileFloor = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.52, metalness: 0.04 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xf7f3ee, roughness: 0.86 });
  const wallTop = new THREE.MeshStandardMaterial({ color: 0xede4da, roughness: 0.9 });
  const plinth = new THREE.MeshStandardMaterial({ color: 0xdccfc1, roughness: 0.85 });
  const oak = new THREE.MeshStandardMaterial({ color: 0xd8be9f, roughness: 0.65 });
  const fabricLight = new THREE.MeshStandardMaterial({ color: 0xf5f1eb, roughness: 0.92 });
  const fabricBeige = new THREE.MeshStandardMaterial({ color: 0xe3d3c0, roughness: 0.9 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const rug = new THREE.MeshStandardMaterial({ color: 0xe6dcd0, roughness: 0.96 });
  const plantLeaf = new THREE.MeshStandardMaterial({ color: 0x89aa7f, roughness: 0.78 });
  const cable = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5 });
  const grabbar = new THREE.MeshStandardMaterial({
    color: 0x2e7d5b,
    emissive: 0x164e36,
    emissiveIntensity: 0.35,
    metalness: 0.35,
    roughness: 0.25,
  });
  const nightGlow = new THREE.MeshStandardMaterial({
    color: 0xffe4a0,
    emissive: 0xffc857,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  disposables.push(
    woodFloor,
    tileFloor,
    wall,
    wallTop,
    plinth,
    oak,
    fabricLight,
    fabricBeige,
    ceramic,
    rug,
    plantLeaf,
    cable,
    grabbar,
    nightGlow,
  );

  return {
    woodFloor,
    tileFloor,
    wall,
    wallTop,
    plinth,
    oak,
    fabricLight,
    fabricBeige,
    ceramic,
    rug,
    plantLeaf,
    cable,
    grabbar,
    nightGlow,
    disposables,
  };
}

function buildFurnitureGroup(item: FurnitureItem, m: ArchMaterials): THREE.Group {
  const g = new THREE.Group();
  g.position.set(item.x, 0, item.z);
  if (item.rotY) g.rotation.y = item.rotY;

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  switch (item.kind) {
    case 'bed': {
      addBox(item.w, 0.34, item.d, 0, 0.17, 0, m.oak);
      addBox(item.w * 0.94, 0.28, item.d * 0.94, 0, 0.44, 0, m.fabricLight);
      addBox(item.w * 0.58, 0.31, item.d * 0.96, item.w * 0.17, 0.45, 0, m.fabricBeige);
      // Two pillows
      [-item.d * 0.22, item.d * 0.22].forEach((pz) => {
        addBox(item.w * 0.22, 0.14, item.d * 0.34, -item.w * 0.31, 0.64, pz, m.ceramic);
      });
      break;
    }
    case 'sofa': {
      addBox(item.w, 0.36, item.d, 0, 0.2, 0, m.fabricLight);
      addBox(item.w * 0.25, 0.66, item.d, item.w * 0.37, 0.36, 0, m.fabricBeige);
      addBox(item.w, 0.5, 0.18, 0, 0.28, -item.d * 0.44, m.fabricBeige);
      addBox(item.w, 0.5, 0.18, 0, 0.28, item.d * 0.44, m.fabricBeige);
      break;
    }
    case 'table':
    case 'cabinet': {
      const h = item.kind === 'cabinet' ? 0.62 : 0.44;
      addBox(item.w, h, item.d, 0, h / 2 + 0.04, 0, m.oak);
      break;
    }
    case 'counter': {
      addBox(item.w, 0.82, item.d, 0, 0.41, 0, m.oak);
      addBox(item.w * 1.02, 0.08, item.d * 1.02, 0, 0.85, 0, m.fabricLight);
      break;
    }
    case 'toilet': {
      addBox(item.w, 0.42, item.d * 0.72, 0, 0.21, item.d * 0.1, m.ceramic);
      addBox(item.w * 0.9, 0.78, item.d * 0.32, 0, 0.39, -item.d * 0.32, m.ceramic);
      break;
    }
    case 'sink': {
      addBox(item.w, 0.78, item.d, 0, 0.39, 0, m.oak);
      addBox(item.w * 0.65, 0.14, item.d * 0.72, 0, 0.83, 0, m.ceramic);
      break;
    }
    case 'rug': {
      addBox(item.w, 0.03, item.d, 0, 0.04, 0, m.rug);
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.32, 16), m.ceramic);
      pot.position.set(0, 0.18, 0);
      pot.castShadow = true;
      g.add(pot);
      const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), m.plantLeaf);
      leaves.position.set(0, 0.56, 0);
      leaves.castShadow = true;
      g.add(leaves);
      break;
    }
    case 'cable': {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-item.w * 0.48, 0.055, -0.06),
        new THREE.Vector3(-item.w * 0.15, 0.055, 0.08),
        new THREE.Vector3(item.w * 0.18, 0.055, -0.06),
        new THREE.Vector3(item.w * 0.48, 0.055, 0.04),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.035, 8, false), m.cable);
      tube.castShadow = true;
      g.add(tube);
      break;
    }
    case 'grabbar': {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, Math.max(item.w, item.d), 14),
        m.grabbar,
      );
      if (item.d >= item.w) bar.rotation.x = Math.PI / 2;
      else bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.9, 0);
      bar.castShadow = true;
      g.add(bar);
      break;
    }
    case 'stairs': {
      const steps = 6;
      const stepD = item.d / steps;
      for (let s = 0; s < steps; s++) {
        const sh = ((s + 1) / steps) * 1.4;
        addBox(item.w, sh, stepD * 0.95, 0, sh / 2, -item.d / 2 + (s + 0.5) * stepD, m.oak);
      }
      break;
    }
  }

  return g;
}

function getRoomIcon(category: RoomCategory) {
  switch (category) {
    case 'bedroom':
      return <BedDouble size={13} />;
    case 'bathroom':
      return <Bath size={13} />;
    case 'kitchen':
      return <Utensils size={13} />;
    case 'living':
      return <Sofa size={13} />;
    case 'entrance':
      return <DoorOpen size={13} />;
    default:
      return <Trees size={13} />;
  }
}

export default function DollhouseViewport({
  floors,
  activeFloor,
  hazards,
  selectedHazardId,
  fromRoomId,
  toRoomId,
  routePath,
  hasRouteRisk,
  cameraMode,
  cameraFocusTick,
  resetCameraTick,
  seniorNightLevel,
  remediationActive,
  showWayfinding,
  placingPinMode,
  onSelectFloor,
  onSelectRoom,
  onSelectHazard,
  onAddPinAt,
  onCameraModeChange,
  onResetCamera,
  onOpenHazardSummary,
}: DollhouseViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    hemiLight: THREE.HemisphereLight;
    dirLight: THREE.DirectionalLight;
    fillLight: THREE.DirectionalLight;
    houseGroup: THREE.Group;
    routeGroup: THREE.Group;
    nightLightsGroup: THREE.Group;
    floorRayMesh: THREE.Mesh;
    furnitureMeshes: Map<string, { item: FurnitureItem; group: THREE.Group }>;
    mats: ArchMaterials;
  } | null>(null);

  const [projectedRooms, setProjectedRooms] = useState<ProjectedRoomBadge[]>([]);
  const [projectedPins, setProjectedPins] = useState<ProjectedHazardPin[]>([]);
  const [cameraPose, setCameraPose] = useState<CameraPlanPose | null>(null);
  const [gpsTelemetry, setGpsTelemetry] = useState<GpsHudTelemetry | null>(null);
  const [autoWalk, setAutoWalk] = useState(false);

  const fpLookRef = useRef({ yaw: 0, pitch: -0.05 });
  const autoWalkRef = useRef(false);
  const autoWalkProgressRef = useRef(0);
  const routeCurveRef = useRef<THREE.CatmullRomCurve3 | null>(null);
  const gpsTexRef = useRef<THREE.CanvasTexture | null>(null);
  const gpsBeaconRef = useRef<THREE.Mesh | null>(null);

  const cameraAnimRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    progress: number;
  } | null>(null);

  const latestDataRef = useRef({
    activeFloor,
    rooms: activeFloor.rooms,
    walls: activeFloor.walls,
    floorBounds: activeFloor.floorBounds,
    routePath,
    showWayfinding,
    hazards,
    placingPinMode,
    onAddPinAt,
    selectedHazardId,
    cameraMode,
  });
  latestDataRef.current = {
    activeFloor,
    rooms: activeFloor.rooms,
    walls: activeFloor.walls,
    floorBounds: activeFloor.floorBounds,
    routePath,
    showWayfinding,
    hazards,
    placingPinMode,
    onAddPinAt,
    selectedHazardId,
    cameraMode,
  };

  // Initialize Pure Three.js Scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 700;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#EAE2D9');

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 120);
    camera.position.set(...activeFloor.isoCamera.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4.2;
    controls.maxDistance = 26;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.minPolarAngle = 0.05;
    controls.target.set(...activeFloor.isoCamera.target);
    controls.update();

    controls.addEventListener('start', () => {
      cameraAnimRef.current = null;
    });

    // Warm Natural Architectural Lighting
    const hemiLight = new THREE.HemisphereLight(0xfffbf5, 0xd8c7b6, 0.88);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff5e8, 0.84);
    dirLight.position.set(-9, 16, 11);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 2;
    dirLight.shadow.camera.far = 40;
    const d = 12;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0004;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xdce7f7, 0.34);
    fillLight.position.set(10, 9, -8);
    scene.add(fillLight);

    const houseGroup = new THREE.Group();
    const routeGroup = new THREE.Group();
    const nightLightsGroup = new THREE.Group();
    scene.add(houseGroup);
    scene.add(routeGroup);
    scene.add(nightLightsGroup);

    const floorRayMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    floorRayMesh.rotation.x = -Math.PI / 2;
    floorRayMesh.position.y = 0.06;
    scene.add(floorRayMesh);

    const furnitureMeshes = new Map<string, { item: FurnitureItem; group: THREE.Group }>();
    const mats = createArchitecturalMaterials();

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      hemiLight,
      dirLight,
      fillLight,
      houseGroup,
      routeGroup,
      nightLightsGroup,
      floorRayMesh,
      furnitureMeshes,
      mats,
    };

    // Click-to-Pin Raycasting & First-Person Drag-Look
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let fpDragging = false;
    let fpLastX = 0;
    let fpLastY = 0;
    let fpMoved = 0;

    const handlePointerDown = (ev: PointerEvent) => {
      if (latestDataRef.current.cameraMode === 'firstperson' && !latestDataRef.current.placingPinMode) {
        fpDragging = true;
        fpLastX = ev.clientX;
        fpLastY = ev.clientY;
        fpMoved = 0;
        cameraAnimRef.current = null;
        return;
      }
      if (!latestDataRef.current.placingPinMode) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(floorRayMesh);
      if (hits.length > 0) {
        const pt = hits[0].point;
        latestDataRef.current.onAddPinAt([
          Number(pt.x.toFixed(2)),
          0.4,
          Number(pt.z.toFixed(2)),
        ]);
      }
    };

    const handlePointerMove = (ev: PointerEvent) => {
      if (!fpDragging || latestDataRef.current.cameraMode !== 'firstperson') return;
      const dx = ev.clientX - fpLastX;
      const dy = ev.clientY - fpLastY;
      fpLastX = ev.clientX;
      fpLastY = ev.clientY;
      fpMoved += Math.abs(dx) + Math.abs(dy);
      if (fpMoved > 3) {
        fpLookRef.current.yaw -= dx * 0.0046;
        fpLookRef.current.pitch = Math.max(-1.05, Math.min(1.05, fpLookRef.current.pitch - dy * 0.0038));
      }
    };

    const handlePointerUp = () => {
      fpDragging = false;
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // Keyboard WASD Navigation
    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      keysDown.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let rafId = 0;
    const tmpVec = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    let frameCounter = 0;

    let pulseClock = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      pulseClock += 0.05;

      const isFp = latestDataRef.current.cameraMode === 'firstperson';
      const targetFov = isFp ? 68 : 38;
      if (Math.abs(camera.fov - targetFov) > 0.08) {
        camera.fov += (targetFov - camera.fov) * 0.16;
        camera.updateProjectionMatrix();
      }
      controls.enabled = !isFp;

      // Animate GTA 5 GPS Chevrons & Destination Beacon
      if (gpsTexRef.current) {
        gpsTexRef.current.offset.x -= 0.028;
      }
      if (gpsBeaconRef.current) {
        const pulse = 1 + Math.sin(pulseClock * 2.2) * 0.08;
        gpsBeaconRef.current.scale.set(pulse, 1, pulse);
      }

      // Camera smooth glide animation
      if (cameraAnimRef.current) {
        const anim = cameraAnimRef.current;
        anim.progress = Math.min(1, anim.progress + 0.065);
        const ease = 1 - Math.pow(1 - anim.progress, 3);
        camera.position.lerpVectors(anim.startPos, anim.endPos, ease);
        controls.target.lerpVectors(anim.startTarget, anim.endTarget, ease);
        if (isFp) {
          camera.lookAt(controls.target);
        }
        if (anim.progress >= 1) {
          cameraAnimRef.current = null;
          if (isFp) {
            const lookDir = controls.target.clone().sub(camera.position);
            fpLookRef.current.yaw = Math.atan2(-lookDir.x, -lookDir.z);
            const horiz = Math.max(0.01, Math.hypot(lookDir.x, lookDir.z));
            fpLookRef.current.pitch = Math.max(-1.0, Math.min(1.0, Math.atan2(lookDir.y, horiz)));
          }
        }
      } else if (isFp) {
        // Auto-Walk along GTA GPS Route if enabled
        if (autoWalkRef.current && routeCurveRef.current) {
          const curve = routeCurveRef.current;
          const totalLen = Math.max(1.2, curve.getLength());
          autoWalkProgressRef.current = Math.min(1, autoWalkProgressRef.current + 0.026 / totalLen);
          const t = autoWalkProgressRef.current;
          const pt = curve.getPointAt(t);
          const lookAhead = curve.getPointAt(Math.min(1, t + 0.08));
          camera.position.set(pt.x, 1.5, pt.z);
          const dx = lookAhead.x - pt.x;
          const dz = lookAhead.z - pt.z;
          if (Math.hypot(dx, dz) > 0.02) {
            const desiredYaw = Math.atan2(-dx, -dz);
            let diff = desiredYaw - fpLookRef.current.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            fpLookRef.current.yaw += diff * 0.1;
          }
          if (t >= 0.995) {
            autoWalkRef.current = false;
            setAutoWalk(false);
          }
        }

        // First-Person Rotation & Wall-Collision-Safe WASD Movement
        camera.rotation.order = 'YXZ';
        camera.rotation.y = fpLookRef.current.yaw;
        camera.rotation.x = fpLookRef.current.pitch;
        camera.rotation.z = 0;

        if (keysDown.size > 0) {
          if (autoWalkRef.current) {
            autoWalkRef.current = false;
            setAutoWalk(false);
          }
          const sinY = Math.sin(fpLookRef.current.yaw);
          const cosY = Math.cos(fpLookRef.current.yaw);
          forward.set(-sinY, 0, -cosY).normalize();
          right.set(cosY, 0, -sinY).normalize();
          const step = 0.085;
          const delta = new THREE.Vector3();
          if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) delta.addScaledVector(forward, step);
          if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) delta.addScaledVector(forward, -step);
          if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) delta.addScaledVector(right, step);
          if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) delta.addScaledVector(right, -step);

          if (delta.lengthSq() > 0) {
            const walls = latestDataRef.current.walls;
            const fb = latestDataRef.current.floorBounds;
            const nx = Math.max(fb.minX + 0.35, Math.min(fb.maxX - 0.35, camera.position.x + delta.x));
            const nz = Math.max(fb.minZ + 0.35, Math.min(fb.maxZ - 0.35, camera.position.z + delta.z));
            if (canWalkAt(nx, camera.position.z, walls)) camera.position.x = nx;
            if (canWalkAt(camera.position.x, nz, walls)) camera.position.z = nz;
          }
        }

        camera.position.y = 1.5;
        const fwdLook = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
        controls.target.copy(camera.position).addScaledVector(fwdLook, 1.8);
      }

      // WASD Movement in Orbit Modes (Isometrik / Denah Atas)
      if (!isFp && keysDown.size > 0) {
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 0.0001) forward.normalize();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const step = 0.14;
        const delta = new THREE.Vector3();
        if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) delta.addScaledVector(forward, step);
        if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) delta.addScaledVector(forward, -step);
        if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) delta.addScaledVector(right, step);
        if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) delta.addScaledVector(right, -step);
        if (delta.lengthSq() > 0) {
          camera.position.add(delta);
          controls.target.add(delta);
        }
      }

      if (!isFp) {
        controls.update();
      }
      renderer.render(scene, camera);

      // Project 3D badges & pins at 30fps cadence for smooth DOM sync without thrashing
      frameCounter++;
      if (frameCounter % 2 === 0) {
        const cw = container.clientWidth || 1;
        const ch = container.clientHeight || 1;

        const nextRooms: ProjectedRoomBadge[] = latestDataRef.current.rooms.map((r) => {
          tmpVec.set(r.labelPos[0], r.labelPos[1], r.labelPos[2]).project(camera);
          return {
            id: r.id,
            label: r.label,
            category: r.category,
            x: (tmpVec.x * 0.5 + 0.5) * cw,
            y: (-tmpVec.y * 0.5 + 0.5) * ch,
            visible: tmpVec.z < 1 && tmpVec.z > -1,
          };
        });
        setProjectedRooms(nextRooms);

        const nextPins: ProjectedHazardPin[] = latestDataRef.current.hazards.map((h, i) => {
          tmpVec.set(h.position[0], h.position[1] + 0.25, h.position[2]).project(camera);
          return {
            id: h.id,
            index: i + 1,
            title: h.title,
            severity: h.severity,
            reviewed: h.reviewed,
            x: (tmpVec.x * 0.5 + 0.5) * cw,
            y: (-tmpVec.y * 0.5 + 0.5) * ch,
            visible: tmpVec.z < 1 && tmpVec.z > -1,
          };
        });
        setProjectedPins(nextPins);

        setCameraPose({
          posX: camera.position.x,
          posZ: camera.position.z,
          targetX: controls.target.x,
          targetZ: controls.target.z,
        });

        if (latestDataRef.current.showWayfinding && latestDataRef.current.routePath.length >= 2) {
          setGpsTelemetry(
            computeGpsNavigation(
              camera.position.x,
              camera.position.z,
              controls.target.x - camera.position.x,
              controls.target.z - camera.position.z,
              latestDataRef.current.routePath,
            ),
          );
        } else {
          setGpsTelemetry(null);
        }
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      mats.disposables.forEach((d) => d.dispose());
      renderer.dispose();
      threeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild Procedural Architectural Dollhouse when activeFloor changes
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs) return;

    const { houseGroup, nightLightsGroup, furnitureMeshes, mats } = objs;
    const disposeObjectGeometries = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          obj.geometry.dispose();
        }
      });
    };
    while (houseGroup.children.length > 0) {
      const child = houseGroup.children[0];
      houseGroup.remove(child);
      disposeObjectGeometries(child);
    }
    while (nightLightsGroup.children.length > 0) {
      const child = nightLightsGroup.children[0];
      nightLightsGroup.remove(child);
      disposeObjectGeometries(child);
    }
    furnitureMeshes.clear();

    // Tight Per-Room Architectural Foundation Plinths (no empty exterior concrete rectangle)
    for (const room of activeFloor.rooms) {
      const subPlinth = new THREE.Mesh(
        new THREE.BoxGeometry(room.bounds.w + 0.56, 0.34, room.bounds.d + 0.56),
        mats.plinth,
      );
      subPlinth.position.set(room.bounds.x, -0.17, room.bounds.z);
      subPlinth.receiveShadow = true;
      houseGroup.add(subPlinth);
    }

    // Keep invisible floor raycast plane centered over current layout bounds
    objs.floorRayMesh.position.set(activeFloor.plinth.x, 0.06, activeFloor.plinth.z);
    const rayScale = Math.max(1, Math.max(activeFloor.plinth.w, activeFloor.plinth.d) / 24);
    objs.floorRayMesh.scale.set(rayScale, rayScale, 1);

    // Individual Room Floor Slabs
    for (const room of activeFloor.rooms) {
      const mat = room.floorStyle === 'tile' ? mats.tileFloor : mats.woodFloor;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(room.bounds.w, 0.07, room.bounds.d),
        mat,
      );
      slab.position.set(room.bounds.x, 0.008, room.bounds.z);
      slab.receiveShadow = true;
      houseGroup.add(slab);
    }

    // Architectural Walls (Open Roof Dollhouse)
    for (const w of activeFloor.walls) {
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), mats.wall);
      wallMesh.position.set(w.x, w.h / 2, w.z);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      houseGroup.add(wallMesh);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.w + 0.01, 0.04, w.d + 0.01), mats.wallTop);
      cap.position.set(w.x, w.h + 0.01, w.z);
      houseGroup.add(cap);
    }

    // Procedural Furniture & Remediation Props
    for (const fItem of activeFloor.furniture) {
      const fGroup = buildFurnitureGroup(fItem, mats);
      houseGroup.add(fGroup);
      furnitureMeshes.set(fItem.id, { item: fItem, group: fGroup });
    }

    // Motion-Sensor Night Lights (Revealed in Remediation Mode)
    for (const pos of activeFloor.nightLightPositions) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), mats.nightGlow);
      bulb.position.set(pos[0], pos[1], pos[2]);
      nightLightsGroup.add(bulb);

      const ptLight = new THREE.PointLight(0xffd27d, 1.35, 5.5);
      ptLight.position.set(pos[0], pos[1] + 0.2, pos[2]);
      nightLightsGroup.add(ptLight);
    }
  }, [activeFloor]);

  // Apply Before vs After Remediation state directly on 3D Furniture & Lights
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs) return;

    objs.furnitureMeshes.forEach(({ item, group }) => {
      if (item.hideInRemediation) {
        group.visible = !remediationActive;
      } else if (item.showOnlyInRemediation) {
        group.visible = remediationActive;
      } else {
        group.visible = true;
      }
    });

    objs.nightLightsGroup.visible = remediationActive;
  }, [remediationActive, activeFloor]);

  // Apply Senior Eye Night Vision dimming directly to Three.js Lights & Background
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs) return;
    const frac = Math.max(0, Math.min(1, seniorNightLevel / 100));

    const dayColor = new THREE.Color('#EAE2D9');
    const nightColor = new THREE.Color('#192130');
    objs.scene.background = dayColor.lerp(nightColor, frac * 0.92);

    objs.hemiLight.intensity = 0.88 * (1 - frac * 0.72);
    objs.dirLight.intensity = 0.84 * (1 - frac * 0.76);
    objs.fillLight.intensity = 0.34 * (1 - frac * 0.65);
  }, [seniorNightLevel]);

  // Build GTA 5 Style Glowing GPS Path Ribbon + Animated Chevrons + Checkpoint Beacon
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs) return;
    const { routeGroup } = objs;

    while (routeGroup.children.length > 0) {
      const child = routeGroup.children[0];
      routeGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
    if (gpsTexRef.current) {
      gpsTexRef.current.dispose();
      gpsTexRef.current = null;
    }
    gpsBeaconRef.current = null;
    routeCurveRef.current = null;

    if (!showWayfinding || routePath.length < 2) {
      if (autoWalkRef.current) {
        autoWalkRef.current = false;
        setAutoWalk(false);
      }
      return;
    }

    const pts = routePath.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.18);
    routeCurveRef.current = curve;

    const routeHex = remediationActive ? 0x10b981 : hasRouteRisk ? 0x9333ea : 0x06b6d4;
    const ribbonCss = remediationActive
      ? 'rgba(16, 185, 129, 0.85)'
      : hasRouteRisk
        ? 'rgba(147, 51, 234, 0.88)'
        : 'rgba(6, 182, 212, 0.88)';
    const chevronTex = createGpsChevronTexture(ribbonCss, '#ffffff');
    gpsTexRef.current = chevronTex;

    // Flat GTA-style glowing floor ribbon with scrolling >>> chevrons
    const ribbonGeo = buildGpsRibbonGeometry(curve, 80, 0.15);
    const ribbonMat = new THREE.MeshBasicMaterial({
      map: chevronTex,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    routeGroup.add(ribbonMesh);

    // Subtle elevated core rail so route pops cleanly in Isometric view
    const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.045, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: routeHex,
      emissive: routeHex,
      emissiveIntensity: 0.55,
      roughness: 0.25,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    routeGroup.add(tubeMesh);

    // Origin Pad
    const originDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.04, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: routeHex, emissiveIntensity: 0.3 }),
    );
    originDisc.position.set(pts[0].x, 0.06, pts[0].z);
    routeGroup.add(originDisc);

    // GTA 5 Style Vertical Light Beacon + Ground Halo at Destination
    const destPt = pts[pts.length - 1];
    const destHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.42, 32),
      new THREE.MeshBasicMaterial({
        color: routeHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    destHalo.rotation.x = -Math.PI / 2;
    destHalo.position.set(destPt.x, 0.065, destPt.z);
    routeGroup.add(destHalo);

    const beaconMat = new THREE.MeshBasicMaterial({
      color: routeHex,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beaconCylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 1.85, 24, 1, true),
      beaconMat,
    );
    beaconCylinder.position.set(destPt.x, 0.96, destPt.z);
    gpsBeaconRef.current = beaconCylinder;
    routeGroup.add(beaconCylinder);

    return () => {
      chevronTex.dispose();
    };
  }, [routePath, showWayfinding, hasRouteRisk, remediationActive]);

  // Camera Mode / Floor / Reset Smooth Transitions
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs) return;

    const curFloor = latestDataRef.current.activeFloor;
    const curRoutePath = latestDataRef.current.routePath;

    let endPos: THREE.Vector3;
    let endTarget: THREE.Vector3;

    if (cameraMode === 'topdown') {
      autoWalkRef.current = false;
      setAutoWalk(false);
      endPos = new THREE.Vector3(...curFloor.topCamera.pos);
      endTarget = new THREE.Vector3(...curFloor.topCamera.target);
    } else if (cameraMode === 'firstperson') {
      const originRoom =
        curFloor.rooms.find((r) => r.id === fromRoomId) ?? curFloor.rooms[0];
      const nextPt =
        curRoutePath.length >= 2
          ? new THREE.Vector3(curRoutePath[1][0], 1.48, curRoutePath[1][2])
          : (() => {
              const destRoom =
                curFloor.rooms.find((r) => r.id === toRoomId) ??
                curFloor.rooms[curFloor.rooms.length - 1];
              return new THREE.Vector3(destRoom.bounds.x, 1.48, destRoom.bounds.z);
            })();
      const startX = curRoutePath.length >= 2 ? curRoutePath[0][0] : originRoom.bounds.x;
      const startZ = curRoutePath.length >= 2 ? curRoutePath[0][2] : originRoom.bounds.z;
      endPos = new THREE.Vector3(startX, 1.5, startZ);
      endTarget = nextPt;
    } else {
      autoWalkRef.current = false;
      setAutoWalk(false);
      endPos = new THREE.Vector3(...curFloor.isoCamera.pos);
      endTarget = new THREE.Vector3(...curFloor.isoCamera.target);
    }

    cameraAnimRef.current = {
      startPos: objs.camera.position.clone(),
      endPos,
      startTarget: objs.controls.target.clone(),
      endTarget,
      progress: 0,
    };
  }, [cameraMode, activeFloor.id, resetCameraTick, fromRoomId, toRoomId]);

  // Focus Camera toward Selected Hazard Pin
  useEffect(() => {
    const objs = threeRef.current;
    if (!objs || cameraFocusTick === 0) return;
    const {
      selectedHazardId: currentHazardId,
      hazards: currentHazards,
      cameraMode: currentCameraMode,
    } = latestDataRef.current;
    if (!currentHazardId) return;
    const hazard = currentHazards.find((h) => h.id === currentHazardId);
    if (!hazard) return;

    const target = new THREE.Vector3(hazard.position[0], 0.55, hazard.position[2]);
    let endPos: THREE.Vector3;
    if (currentCameraMode === 'firstperson') {
      const room = latestDataRef.current.rooms.find((r) => r.id === hazard.roomId);
      const rx = room ? room.bounds.x : hazard.position[0];
      const rz = room ? room.bounds.z + 1.1 : hazard.position[2] + 1.2;
      endPos = new THREE.Vector3(rx, 1.5, rz);
      if (endPos.distanceTo(target) < 0.7) {
        endPos.set(rx - 0.9, 1.5, rz + 0.9);
      }
    } else {
      const offset =
        currentCameraMode === 'topdown'
          ? new THREE.Vector3(0, 9.2, 0.1)
          : new THREE.Vector3(-4.2, 5.8, 5.2);
      endPos = target.clone().add(offset);
    }

    cameraAnimRef.current = {
      startPos: objs.camera.position.clone(),
      endPos,
      startTarget: objs.controls.target.clone(),
      endTarget: target,
      progress: 0,
    };
  }, [cameraFocusTick]);

  const handleZoomStep = (deltaDist: number) => {
    const objs = threeRef.current;
    if (!objs) return;
    if (cameraMode === 'firstperson') {
      const sinY = Math.sin(fpLookRef.current.yaw);
      const cosY = Math.cos(fpLookRef.current.yaw);
      const step = deltaDist < 0 ? 0.85 : -0.85;
      const nx = objs.camera.position.x - sinY * step;
      const nz = objs.camera.position.z - cosY * step;
      if (canWalkAt(nx, nz, activeFloor.walls)) {
        objs.camera.position.x = nx;
        objs.camera.position.z = nz;
      }
      return;
    }
    const offset = objs.camera.position.clone().sub(objs.controls.target);
    const len = offset.length();
    const nextLen = Math.max(4.0, Math.min(24.0, len + deltaDist));
    offset.setLength(nextLen);
    objs.camera.position.copy(objs.controls.target).add(offset);
    objs.controls.update();
  };

  const toggleAutoWalkGps = () => {
    if (cameraMode !== 'firstperson') {
      onCameraModeChange('firstperson');
      autoWalkProgressRef.current = 0;
      autoWalkRef.current = true;
      setAutoWalk(true);
      return;
    }
    const next = !autoWalkRef.current;
    if (next && autoWalkProgressRef.current >= 0.98) {
      autoWalkProgressRef.current = 0;
    }
    autoWalkRef.current = next;
    setAutoWalk(next);
  };

  const unreviewedCount = hazards.filter((h) => !h.reviewed).length;
  const modeLabel =
    cameraMode === 'iso'
      ? 'Isometrik Dollhouse'
      : cameraMode === 'topdown'
        ? 'Denah Atas (Top-Down)'
        : 'First Person (150 cm)';

  const destRoomLabel =
    activeFloor.rooms.find((r) => r.id === toRoomId)?.label ?? 'Tujuan';

  const floorRooms: RoomZone[] = activeFloor.rooms;

  return (
    <div className="viewport-root">
      <div
        ref={containerRef}
        className={`canvas-host ${placingPinMode ? 'crosshair' : ''}`}
      />

      {seniorNightLevel > 4 && (
        <div
          className="senior-vignette"
          style={{ opacity: Math.min(0.82, (seniorNightLevel / 100) * 0.85) }}
        />
      )}

      {/* Floating Spatial Room Labels */}
      <div className="room-badge-layer">
        {projectedRooms.map((rb) => {
          if (!rb.visible) return null;
          const isEndpoint = rb.id === fromRoomId || rb.id === toRoomId;
          return (
            <button
              key={rb.id}
              type="button"
              data-testid={`room-badge-${rb.id}`}
              className={`room-badge ${isEndpoint ? 'active' : ''}`}
              style={{
                transform: `translate(${rb.x}px, ${rb.y}px) translate(-50%, -50%)`,
              }}
              onClick={() => onSelectRoom(rb.id)}
            >
              {getRoomIcon(rb.category)}
              <span>{rb.label}</span>
            </button>
          );
        })}
      </div>

      {/* Projected 3D Hazard Pins */}
      <div className="pin-layer">
        {projectedPins.map((pin) => {
          if (!pin.visible) return null;
          const active = pin.id === selectedHazardId;
          return (
            <button
              key={pin.id}
              type="button"
              title={pin.title}
              data-testid={`hazard-pin-${pin.id}`}
              className={`pin-marker ${pin.severity} ${pin.reviewed ? 'reviewed' : ''} ${
                active ? 'selected' : ''
              }`}
              style={{
                transform: `translate(${pin.x}px, ${pin.y}px) translate(-50%, -50%)`,
              }}
              onClick={() => onSelectHazard(pin.id)}
            >
              {pin.index}
            </button>
          );
        })}
      </div>

      {/* Top-Left HUD: Floor Switcher + Mode Switcher + Status */}
      <div className="hud-top-left no-print">
        <div className="hud-pill">
          <strong>{modeLabel}</strong>
          <span>• {activeFloor.label}</span>
          {remediationActive && <span className="pill-tag ok">After Remediation ON</span>}
          {seniorNightLevel > 0 && (
            <span className="pill-tag warn">Senior Eye {seniorNightLevel}%</span>
          )}
        </div>

        <div className="hud-switch-row">
          {floors.length > 1 && (
            <div className="cam-switcher" role="group" aria-label="Pilih Lantai Rumah">
              {floors.map((fl) => (
                <button
                  key={fl.id}
                  type="button"
                  data-testid={`floor-btn-${fl.id}`}
                  className={`cam-chip ${fl.id === activeFloor.id ? 'active' : ''}`}
                  onClick={() => onSelectFloor(fl.id)}
                >
                  {fl.label}
                </button>
              ))}
            </div>
          )}

          <div className="cam-switcher" role="group" aria-label="Pilih Sudut Pandang Kamera">
            <button
              type="button"
              className={`cam-chip ${cameraMode === 'iso' ? 'active' : ''}`}
              onClick={() => onCameraModeChange('iso')}
            >
              Isometrik
            </button>
            <button
              type="button"
              className={`cam-chip ${cameraMode === 'topdown' ? 'active' : ''}`}
              onClick={() => onCameraModeChange('topdown')}
            >
              Denah Atas
            </button>
            <button
              type="button"
              data-testid="cam-mode-firstperson"
              className={`cam-chip ${cameraMode === 'firstperson' ? 'active' : ''}`}
              onClick={() => onCameraModeChange('firstperson')}
            >
              <Eye size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              First Person
            </button>
          </div>
        </div>

        {placingPinMode && (
          <div className="hud-pill accent">
            Klik langsung lantai di denah 3D untuk menandai hambatan baru
          </div>
        )}
      </div>

      {/* Right-Side Floating Camera Controls */}
      <div className="hud-cam-controls no-print">
        <button
          type="button"
          className="circle-ctrl"
          onClick={onResetCamera}
          title="Reset Sudut Pandang"
          aria-label="Reset Sudut Pandang"
        >
          <RotateCcw size={17} />
        </button>
        <div className="zoom-stack">
          <button
            type="button"
            className="zoom-btn"
            onClick={() => handleZoomStep(-1.8)}
            title="Perbesar (Zoom In)"
            aria-label="Perbesar Model"
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            className="zoom-btn"
            onClick={() => handleZoomStep(1.8)}
            title="Perkecil (Zoom Out)"
            aria-label="Perkecil Model"
          >
            <Minus size={17} />
          </button>
        </div>
      </div>

      {/* Bottom-Left: GTA 5 Style GPS Banner + Live Radar Minimap + Hazard Pill */}
      <div className="hud-bottom-left-stack no-print">
        {showWayfinding && gpsTelemetry && (
          <div className="gta-gps-hud" data-testid="gta-gps-hud">
            <span
              className={`gta-gps-turn ${
                gpsTelemetry.turnType === 'arrived'
                  ? 'ok'
                  : hasRouteRisk && !remediationActive
                    ? 'purple'
                    : 'cyan'
              }`}
            >
              {gpsTelemetry.turnType === 'left' ? (
                <CornerUpLeft size={15} />
              ) : gpsTelemetry.turnType === 'right' ? (
                <CornerUpRight size={15} />
              ) : gpsTelemetry.turnType === 'arrived' ? (
                <Flag size={15} />
              ) : gpsTelemetry.turnType === 'uturn' ? (
                <Navigation size={15} />
              ) : (
                <ArrowUp size={15} />
              )}
            </span>
            <div className="gta-gps-text">
              <strong>{gpsTelemetry.turnCue}</strong>
              <span>
                {gpsTelemetry.turnType === 'arrived'
                  ? destRoomLabel
                  : `${gpsTelemetry.remainingMeters.toFixed(1)} m → ${destRoomLabel}`}
              </span>
            </div>
            <button
              type="button"
              data-testid="btn-gta-autowalk"
              className={`gta-autowalk-btn ${autoWalk ? 'active' : ''}`}
              onClick={toggleAutoWalkGps}
              title="Jalan otomatis di mode First Person mengikuti jalur GPS"
            >
              {autoWalk ? <Square size={11} /> : <Play size={11} />}
              <span>{autoWalk ? 'Jeda' : 'Auto-Jalan'}</span>
            </button>
          </div>
        )}

        <FloorplanMinimap
          floorBounds={activeFloor.floorBounds}
          rooms={floorRooms}
          walls={activeFloor.walls}
          hazards={hazards}
          selectedHazardId={selectedHazardId}
          routePath={routePath}
          showWayfinding={showWayfinding}
          hasRouteRisk={hasRouteRisk}
          remediationActive={remediationActive}
          isFirstPerson={cameraMode === 'firstperson'}
          cameraPose={cameraPose}
          onSelectHazard={onSelectHazard}
          onSelectRoom={onSelectRoom}
        />

        <button
          type="button"
          className="hazard-summary-pill"
          onClick={onOpenHazardSummary}
          data-testid="floating-hazard-pill"
        >
          <span className="hazard-pill-icon">
            <AlertTriangle size={14} />
          </span>
          <span>
            {unreviewedCount > 0
              ? `${unreviewedCount} potensi hambatan`
              : `${hazards.length} temuan ditinjau`}
          </span>
          <ChevronRight size={15} style={{ color: '#5A6B7C' }} />
        </button>
      </div>

      <div className="hud-bottom-hint no-print">
        {cameraMode === 'firstperson'
          ? 'Mode First Person: Drag untuk tengok 360° • WASD / Panah untuk jalan • Klik Auto-Jalan untuk ikuti GPS'
          : 'Drag kiri: putar • Scroll: zoom • WASD: jalan'}
      </div>
    </div>
  );
}
