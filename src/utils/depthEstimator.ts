import { env, pipeline } from '@huggingface/transformers';

if (env) {
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.0/dist/';
    env.backends.onnx.wasm.numThreads = 1;
  }
}

export interface DepthFrameSummary {
  /** 1-based keyframe index matching KeyframeSample.index & Gemini evidenceFrameIndex */
  frameIndex: number;
  heatmapDataUrl: string;
  nearRatio: number;
  centerClearanceScore: number;
  floorStepScore: number;
  estCorridorWidthM: number;
  doorwayDetected: boolean;
  clearanceLabel: 'Sempit (< 0.9 m)' | 'Sedang (0.9–1.3 m)' | 'Lega (> 1.3 m)';
  summaryText: string;
}

type DepthPipelineFn = (
  image: string,
) => Promise<{
  predicted_depth: { dims: number[]; data: Float32Array };
  depth: { data: Uint8Array; width: number; height: number };
}>;

let estimatorPromise: Promise<DepthPipelineFn> | null = null;

async function getDepthEstimator(): Promise<DepthPipelineFn> {
  if (!estimatorPromise) {
    const loadPromise = pipeline(
      'depth-estimation',
      'onnx-community/depth-anything-v2-small',
      { dtype: 'q8' },
    ) as unknown as Promise<DepthPipelineFn>;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Depth Anything V2 model load timeout (75s)')), 75000),
    );
    estimatorPromise = Promise.race([loadPromise, timeoutPromise]).catch((err) => {
      estimatorPromise = null;
      throw err;
    });
  }
  return estimatorPromise;
}

function depthValueToTurboRgb(t: number): [number, number, number] {
  // t in [0..1] where 1 = near (warm orange/amber), 0 = far (deep slate blue)
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped > 0.72) {
    const k = (clamped - 0.72) / 0.28;
    return [Math.round(244 + 11 * k), Math.round(114 - 44 * k), Math.round(30 - 10 * k)];
  }
  if (clamped > 0.4) {
    const k = (clamped - 0.4) / 0.32;
    return [Math.round(92 + 152 * k), Math.round(168 - 54 * k), Math.round(145 - 115 * k)];
  }
  const k = clamped / 0.4;
  return [Math.round(13 + 79 * k), Math.round(37 + 131 * k), Math.round(63 + 82 * k)];
}

function renderHeatmapDataUrl(
  rawDepth: Uint8Array,
  width: number,
  height: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imgData = ctx.createImageData(width, height);
  const out = imgData.data;
  for (let i = 0; i < width * height; i++) {
    const norm = rawDepth[i] / 255;
    const [r, g, b] = depthValueToTurboRgb(norm);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Jalankan Depth Anything V2 (LiDAR AI) di browser pada keyframe gambar
 * untuk menghasilkan heatmap kedalaman & profil jarak jalur jalan.
 */
export async function estimateDepthForFrame(
  dataUrl: string,
  frameIndex: number,
): Promise<DepthFrameSummary> {
  const estimator = await getDepthEstimator();
  const out = await estimator(dataUrl);

  const w = out.depth.width;
  const h = out.depth.height;
  const pred = out.predicted_depth.data;

  // Normalize predicted_depth to [0..1] (higher = closer to camera in Depth Anything V2)
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] < minV) minV = pred[i];
    if (pred[i] > maxV) maxV = pred[i];
  }
  const span = Math.max(1e-5, maxV - minV);

  let leftSum = 0;
  let leftCnt = 0;
  let centerSum = 0;
  let centerCnt = 0;
  let rightSum = 0;
  let rightCnt = 0;
  let nearCnt = 0;
  let floorGradSum = 0;
  let floorGradCnt = 0;

  const yStart = Math.floor(h * 0.45);
  const yEnd = Math.floor(h * 0.92);
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const val = (pred[idx] - minV) / span;
      if (val > 0.68) nearCnt++;

      const rx = x / w;
      if (rx < 0.3) {
        leftSum += val;
        leftCnt++;
      } else if (rx > 0.7) {
        rightSum += val;
        rightCnt++;
      } else {
        centerSum += val;
        centerCnt++;
      }

      if (y + 1 < yEnd) {
        const nextVal = (pred[(y + 1) * w + x] - minV) / span;
        floorGradSum += Math.abs(val - nextVal);
        floorGradCnt++;
      }
    }
  }

  const totalSamples = Math.max(1, leftCnt + centerCnt + rightCnt);
  const leftMean = leftSum / Math.max(1, leftCnt);
  const centerMean = centerSum / Math.max(1, centerCnt);
  const rightMean = rightSum / Math.max(1, rightCnt);
  const nearRatio = Number((nearCnt / totalSamples).toFixed(2));

  // If center is significantly farther (lower normalized value) than sides, corridor/doorway is open in center
  const sideMean = (leftMean + rightMean) / 2;
  const centerClearanceScore = Number((1 - centerMean + Math.max(0, sideMean - centerMean)).toFixed(2));
  const floorStepScore = Number(((floorGradSum / Math.max(1, floorGradCnt)) * 10).toFixed(2));
  const doorwayDetected = sideMean - centerMean > 0.14 && centerMean < 0.56;
  const estCorridorWidthM = Number(
    Math.max(0.75, Math.min(2.8, 0.75 + (1 - nearRatio) * 1.15 + centerClearanceScore * 0.45)).toFixed(2),
  );

  const clearanceLabel: DepthFrameSummary['clearanceLabel'] =
    nearRatio > 0.42 || centerMean > 0.66
      ? 'Sempit (< 0.9 m)'
      : nearRatio > 0.22
        ? 'Sedang (0.9–1.3 m)'
        : 'Lega (> 1.3 m)';

  const heatmapDataUrl = renderHeatmapDataUrl(out.depth.data, w, h);

  const sideBalance =
    leftMean - rightMean > 0.12
      ? 'objek lebih dekat di KIRI'
      : rightMean - leftMean > 0.12
        ? 'objek lebih dekat di KANAN'
        : 'kiri-kanan seimbang';

  const summaryText = `Frame #${frameIndex}: jalur ${clearanceLabel} (~${estCorridorWidthM} m), ${sideBalance}${
    doorwayDetected ? ', TERDETEKSI BUKAAN PINTU/LORONG di tengah' : ''
  }, variasi lantai=${floorStepScore}`;

  return {
    frameIndex,
    heatmapDataUrl,
    nearRatio,
    centerClearanceScore,
    floorStepScore,
    estCorridorWidthM,
    doorwayDetected,
    clearanceLabel,
    summaryText,
  };
}
