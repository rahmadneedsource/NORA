export interface KeyframeSample {
  index: number;
  timeSec: number;
  name: string;
  dataUrl: string;
  base64: string;
  mimeType: 'image/jpeg';
  panHint?: string;
}

function waitForVideoEvent(
  target: EventTarget,
  eventName: string,
  timeoutMs = 12000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout menunggu event video: ${eventName}`));
    }, timeoutMs);

    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Gagal membaca video saat ${eventName}`));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener('error', onError);
    };

    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

interface CandidateFrame {
  timeSec: number;
  dataUrl: string;
  base64: string;
  score: number;
  sig: number[];
}

function analyzeFrameQuality(
  probeCtx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  pw = 32,
  ph = 32,
): { score: number; sig: number[] } {
  probeCtx.drawImage(video, 0, 0, pw, ph);
  const { data } = probeCtx.getImageData(0, 0, pw, ph);
  const n = pw * ph;
  const luma = new Float32Array(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const y = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    luma[i] = y;
    sum += y;
  }

  const mean = sum / n;
  let variance = 0;
  let edgeSum = 0;
  for (let r = 0; r < ph; r++) {
    for (let c = 0; c < pw; c++) {
      const i = r * pw + c;
      const diff = luma[i] - mean;
      variance += diff * diff;
      if (c + 1 < pw) edgeSum += Math.abs(luma[i] - luma[i + 1]);
      if (r + 1 < ph) edgeSum += Math.abs(luma[i] - luma[i + pw]);
    }
  }

  const stdDev = Math.sqrt(variance / n);
  const sharpness = edgeSum / (n * 2);
  // Penalize near-solid walls (low stdDev) & blurry frames (low sharpness)
  const score = stdDev * 0.65 + sharpness * 1.35;

  // Compact 8x8 signature for novelty comparison
  const sig: number[] = [];
  const stepR = ph / 8;
  const stepC = pw / 8;
  for (let br = 0; br < 8; br++) {
    for (let bc = 0; bc < 8; bc++) {
      const r = Math.floor(br * stepR + stepR / 2);
      const c = Math.floor(bc * stepC + stepC / 2);
      sig.push(luma[r * pw + c]);
    }
  }

  return { score, sig };
}

function frameDistance(a: number[], b: number[]): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return diff / Math.max(1, a.length);
}

/**
 * Estimasi arah gerak kamera horizontal (kiri/lurus/kanan/transisi) antar frame berurutan
 * memakai pergeseran kolom pada signature luma 8x8 untuk membantu Gemini membaca belokan koridor.
 */
function estimateTurnHint(prevSig: number[], currSig: number[]): string {
  let bestShift = 0;
  let bestErr = Infinity;
  for (let shift = -2; shift <= 2; shift++) {
    let err = 0;
    let cnt = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const pc = c + shift;
        if (pc < 0 || pc >= 8) continue;
        err += Math.abs(prevSig[r * 8 + pc] - currSig[r * 8 + c]);
        cnt++;
      }
    }
    const meanErr = err / Math.max(1, cnt);
    if (meanErr < bestErr) {
      bestErr = meanErr;
      bestShift = shift;
    }
  }
  if (bestErr > 36) return 'Transisi ke zona baru / perubahan sudut tajam';
  if (bestShift <= -1) return 'Kamera pan/belok ke KIRI';
  if (bestShift >= 1) return 'Kamera pan/belok ke KANAN';
  return 'Kamera bergerak LURUS / maju';
}

/**
 * Ekstrak keyframe adaptif (hingga 14 frame tajam & non-duplikat) di browser tanpa membebani server.
 */
export async function extractKeyframesFromVideo(
  videoFile: File,
  maxFrames?: number,
  maxDimension = 896,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<KeyframeSample[]> {
  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    onProgress?.(0, maxFrames ?? 12, 'Membaca metadata video...');
    await waitForVideoEvent(video, 'loadedmetadata', 15000);

    if (!video.videoWidth || !video.videoHeight) {
      await waitForVideoEvent(video, 'loadeddata', 3500).catch(() => {});
    }

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if ((!srcW || !srcH) && duration > 0) {
      throw new Error(
        'Codec video (misal HEVC/H.265 dari iPhone .MOV) tidak didukung browser ini. Gunakan MP4 (H.264) atau unggah 3–6 foto ruangan.',
      );
    }
    if (!srcW || !srcH || duration <= 0) {
      throw new Error('Video tidak memiliki dimensi atau durasi yang valid.');
    }

    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
    const width = Math.max(2, Math.round((srcW * scale) / 2) * 2);
    const height = Math.max(2, Math.round((srcH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context tidak tersedia.');

    const probeCanvas = document.createElement('canvas');
    probeCanvas.width = 32;
    probeCanvas.height = 32;
    const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
    if (!probeCtx) throw new Error('Probe Canvas 2D context tidak tersedia.');

    const autoCount = Math.min(14, Math.max(8, Math.round(duration / 3)));
    const targetCount = maxFrames ? Math.max(2, Math.min(14, maxFrames)) : autoCount;
    const candidateCount = Math.min(26, Math.max(targetCount + 4, targetCount * 2));

    const startT = Math.min(0.15, duration * 0.03);
    const endT = Math.max(startT, duration - Math.min(0.15, duration * 0.03));
    const candidates: CandidateFrame[] = [];

    for (let i = 0; i < candidateCount; i++) {
      const frac = candidateCount === 1 ? 0 : i / (candidateCount - 1);
      const t = startT + frac * (endT - startT);
      const seekPromise = waitForVideoEvent(video, 'seeked', 10000);
      video.currentTime = t;
      await seekPromise;

      const { score, sig } = analyzeFrameQuality(probeCtx, video);
      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1] ?? '';

      candidates.push({
        timeSec: Number(t.toFixed(1)),
        dataUrl,
        base64,
        score,
        sig,
      });
      onProgress?.(
        i + 1,
        candidateCount,
        `Memindai kandidat frame ${i + 1}/${candidateCount} (${t.toFixed(1)} dtk)`,
      );
    }

    // Greedy selection: prioritize sharp, high-contrast, visually distinct frames
    const selected: CandidateFrame[] = [];
    const remaining = [...candidates];

    while (selected.length < targetCount && remaining.length > 0) {
      let bestIdx = 0;
      let bestCombined = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const minDist =
          selected.length === 0
            ? 35
            : Math.min(...selected.map((s) => frameDistance(cand.sig, s.sig)));
        // Combine sharpness/contrast with visual novelty over already chosen frames
        const combined = cand.score + Math.min(35, minDist) * 1.1;
        if (combined > bestCombined) {
          bestCombined = combined;
          bestIdx = i;
        }
      }

      selected.push(remaining.splice(bestIdx, 1)[0]);
    }

    // Sort chronologically so Vision AI understands walk-through order
    selected.sort((a, b) => a.timeSec - b.timeSec);

    return selected.map((c, idx) => ({
      index: idx + 1,
      timeSec: c.timeSec,
      name: `frame_${String(idx + 1).padStart(2, '0')}.jpg`,
      dataUrl: c.dataUrl,
      base64: c.base64,
      mimeType: 'image/jpeg',
      panHint: idx === 0 ? 'Posisi awal kamera' : estimateTurnHint(selected[idx - 1].sig, c.sig),
    }));
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Konversi file gambar (.jpg/.png/.webp) langsung menjadi KeyframeSample untuk Vision AI.
 */
export async function readImagesAsKeyframes(
  imageFiles: File[],
  maxDimension = 896,
): Promise<KeyframeSample[]> {
  const limited = imageFiles.slice(0, 12);
  const samples: KeyframeSample[] = [];

  for (let i = 0; i < limited.length; i++) {
    const file = limited[i];
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`Gagal memuat gambar ${file.name}`));
        el.src = url;
      });
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round(img.width * scale));
      canvas.height = Math.max(2, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D tidak tersedia.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = dataUrl.split(',')[1] ?? '';
      samples.push({
        index: i + 1,
        timeSec: i,
        name: file.name,
        dataUrl,
        base64,
        mimeType: 'image/jpeg',
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return samples;
}
