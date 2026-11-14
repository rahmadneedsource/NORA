import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileImage,
  FileText,
  History,
  Layers,
  MapPin,
  Navigation,
  PlusCircle,
  RotateCcw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react';
import DollhouseViewport, { type CameraViewMode } from './components/DollhouseViewport';
import LayoutEditorPanel from './components/LayoutEditorPanel';
import {
  findSafeRoute,
  PILLAR_LABELS,
  PRESET_BLUEPRINTS,
  type FloorPlanSpec,
  type HazardFinding,
  type HouseBlueprint,
  type SteadiPillar,
} from './data/blueprints';
import {
  extractKeyframesFromVideo,
  readImagesAsKeyframes,
  type KeyframeSample,
} from './utils/videoFrames';
import {
  generateBlueprintAndAudit,
  type ScanInputKind,
  type VisionProvider,
} from './services/visionBlueprint';
import {
  estimateDepthForFrame,
  type DepthFrameSummary,
} from './utils/depthEstimator';

type MainTab = 'ruangan' | 'pindai' | 'riwayat';

interface BlueprintHistoryEntry {
  id: string;
  createdAt: string;
  areaName: string;
  provider: VisionProvider;
  summary: string;
  hazardCount: number;
  isFallbackDemo: boolean;
  blueprintSnapshot: HouseBlueprint;
}

const STORAGE_KEYS = {
  history: 'homesafe3d_blueprint_history_v2',
  geminiKey: 'homesafe3d_gemini_api_key',
  openaiKey: 'homesafe3d_openai_api_key',
};

function readStorage(key: string, fallback = ''): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (!value) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
}

function loadHistory(): BlueprintHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.history);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BlueprintHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function buildHazardsFromBlueprint(bp: HouseBlueprint): Record<string, HazardFinding[]> {
  const map: Record<string, HazardFinding[]> = {};
  for (const fl of bp.floors) {
    map[fl.id] = fl.hazards.map((h) => ({ ...h }));
  }
  return map;
}

function createDemoInspectionFrames(areaName: string): KeyframeSample[] {
  const shots = [
    { label: 'Sisi Tempat Tidur & Kabel', note: 'Kabel daya melintang dekat ambang pintu', accent: '#F4721E', t: 1.4 },
    { label: 'Koridor Malam Menuju Toilet', note: 'Pencahayaan koridor redup saat malam', accent: '#0D253F', t: 4.8 },
    { label: 'Area Kloset Kamar Mandi', note: 'Dinding samping belum memiliki grab bar', accent: '#4D6080', t: 8.6 },
    { label: 'Ruang Santai & Celah Jalan', note: 'Jarak sofa ke meja < 80 cm untuk walker', accent: '#2E7D5B', t: 12.1 },
  ];

  return shots.map((s, idx) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 480, 270);
      grad.addColorStop(0, '#F6EFE8');
      grad.addColorStop(1, '#E2D3C2');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 480, 270);

      ctx.strokeStyle = 'rgba(13, 37, 63, 0.16)';
      ctx.strokeRect(20, 20, 440, 230);

      ctx.fillStyle = s.accent;
      ctx.beginPath();
      ctx.arc(385, 138, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`#${idx + 1}`, 385, 144);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#0D253F';
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText(`${areaName} — Frame ${idx + 1}`, 36, 70);
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = '#4D6080';
      ctx.fillText(s.label, 36, 108);
      ctx.font = '13.5px sans-serif';
      ctx.fillStyle = '#364E66';
      ctx.fillText(s.note, 36, 136);
      ctx.fillText(`Keyframe Demo • t=${s.t.toFixed(1)}s`, 36, 224);
    }

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return {
      index: idx + 1,
      timeSec: s.t,
      name: `sample-room-${idx + 1}.jpg`,
      dataUrl,
      base64: dataUrl.split(',')[1] ?? '',
      mimeType: 'image/jpeg',
    };
  });
}

export default function App() {
  const [activeTab, setActiveTab] = useState<MainTab>('ruangan');

  const [blueprints, setBlueprints] = useState<HouseBlueprint[]>(PRESET_BLUEPRINTS);
  const [activeBlueprintId, setActiveBlueprintId] = useState<string>(PRESET_BLUEPRINTS[0].id);

  const activeBlueprint = useMemo(
    () => blueprints.find((b) => b.id === activeBlueprintId) ?? blueprints[0],
    [blueprints, activeBlueprintId],
  );

  const [activeFloorId, setActiveFloorId] = useState<string>(PRESET_BLUEPRINTS[0].floors[0].id);

  const activeFloor: FloorPlanSpec = useMemo(
    () =>
      activeBlueprint.floors.find((f) => f.id === activeFloorId) ?? activeBlueprint.floors[0],
    [activeBlueprint, activeFloorId],
  );

  const [hazardsByFloor, setHazardsByFloor] = useState<Record<string, HazardFinding[]>>(() =>
    buildHazardsFromBlueprint(PRESET_BLUEPRINTS[0]),
  );

  const [fromRoomId, setFromRoomId] = useState<string>(
    PRESET_BLUEPRINTS[0].floors[0].defaultFromRoomId,
  );
  const [toRoomId, setToRoomId] = useState<string>(
    PRESET_BLUEPRINTS[0].floors[0].defaultToRoomId,
  );

  const [selectedPillar, setSelectedPillar] = useState<SteadiPillar | 'all'>('all');
  const [selectedHazardId, setSelectedHazardId] = useState<string | null>(
    PRESET_BLUEPRINTS[0].floors[0].hazards[0]?.id ?? null,
  );

  const [cameraMode, setCameraMode] = useState<CameraViewMode>('iso');
  const [cameraFocusTick, setCameraFocusTick] = useState(0);
  const [resetCameraTick, setResetCameraTick] = useState(0);
  const [seniorNightLevel, setSeniorNightLevel] = useState(0);
  const [remediationActive, setRemediationActive] = useState(false);
  const [showWayfinding, setShowWayfinding] = useState(true);
  const [placingPinMode, setPlacingPinMode] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Tab Pindai states
  const [areaNameInput, setAreaNameInput] = useState('Inspeksi Ruangan');
  const [roomSizeHint, setRoomSizeHint] = useState('');
  const [layoutHint, setLayoutHint] = useState('');
  const [inputKind, setInputKind] = useState<ScanInputKind>('video');
  const [visionProvider, setVisionProvider] = useState<VisionProvider>('gemini');
  const [geminiApiKey, setGeminiApiKey] = useState(() => readStorage(STORAGE_KEYS.geminiKey));
  const [openaiApiKey, setOpenaiApiKey] = useState(() => readStorage(STORAGE_KEYS.openaiKey));
  const [keyframes, setKeyframes] = useState<KeyframeSample[]>([]);
  const [extractProgress, setExtractProgress] = useState<string | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);
  const [depthStatusMsg, setDepthStatusMsg] = useState<string | null>(null);
  const [showDepthMap, setShowDepthMap] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResultBanner, setAuditResultBanner] = useState<{
    summary: string;
    blueprintId: string;
    roomCount: number;
    hazardCount: number;
    isFallbackDemo: boolean;
  } | null>(null);

  // Tab Riwayat
  const [historyEntries, setHistoryEntries] = useState<BlueprintHistoryEntry[]>(loadHistory);

  const detailCardRef = useRef<HTMLElement | null>(null);

  const floorHazards = useMemo(
    () => hazardsByFloor[activeFloor.id] ?? activeFloor.hazards,
    [hazardsByFloor, activeFloor],
  );

  const filteredHazards = useMemo(() => {
    if (selectedPillar === 'all') return floorHazards;
    return floorHazards.filter((h) => h.pillar === selectedPillar);
  }, [floorHazards, selectedPillar]);

  const selectedHazard = useMemo(
    () => floorHazards.find((h) => h.id === selectedHazardId) ?? floorHazards[0] ?? null,
    [floorHazards, selectedHazardId],
  );

  const reviewedCount = useMemo(
    () => floorHazards.filter((h) => h.reviewed).length,
    [floorHazards],
  );

  const activeRoute = useMemo(
    () => findSafeRoute(activeFloor, fromRoomId, toRoomId, floorHazards),
    [activeFloor, fromRoomId, toRoomId, floorHazards],
  );

  const unreviewedRouteRisks = useMemo(
    () => activeRoute.hazardsOnRoute.filter((h) => !h.reviewed),
    [activeRoute.hazardsOnRoute],
  );

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  useEffect(() => () => stopSpeech(), [stopSpeech]);
  useEffect(() => writeStorage(STORAGE_KEYS.history, JSON.stringify(historyEntries)), [historyEntries]);
  useEffect(() => writeStorage(STORAGE_KEYS.geminiKey, geminiApiKey), [geminiApiKey]);
  useEffect(() => writeStorage(STORAGE_KEYS.openaiKey, openaiApiKey), [openaiApiKey]);

  const activateBlueprintFloor = useCallback(
    (bp: HouseBlueprint, floor: FloorPlanSpec, preserveFloorState = false) => {
      stopSpeech();
      setActiveBlueprintId(bp.id);
      setActiveFloorId(floor.id);
      if (!preserveFloorState) {
        setHazardsByFloor((prev) => ({
          ...prev,
          ...buildHazardsFromBlueprint(bp),
        }));
        setRemediationActive(false);
        setSeniorNightLevel(0);
      }
      setFromRoomId(floor.defaultFromRoomId);
      setToRoomId(floor.defaultToRoomId);
      setSelectedPillar('all');
      setSelectedHazardId(floor.hazards[0]?.id ?? null);
      setCameraMode('iso');
      setPlacingPinMode(false);
      setResetCameraTick((t) => t + 1);
    },
    [stopSpeech],
  );

  const handleSelectBlueprint = (bpId: string) => {
    const bp = blueprints.find((b) => b.id === bpId) ?? blueprints[0];
    activateBlueprintFloor(bp, bp.floors[0], Boolean(hazardsByFloor[bp.floors[0].id]));
  };

  const handleSelectFloor = (floorId: string) => {
    const floor = activeBlueprint.floors.find((f) => f.id === floorId);
    if (!floor) return;
    stopSpeech();
    setActiveFloorId(floor.id);
    if (!hazardsByFloor[floor.id]) {
      setHazardsByFloor((prev) => ({
        ...prev,
        [floor.id]: floor.hazards.map((h) => ({ ...h })),
      }));
    }
    setFromRoomId(floor.defaultFromRoomId);
    setToRoomId(floor.defaultToRoomId);
    setSelectedPillar('all');
    const nextList = hazardsByFloor[floor.id] ?? floor.hazards;
    setSelectedHazardId(nextList[0]?.id ?? null);
    setPlacingPinMode(false);
    setResetCameraTick((t) => t + 1);
  };

  const handleSelectRoom = (roomId: string) => {
    if (roomId !== fromRoomId) {
      setToRoomId(roomId);
    }
    const matchingHazard = floorHazards.find((h) => h.roomId === roomId);
    if (matchingHazard) {
      setSelectedHazardId(matchingHazard.id);
      setCameraFocusTick((t) => t + 1);
    }
  };

  const handleResetAll = () => {
    stopSpeech();
    const originalPreset = PRESET_BLUEPRINTS.find((p) => p.id === activeBlueprint.id);
    const resetFloor = originalPreset
      ? originalPreset.floors.find((f) => f.id === activeFloor.id) ?? originalPreset.floors[0]
      : activeFloor;

    if (originalPreset) {
      setBlueprints((prev) =>
        prev.map((bp) => (bp.id === originalPreset.id ? originalPreset : bp)),
      );
    }

    setHazardsByFloor((prev) => ({
      ...prev,
      [resetFloor.id]: resetFloor.hazards.map((h) => ({ ...h })),
    }));
    setFromRoomId(resetFloor.defaultFromRoomId);
    setToRoomId(resetFloor.defaultToRoomId);
    setSelectedPillar('all');
    setSelectedHazardId(resetFloor.hazards[0]?.id ?? null);
    setCameraMode('iso');
    setSeniorNightLevel(0);
    setRemediationActive(false);
    setShowWayfinding(true);
    setPlacingPinMode(false);
    setLayoutEditorOpen(false);
    setResetCameraTick((t) => t + 1);
  };

  const handleApplyManualFloorUpdate = useCallback(
    (nextFloor: FloorPlanSpec, nextHazards?: HazardFinding[]) => {
      const syncedFloor: FloorPlanSpec = nextHazards
        ? { ...nextFloor, hazards: nextHazards }
        : nextFloor;

      setBlueprints((prev) =>
        prev.map((bp) =>
          bp.id !== activeBlueprint.id
            ? bp
            : {
                ...bp,
                floors: bp.floors.map((fl) => (fl.id === syncedFloor.id ? syncedFloor : fl)),
              },
        ),
      );

      if (nextHazards) {
        setHazardsByFloor((prev) => ({
          ...prev,
          [syncedFloor.id]: nextHazards,
        }));
      }

      const roomIds = new Set(syncedFloor.rooms.map((r) => r.id));
      let nextFrom = roomIds.has(fromRoomId) ? fromRoomId : syncedFloor.defaultFromRoomId;
      let nextTo = roomIds.has(toRoomId) ? toRoomId : syncedFloor.defaultToRoomId;
      if (syncedFloor.rooms.length >= 2 && nextFrom === nextTo) {
        nextTo = syncedFloor.rooms.find((r) => r.id !== nextFrom)?.id ?? nextTo;
      }
      if (nextFrom !== fromRoomId) setFromRoomId(nextFrom);
      if (nextTo !== toRoomId) setToRoomId(nextTo);

      setHistoryEntries((prev) =>
        prev.map((entry) =>
          entry.blueprintSnapshot.id !== activeBlueprint.id
            ? entry
            : {
                ...entry,
                blueprintSnapshot: {
                  ...entry.blueprintSnapshot,
                  floors: entry.blueprintSnapshot.floors.map((fl) =>
                    fl.id === syncedFloor.id ? syncedFloor : fl,
                  ),
                },
              },
        ),
      );
    },
    [activeBlueprint.id, fromRoomId, toRoomId],
  );

  const handleToggleReviewed = (id: string) => {
    setHazardsByFloor((prev) => ({
      ...prev,
      [activeFloor.id]: (prev[activeFloor.id] ?? activeFloor.hazards).map((h) =>
        h.id === id ? { ...h, reviewed: !h.reviewed } : h,
      ),
    }));
  };

  const handleAddPinAt = (position: [number, number, number]) => {
    const cur = hazardsByFloor[activeFloor.id] ?? activeFloor.hazards;
    const nextNum = cur.length + 1;
    const newId = `pin-${Date.now().toString(36)}`;
    const newItem: HazardFinding = {
      id: newId,
      floorId: activeFloor.id,
      roomId: activeFloor.rooms[0]?.id ?? 'custom',
      title: `Temuan Caregiver #${nextNum} (Klik 3D)`,
      pillar: 'tripping',
      severity: 'moderate',
      position,
      clinicalRisk:
        'Titik risiko tambahan yang ditandai langsung oleh caregiver pada denah 3D Dollhouse.',
      observation: `Koordinat (${position[0].toFixed(2)}m, ${position[2].toFixed(
        2,
      )}m) di ${activeFloor.label}.`,
      remediation: 'Periksa objek atau pencahayaan di area ini dan rapikan bila perlu.',
      reviewed: false,
    };

    setHazardsByFloor((prev) => ({
      ...prev,
      [activeFloor.id]: [...cur, newItem],
    }));
    setSelectedPillar('all');
    setSelectedHazardId(newId);
    setPlacingPinMode(false);
  };

  const handleSpeakDetail = () => {
    if (!selectedHazard || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking) {
      stopSpeech();
      return;
    }
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(
      `Temuan ${selectedHazard.title}. Risiko: ${selectedHazard.clinicalRisk}. Saran perbaikan: ${selectedHazard.remediation}.`,
    );
    msg.lang = 'id-ID';
    msg.rate = 0.96;
    msg.onend = () => setIsSpeaking(false);
    msg.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(msg);
  };

  const handleVideoUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setInputKind('video');
    setAuditError(null);
    setAuditResultBanner(null);
    setExtractProgress('Mengekstrak keyframe video...');
    try {
      const samples = await extractKeyframesFromVideo(file, undefined, 720, (_d, _t, label) => {
        setExtractProgress(label);
      });
      setKeyframes(samples);
      setExtractProgress(`Siap: ${samples.length} keyframe dari ${file.name}`);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Gagal membaca file video.');
      setExtractProgress(null);
    } finally {
      ev.target.value = '';
    }
  };

  const handleImageUpload = async (
    ev: React.ChangeEvent<HTMLInputElement>,
    kind: 'photos' | 'floorplan2d',
  ) => {
    const files = ev.target.files ? Array.from(ev.target.files) : [];
    if (files.length === 0) return;
    setInputKind(kind);
    setAuditError(null);
    setAuditResultBanner(null);
    setExtractProgress(
      kind === 'floorplan2d' ? 'Memuat gambar denah 2D...' : 'Mengonversi foto ruangan...',
    );
    try {
      const samples = await readImagesAsKeyframes(files.slice(0, 12), 720);
      setKeyframes(samples);
      setExtractProgress(
        kind === 'floorplan2d'
          ? `Siap: denah 2D (${files[0].name}) siap dikonversi AI ke 3D.`
          : `Siap: ${samples.length} foto sudut ruangan dimuat.`,
      );
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Gagal membaca file gambar.');
      setExtractProgress(null);
    } finally {
      ev.target.value = '';
    }
  };

  const handleGenerateDemoFrames = () => {
    setInputKind('video');
    setAuditError(null);
    setAuditResultBanner(null);
    const samples = createDemoInspectionFrames(areaNameInput.trim() || 'Rumah Lansia');
    setKeyframes(samples);
    setExtractProgress(`Siap: ${samples.length} sampel keyframe inspeksi ruangan.`);
  };

  const handleRunAiBlueprint = async () => {
    if (keyframes.length === 0) {
      setAuditError('Unggah video, foto ruangan, denah 2D, atau klik Sampel Demo terlebih dahulu.');
      return;
    }

    setAuditRunning(true);
    setAuditError(null);
    setDepthStatusMsg(null);

    try {
      const activeKey =
        visionProvider === 'gemini'
          ? geminiApiKey
          : visionProvider === 'openai'
            ? openaiApiKey
            : '';

      // Layer 1: Depth Anything V2 ("Mirip LiDAR") di browser untuk ekstraksi jarak & clearance
      let depthProfiles: DepthFrameSummary[] | undefined;
      if (visionProvider !== 'demo') {
        try {
          const maxDepthFrames = Math.min(6, keyframes.length);
          const step = Math.max(1, Math.floor(keyframes.length / maxDepthFrames));
          const sampledIndices: number[] = [];
          for (let i = 0; i < keyframes.length && sampledIndices.length < maxDepthFrames; i += step) {
            sampledIndices.push(i);
          }
          const profiles: DepthFrameSummary[] = [];
          for (let k = 0; k < sampledIndices.length; k++) {
            const idx = sampledIndices[k];
            setDepthStatusMsg(
              `Layer 1 (Depth AI): Memetakan kedalaman frame ${k + 1}/${sampledIndices.length}...`,
            );
            const prof = await estimateDepthForFrame(keyframes[idx].dataUrl, keyframes[idx].index);
            profiles.push(prof);
          }
          depthProfiles = profiles;
        } catch (depthErr) {
          console.warn('Depth Anything V2 fallback (lanjut tanpa depth map):', depthErr);
        }
      }

      setDepthStatusMsg('Layer 2 & 3: Menyusun Blueprint + Manhattan Snap-to-Grid...');
      const res = await generateBlueprintAndAudit({
        provider: visionProvider,
        apiKey: activeKey,
        areaName: areaNameInput.trim() || 'Ruang Inspeksi',
        roomSizeHint: roomSizeHint.trim() || undefined,
        layoutHint: layoutHint.trim() || undefined,
        inputKind,
        frames: keyframes,
        depthProfiles,
      });

      const generatedBp = res.blueprint;
      const firstFloor = generatedBp.floors[0];

      setBlueprints((prev) => [generatedBp, ...prev]);
      activateBlueprintFloor(generatedBp, firstFloor, false);

      const historyItem: BlueprintHistoryEntry = {
        id: `hist-${Date.now().toString(36)}`,
        createdAt: new Date().toLocaleString('id-ID', {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
        areaName: areaNameInput.trim() || generatedBp.name,
        provider: res.providerUsed,
        summary: res.summary,
        hazardCount: firstFloor.hazards.length,
        isFallbackDemo: res.isFallbackDemo,
        blueprintSnapshot: generatedBp,
      };
      setHistoryEntries((prev) => [historyItem, ...prev.slice(0, 19)]);

      setAuditResultBanner({
        summary: res.summary,
        blueprintId: generatedBp.id,
        roomCount: firstFloor.rooms.length,
        hazardCount: firstFloor.hazards.length,
        isFallbackDemo: res.isFallbackDemo,
      });
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Gagal membuat blueprint 3D dari AI.');
    } finally {
      setAuditRunning(false);
      setDepthStatusMsg(null);
    }
  };

  const handleOpenHistoryBlueprint = (entry: BlueprintHistoryEntry) => {
    const bp = entry.blueprintSnapshot;
    setBlueprints((prev) => (prev.some((b) => b.id === bp.id) ? prev : [bp, ...prev]));
    activateBlueprintFloor(bp, bp.floors[0], false);
    setActiveTab('ruangan');
  };

  return (
    <div className="app-shell">
      <header className="topbar no-print">
        <div className="brand-block">
          <button
            type="button"
            className="nora-logo-btn"
            aria-label="Beranda NORA"
            onClick={() => setActiveTab('ruangan')}
          >
            <svg
              className="nora-logo-svg"
              viewBox="0 0 184 44"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              role="img"
              aria-label="NORA"
            >
              <path
                d="M5 38V6C5 4.34315 6.34315 3 8 3H11.2C12.35 3 13.4 3.65 13.92 4.68L29.1 30.8V6C29.1 4.34315 30.4431 3 32.1 3H35.6C37.2569 3 38.6 4.34315 38.6 6V38C38.6 39.6569 37.2569 41 35.6 41H32.5C31.35 41 30.3 40.35 29.78 39.32L14.5 13.1V38C14.5 39.6569 13.1569 41 11.5 41H8C6.34315 41 5 39.6569 5 38Z"
                fill="#0D253F"
              />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M66.5 2.5C54.902 2.5 45.5 11.2304 45.5 22C45.5 32.7696 54.902 41.5 66.5 41.5C78.098 41.5 87.5 32.7696 87.5 22C87.5 11.2304 78.098 2.5 66.5 2.5ZM66.5 11.2C60.0367 11.2 54.8 16.0353 54.8 22C54.8 27.9647 60.0367 32.8 66.5 32.8C72.9633 32.8 78.2 27.9647 78.2 22C78.2 16.0353 72.9633 11.2 66.5 11.2Z"
                fill="#0D253F"
              />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M95.5 6C95.5 4.34315 96.8431 3 98.5 3H114.2C122.926 3 129.2 8.48 129.2 16.1C129.2 21.75 125.75 26.15 120.35 27.95L128.45 36.75C129.85 38.28 128.76 41 126.68 41H121.9C120.85 41 119.86 40.54 119.18 39.75L110.5 29.4H104.9V38C104.9 39.6569 103.557 41 101.9 41H98.5C96.8431 41 95.5 39.6569 95.5 38V6ZM104.9 11.3V21.3H113.6C117.65 21.3 120.1 19.25 120.1 16.3C120.1 13.35 117.65 11.3 113.6 11.3H104.9Z"
                fill="#0D253F"
              />
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M153.2 4.8C153.72 3.68 154.84 3 156.08 3H159.42C160.66 3 161.78 3.68 162.3 4.8L177.8 37.3C178.68 39.15 177.33 41 175.28 41H171.3C170.05 41 168.92 40.28 168.42 39.14L165.45 32.5H149.95L146.98 39.14C146.48 40.28 145.35 41 144.1 41H140.22C138.17 41 136.82 39.15 137.7 37.3L153.2 4.8ZM157.7 14.3L153.15 24.6H162.25L157.7 14.3Z"
                fill="#0D253F"
              />
            </svg>
          </button>
          <span className="nora-status-pill">
            <span className="nora-status-dot" aria-hidden="true" />
            <span>{activeBlueprint.name}</span>
          </span>
        </div>

        <nav className="main-tabs" role="tablist" aria-label="Navigasi Utama NORA">
          <button
            type="button"
            role="tab"
            data-testid="tab-ruangan"
            aria-selected={activeTab === 'ruangan'}
            className={`main-tab ${activeTab === 'ruangan' ? 'active' : ''}`}
            onClick={() => setActiveTab('ruangan')}
          >
            <Layers size={15} />
            Ruangan
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-pindai"
            aria-selected={activeTab === 'pindai'}
            className={`main-tab ${activeTab === 'pindai' ? 'active' : ''}`}
            onClick={() => setActiveTab('pindai')}
          >
            <Video size={15} />
            Pindai
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-riwayat"
            aria-selected={activeTab === 'riwayat'}
            className={`main-tab ${activeTab === 'riwayat' ? 'active' : ''}`}
            onClick={() => setActiveTab('riwayat')}
          >
            <History size={15} />
            Riwayat
            {historyEntries.length > 0 && (
              <span className="tab-badge">{historyEntries.length}</span>
            )}
          </button>
        </nav>

        <div className="topbar-controls">
          <select
            aria-label="Pilih Denah Rumah"
            className="scene-select"
            value={activeBlueprint.id}
            onChange={(e) => handleSelectBlueprint(e.target.value)}
          >
            {blueprints.map((bp) => (
              <option key={bp.id} value={bp.id}>
                {bp.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setActiveTab('pindai')}
          >
            <Camera size={14} />
            <span>Buat dari Foto/Video</span>
          </button>

          <button type="button" className="btn-ghost" onClick={handleResetAll}>
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      <main className="workspace-body no-print">
        {activeTab === 'ruangan' && (
          <div className="ruangan-layout">
            <section className="viewport-column" aria-label="Viewport Dollhouse 3D">
              <DollhouseViewport
                floors={activeBlueprint.floors}
                activeFloor={activeFloor}
                hazards={filteredHazards}
                selectedHazardId={selectedHazard?.id ?? null}
                fromRoomId={fromRoomId}
                toRoomId={toRoomId}
                routePath={activeRoute.points}
                hasRouteRisk={unreviewedRouteRisks.length > 0}
                cameraMode={cameraMode}
                cameraFocusTick={cameraFocusTick}
                resetCameraTick={resetCameraTick}
                seniorNightLevel={seniorNightLevel}
                remediationActive={remediationActive}
                showWayfinding={showWayfinding}
                placingPinMode={placingPinMode}
                onSelectFloor={handleSelectFloor}
                onSelectRoom={handleSelectRoom}
                onSelectHazard={(id) => {
                  setSelectedHazardId(id);
                  setCameraFocusTick((t) => t + 1);
                  setPlacingPinMode(false);
                }}
                onAddPinAt={handleAddPinAt}
                onCameraModeChange={setCameraMode}
                onResetCamera={() => setResetCameraTick((t) => t + 1)}
                onOpenHazardSummary={() =>
                  detailCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
              />

              <div className="viewport-statusbar">
                <span>
                  {activeFloor.rooms.length} zona ruang • Pure Three.js Parametric Dollhouse (60 FPS)
                </span>
                <span>
                  {placingPinMode
                    ? 'Mode Pin Aktif: Klik titik lantai pada denah 3D'
                    : activeBlueprint.subtitle}
                </span>
              </div>
            </section>

            <aside className="right-panel" aria-label="Panel Audit Klinis Caregiver">
              {!layoutEditorOpen ? (
                <div className="layout-launch-bar">
                  <div>
                    <strong>Sesuaikan Denah Manual</strong>
                    <span>Geser ruang, ukur ulang, putar furnitur &amp; pintu</span>
                  </div>
                  <button
                    type="button"
                    data-testid="btn-toggle-layout-editor"
                    className="btn-secondary"
                    onClick={() => setLayoutEditorOpen(true)}
                  >
                    <SlidersHorizontal size={14} />
                    <span>Atur Layout</span>
                  </button>
                </div>
              ) : (
                <LayoutEditorPanel
                  key={`${activeBlueprint.id}::${activeFloor.id}`}
                  floor={activeFloor}
                  hazards={floorHazards}
                  onApplyFloorUpdate={handleApplyManualFloorUpdate}
                  onClose={() => setLayoutEditorOpen(false)}
                />
              )}

              {/* 1. Navigasi Rute Aman (Dari -> Ke) */}
              <section className="panel-card">
                <div className="card-header-row">
                  <div>
                    <h2 className="card-title">Navigasi Rute Aman Lansia</h2>
                    <p className="card-sub">Simulasi lintasan harian antar ruangan di lantai ini</p>
                  </div>
                  <Navigation size={16} className="icon-muted" />
                </div>

                <div className="route-select-grid">
                  <div className="form-group compact">
                    <label htmlFor="route-from-select">Dari Ruangan</label>
                    <select
                      id="route-from-select"
                      aria-label="Dari Ruangan"
                      value={fromRoomId}
                      onChange={(e) => setFromRoomId(e.target.value)}
                    >
                      {activeFloor.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group compact">
                    <label htmlFor="route-to-select">Ke Ruangan</label>
                    <select
                      id="route-to-select"
                      aria-label="Ke Ruangan"
                      value={toRoomId}
                      onChange={(e) => setToRoomId(e.target.value)}
                    >
                      {activeFloor.rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={`route-status-pill ${unreviewedRouteRisks.length > 0 ? 'warn' : 'ok'}`}>
                  {unreviewedRouteRisks.length > 0
                    ? `${unreviewedRouteRisks.length} hambatan berada di sepanjang jalur ini`
                    : 'Semua titik di jalur terpilih sudah ditinjau / aman'}
                </div>
              </section>

              {/* 2. Daftar Risiko CDC STEADI */}
              <section className="panel-card">
                <div className="card-header-row">
                  <div>
                    <h2 className="card-title">
                      Titik Untuk Ditinjau ({reviewedCount}/{floorHazards.length})
                    </h2>
                    <p className="card-sub">4 pilar pencegahan jatuh CDC STEADI</p>
                  </div>
                  <button
                    type="button"
                    className={`btn-chip ${placingPinMode ? 'active' : ''}`}
                    onClick={() => setPlacingPinMode((v) => !v)}
                  >
                    <PlusCircle size={14} />
                    <span>{placingPinMode ? 'Batal Pin' : 'Tambah Pin'}</span>
                  </button>
                </div>

                <div className="pillar-pills" role="group" aria-label="Filter Pilar CDC STEADI">
                  <button
                    type="button"
                    className={`pillar-pill ${selectedPillar === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedPillar('all')}
                  >
                    Semua
                  </button>
                  {(Object.keys(PILLAR_LABELS) as SteadiPillar[]).map((pillar) => (
                    <button
                      key={pillar}
                      type="button"
                      className={`pillar-pill ${selectedPillar === pillar ? 'active' : ''}`}
                      onClick={() => setSelectedPillar(pillar)}
                    >
                      {PILLAR_LABELS[pillar]}
                    </button>
                  ))}
                </div>

                <div className="hazard-list">
                  {filteredHazards.map((hazard) => {
                    const idx = floorHazards.findIndex((h) => h.id === hazard.id) + 1;
                    const active = selectedHazard?.id === hazard.id;
                    return (
                      <button
                        key={hazard.id}
                        type="button"
                        data-testid={`hazard-card-${hazard.id}`}
                        className={`hazard-item ${active ? 'active' : ''} ${
                          hazard.reviewed ? 'reviewed' : ''
                        }`}
                        onClick={() => {
                          setSelectedHazardId(hazard.id);
                          setCameraFocusTick((t) => t + 1);
                          setPlacingPinMode(false);
                        }}
                      >
                        <span className="hazard-index">#{idx}</span>
                        <div className="hazard-item-body">
                          <div className="hazard-item-top">
                            <span
                              className={`severity-tag ${
                                hazard.reviewed ? 'done' : hazard.severity
                              }`}
                            >
                              {hazard.reviewed
                                ? 'Ditinjau'
                                : hazard.severity === 'critical'
                                  ? 'Kritis'
                                  : 'Sedang'}
                            </span>
                            <span className="pillar-mini">{PILLAR_LABELS[hazard.pillar]}</span>
                          </div>
                          <div className="hazard-item-title">{hazard.title}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 3. Detail Temuan Klinis */}
              {selectedHazard && (
                <section className="panel-card detail-card" ref={detailCardRef}>
                  <div className="card-header-row">
                    <div>
                      <div className="eyebrow">Detail Temuan Klinis</div>
                      <h3 className="detail-title">{selectedHazard.title}</h3>
                    </div>
                    <button
                      type="button"
                      className={`btn-chip ${isSpeaking ? 'active' : ''}`}
                      onClick={handleSpeakDetail}
                    >
                      {isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
                      <span>{isSpeaking ? 'Hentikan' : 'Bacakan'}</span>
                    </button>
                  </div>

                  {selectedHazard.evidenceImageUrl && (
                    <div className="evidence-box">
                      {selectedHazard.depthHeatmapUrl && (
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                          <button
                            type="button"
                            className={`btn-chip ${!showDepthMap ? 'active' : ''}`}
                            onClick={() => setShowDepthMap(false)}
                          >
                            Foto Asli
                          </button>
                          <button
                            type="button"
                            data-testid="btn-toggle-depth-map"
                            className={`btn-chip ${showDepthMap ? 'active' : ''}`}
                            onClick={() => setShowDepthMap(true)}
                          >
                            Depth Map (LiDAR AI)
                          </button>
                        </div>
                      )}
                      <img
                        src={
                          showDepthMap && selectedHazard.depthHeatmapUrl
                            ? selectedHazard.depthHeatmapUrl
                            : selectedHazard.evidenceImageUrl
                        }
                        alt={
                          showDepthMap && selectedHazard.depthHeatmapUrl
                            ? `Depth Map Frame #${selectedHazard.evidenceFrameIndex ?? 1}`
                            : `Bukti Foto Frame #${selectedHazard.evidenceFrameIndex ?? 1}`
                        }
                      />
                      <span>
                        {showDepthMap && selectedHazard.depthHeatmapUrl
                          ? `Depth Map (LiDAR AI) • Frame #${selectedHazard.evidenceFrameIndex ?? 1}`
                          : `Bukti Foto Asli • Frame #${selectedHazard.evidenceFrameIndex ?? 1}`}
                      </span>
                      {selectedHazard.depthSummary && (
                        <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', opacity: 0.85 }}>
                          {selectedHazard.depthSummary}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="clinical-block">
                    <div className="clinical-label">Risiko Lansia</div>
                    <p>{selectedHazard.clinicalRisk}</p>
                  </div>

                  <div className="clinical-block">
                    <div className="clinical-label">Observasi Lokasi</div>
                    <p>{selectedHazard.observation}</p>
                  </div>

                  <div className="clinical-block remediation-box">
                    <div className="clinical-label">Rekomendasi Remediasi</div>
                    <p>{selectedHazard.remediation}</p>
                  </div>

                  <div className="detail-footer" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className={`btn-review ${selectedHazard.reviewed ? 'done' : ''}`}
                      onClick={() => handleToggleReviewed(selectedHazard.id)}
                    >
                      <CheckCircle2 size={15} />
                      <span>
                        {selectedHazard.reviewed ? 'Sudah Ditinjau' : 'Tandai Sudah Ditinjau'}
                      </span>
                    </button>
                  </div>
                </section>
              )}

              {/* 4. Simulator Klinis 3D */}
              <section className="panel-card">
                <div className="card-header-row">
                  <div>
                    <h2 className="card-title">Simulator Klinis 3D</h2>
                    <p className="card-sub">
                      Uji penglihatan redup & perubahan objek Before vs After nyata
                    </p>
                  </div>
                  <Activity size={16} className="icon-muted" />
                </div>

                <div className="sim-control">
                  <div className="sim-row">
                    <label htmlFor="senior-eye-range" className="sim-label">
                      <span>Senior Eye Night Vision</span>
                    </label>
                    <span className="sim-value">{seniorNightLevel}%</span>
                  </div>
                  <input
                    id="senior-eye-range"
                    aria-label="Senior Eye Night Vision"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={seniorNightLevel}
                    onChange={(e) => setSeniorNightLevel(Number(e.target.value))}
                  />
                </div>

                <div className="sim-toggle-grid">
                  <button
                    type="button"
                    aria-pressed={remediationActive}
                    className={`sim-toggle-btn ${remediationActive ? 'active' : ''}`}
                    onClick={() => setRemediationActive((v) => !v)}
                  >
                    <Sparkles size={14} />
                    <span>{remediationActive ? 'After Remediation: ON' : 'Before vs After'}</span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={showWayfinding}
                    className={`sim-toggle-btn ${showWayfinding ? 'active' : ''}`}
                    onClick={() => setShowWayfinding((v) => !v)}
                  >
                    <Route size={14} />
                    <span>{showWayfinding ? 'Jalur Aman: ON' : 'Jalur Aman: OFF'}</span>
                  </button>
                </div>
              </section>
            </aside>
          </div>
        )}

        {activeTab === 'pindai' && (
          <div className="subpage-container">
            <section className="subpage-card single-wide">
              <div className="subpage-header">
                <div className="subpage-icon">
                  <Camera size={20} />
                </div>
                <div>
                  <h2>Pindai Ruangan / Denah 2D → Generate Dollhouse 3D (AI)</h2>
                  <p>
                    Ekstrak keyframe video, foto sudut ruangan, atau sketsa denah 2D langsung di
                    browser — tanpa GPU server atau Gaussian Splatting.
                  </p>
                </div>
              </div>

              <div className="honest-notice">
                <ShieldCheck size={16} />
                <div>
                  <strong>Privasi, Efisiensi &amp; Transparansi AI:</strong> Browser hanya
                  mengekstrak <strong>8–14 keyframe tajam</strong> (menyaring frame blur/tembok
                  polos, bukan mengirim file video besar), diproses sementara lewat proxy aman
                  tanpa disimpan di server. Riwayat audit hanya tersimpan lokal di browser Anda (
                  <code>localStorage</code>).
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="scan-area-input">Nama Rumah / Area Inspeksi</label>
                <input
                  id="scan-area-input"
                  type="text"
                  value={areaNameInput}
                  onChange={(e) => setAreaNameInput(e.target.value)}
                  placeholder="Contoh: Kamar Mandi, Kamar Tidur, atau Ruang Tamu"
                />
              </div>

              <div className="form-group">
                <label htmlFor="scan-size-input">
                  Perkiraan Ukuran Area (Opsional — untuk akurasi skala)
                </label>
                <input
                  id="scan-size-input"
                  type="text"
                  value={roomSizeHint}
                  onChange={(e) => setRoomSizeHint(e.target.value)}
                  placeholder="Misal: 2m x 3m (kosongkan agar AI mengestimasi dari ubin/pintu)"
                />
              </div>

              <div className="form-group">
                <label htmlFor="scan-layout-input">
                  Keterangan Letak &amp; Susunan Denah (Opsional — agar denah 3D lebih mirip)
                </label>
                <textarea
                  id="scan-layout-input"
                  data-testid="input-layout-hint"
                  rows={2}
                  value={layoutHint}
                  onChange={(e) => setLayoutHint(e.target.value)}
                  placeholder="Misal: Pintu masuk di depan -> kamar tidur (kasur di kanan, meja kerja di kiri) -> belakang ada lorong rak -> belok kanan ke dapur kecil..."
                  style={{
                    width: '100%',
                    padding: '9px 11px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    background: '#fff',
                    fontFamily: 'inherit',
                    fontSize: '12.5px',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {[
                    'Bentuk lurus: area depan -> pintu -> ruangan belakang',
                    'Bentuk L (belok kiri): ruang utama -> lorong -> belok kiri',
                    'Bentuk L (belok kanan): kamar -> lorong -> belok kanan ke dapur/toilet',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn-chip"
                      style={{ fontSize: '11px', padding: '4px 9px' }}
                      onClick={() =>
                        setLayoutHint((prev) =>
                          prev.trim() ? `${prev.trim()}; ${preset}` : preset,
                        )
                      }
                    >
                      + {preset.split(':')[0]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="upload-actions-row">
                <label className="btn-secondary upload-btn">
                  <Video size={15} />
                  <span>Pilih Video (.mp4/.mov)</span>
                  <input type="file" accept="video/*" onChange={handleVideoUpload} hidden />
                </label>

                <label className="btn-secondary upload-btn">
                  <Camera size={15} />
                  <span>Pilih Foto Ruangan</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => handleImageUpload(e, 'photos')}
                    hidden
                  />
                </label>

                <label className="btn-secondary upload-btn">
                  <FileImage size={15} />
                  <span>Unggah Denah 2D / Sketsa</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e, 'floorplan2d')}
                    hidden
                  />
                </label>

                <button
                  type="button"
                  className="btn-chip"
                  data-testid="btn-demo-keyframes"
                  onClick={handleGenerateDemoFrames}
                >
                  <Sparkles size={14} />
                  <span>Gunakan Sampel Keyframe Demo</span>
                </button>
              </div>

              {extractProgress && <div className="progress-banner">{extractProgress}</div>}

              {keyframes.length > 0 && (
                <div className="keyframe-grid">
                  {keyframes.map((kf) => (
                    <div key={kf.index} className="keyframe-card">
                      <img src={kf.dataUrl} alt={kf.name} />
                      <div className="keyframe-meta">
                        <span>Frame #{kf.index}</span>
                        <span>{kf.timeSec.toFixed(1)}s</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="provider-box">
                <div className="form-group">
                  <label htmlFor="vision-provider-select">Engine Vision AI</label>
                  <select
                    id="vision-provider-select"
                    value={visionProvider}
                    onChange={(e) => setVisionProvider(e.target.value as VisionProvider)}
                  >
                    <option value="gemini">
                      Google Gemini Vision (Otomatis Server Proxy + Fallback)
                    </option>
                    <option value="openai">OpenAI GPT-4o-mini Vision (Server / API Key)</option>
                    <option value="demo">
                      Demo Offline (Generate Blueprint 3D Simulasi Tanpa API Key)
                    </option>
                  </select>
                </div>

                {visionProvider === 'gemini' && (
                  <div className="form-group">
                    <label htmlFor="gemini-key-input">
                      Gemini API Key Opsional (Kosongkan untuk pakai server proxy)
                    </label>
                    <input
                      id="gemini-key-input"
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="Opsional — server .env sudah siap..."
                    />
                  </div>
                )}

                {visionProvider === 'openai' && (
                  <div className="form-group">
                    <label htmlFor="openai-key-input">
                      OpenAI API Key Opsional (Disimpan lokal di browser)
                    </label>
                    <input
                      id="openai-key-input"
                      type="password"
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                  </div>
                )}
              </div>

              {auditError && (
                <div className="scene-error-banner" role="alert">
                  <AlertTriangle size={15} />
                  <span>{auditError}</span>
                </div>
              )}

              {depthStatusMsg && (
                <div className="progress-banner">
                  <Sparkles size={15} />
                  <span>{depthStatusMsg}</span>
                </div>
              )}

              <div className="pindai-footer-cta">
                <button
                  type="button"
                  data-testid="btn-run-vision-audit"
                  className="btn-primary"
                  disabled={auditRunning}
                  onClick={handleRunAiBlueprint}
                >
                  <Sparkles size={15} />
                  <span>
                    {auditRunning
                      ? 'Memproses Depth AI + Blueprint...'
                      : 'Generate Denah 3D + Audit AI'}
                  </span>
                </button>

                {auditResultBanner && (
                  <button
                    type="button"
                    data-testid="btn-open-generated-3d"
                    className="btn-secondary"
                    onClick={() => setActiveTab('ruangan')}
                  >
                    <MapPin size={15} />
                    <span>
                      Buka Denah 3D Baru ({auditResultBanner.roomCount} ruang,{' '}
                      {auditResultBanner.hazardCount} pin)
                    </span>
                  </button>
                )}
              </div>

              {auditResultBanner && (
                <div className="audit-result-box" data-testid="vision-audit-result">
                  <div>
                    <strong>
                      Denah 3D Berhasil Dibuat ({auditResultBanner.roomCount} ruangan •{' '}
                      {auditResultBanner.hazardCount} temuan STEADI •{' '}
                      {auditResultBanner.isFallbackDemo ? 'Mode Demo Offline' : visionProvider})
                    </strong>
                  </div>
                  <p>{auditResultBanner.summary}</p>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'riwayat' && (
          <div className="subpage-container">
            <section className="subpage-card single-wide">
              <div className="card-header-row">
                <div className="subpage-header">
                  <div className="subpage-icon">
                    <History size={20} />
                  </div>
                  <div>
                    <h2>Riwayat Denah & Audit Rumah ({historyEntries.length})</h2>
                    <p>
                      Setiap blueprint 3D Dollhouse hasil AI tersimpan otomatis di browser
                      (localStorage).
                    </p>
                  </div>
                </div>

                {historyEntries.length > 0 && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setHistoryEntries([])}
                  >
                    <Trash2 size={14} />
                    <span>Hapus Semua</span>
                  </button>
                )}
              </div>

              {historyEntries.length === 0 ? (
                <div className="empty-history">
                  <FileText size={28} />
                  <p>
                    Belum ada riwayat blueprint AI. Buka tab <strong>Pindai</strong> untuk
                    membuat denah 3D Dollhouse dari foto/video/denah 2D.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setActiveTab('pindai')}
                  >
                    Buka Tab Pindai
                  </button>
                </div>
              ) : (
                <div className="history-list" data-testid="history-list">
                  {historyEntries.map((entry) => (
                    <article key={entry.id} className="history-card">
                      <div className="history-top">
                        <div>
                          <span className="history-date">{entry.createdAt}</span>
                          <h3>{entry.areaName}</h3>
                          <div className="history-room">
                            {entry.blueprintSnapshot.floors[0]?.rooms.length ?? 0} ruangan •{' '}
                            {entry.hazardCount} temuan
                          </div>
                        </div>
                        <span className="provider-badge">
                          {entry.isFallbackDemo ? 'Demo Offline' : entry.provider}
                        </span>
                      </div>

                      <p className="history-summary">{entry.summary}</p>

                      <div className="history-footer" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleOpenHistoryBlueprint(entry)}
                        >
                          Buka Denah 3D
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
