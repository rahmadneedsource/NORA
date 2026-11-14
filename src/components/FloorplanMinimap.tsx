import { useState } from 'react';
import { Map, Maximize2, Minimize2 } from 'lucide-react';
import type { HazardFinding, RoomZone, WallSegment } from '../data/blueprints';

export interface CameraPlanPose {
  posX: number;
  posZ: number;
  targetX: number;
  targetZ: number;
}

export interface FloorplanMinimapProps {
  floorBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  rooms: RoomZone[];
  walls: WallSegment[];
  hazards: HazardFinding[];
  selectedHazardId: string | null;
  routePath: [number, number, number][];
  showWayfinding: boolean;
  hasRouteRisk?: boolean;
  remediationActive?: boolean;
  isFirstPerson?: boolean;
  cameraPose: CameraPlanPose | null;
  onSelectHazard: (id: string) => void;
  onSelectRoom?: (roomId: string) => void;
}

export default function FloorplanMinimap({
  floorBounds,
  rooms,
  walls,
  hazards,
  selectedHazardId,
  routePath,
  showWayfinding,
  hasRouteRisk = false,
  remediationActive = false,
  isFirstPerson = false,
  cameraPose,
  onSelectHazard,
  onSelectRoom,
}: FloorplanMinimapProps) {
  const [collapsed, setCollapsed] = useState(false);

  const w = 178;
  const h = 148;
  const pad = 14;

  const spanX = Math.max(2, floorBounds.maxX - floorBounds.minX);
  const spanZ = Math.max(2, floorBounds.maxZ - floorBounds.minZ);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const uniformScale = Math.min(innerW / spanX, innerH / spanZ);
  const boundsCx = (floorBounds.minX + floorBounds.maxX) / 2;
  const boundsCz = (floorBounds.minZ + floorBounds.maxZ) / 2;

  const toSvg = (x: number, z: number): [number, number] => [
    Math.max(pad, Math.min(w - pad, w / 2 + (x - boundsCx) * uniformScale)),
    Math.max(pad, Math.min(h - pad, h / 2 + (z - boundsCz) * uniformScale)),
  ];

  const toSvgW = (val: number) => Math.max(1.5, val * uniformScale);
  const toSvgH = (val: number) => Math.max(1.5, val * uniformScale);

  const pathPoints = routePath
    .map((pt) => {
      const [sx, sy] = toSvg(pt[0], pt[2]);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(' ');

  const camSvg = cameraPose ? toSvg(cameraPose.posX, cameraPose.posZ) : null;
  const routeStartSvg =
    showWayfinding && routePath.length >= 2 ? toSvg(routePath[0][0], routePath[0][2]) : null;
  const routeEndSvg =
    showWayfinding && routePath.length >= 2
      ? toSvg(routePath[routePath.length - 1][0], routePath[routePath.length - 1][2])
      : null;

  // GTA 5 GPS color: Violet/Cyan when clear or remediated, Amber-Purple when hazards present
  const gpsStroke = remediationActive
    ? '#10B981'
    : hasRouteRisk
      ? '#9333EA'
      : '#06B6D4';
  const gpsGlow = remediationActive
    ? 'rgba(16, 185, 129, 0.32)'
    : hasRouteRisk
      ? 'rgba(147, 51, 234, 0.32)'
      : 'rgba(6, 182, 212, 0.32)';

  let camHeadingDeg = 0;
  let fovWedgePath = '';
  if (camSvg && cameraPose) {
    const dx = cameraPose.targetX - cameraPose.posX;
    const dy = cameraPose.targetZ - cameraPose.posZ;
    const angleRad = Math.atan2(dy, dx);
    camHeadingDeg = (angleRad * 180) / Math.PI + 90;
    const fovHalf = isFirstPerson ? 0.56 : 0.38;
    const rayLen = isFirstPerson ? 30 : 20;
    const x1 = camSvg[0] + Math.cos(angleRad - fovHalf) * rayLen;
    const y1 = camSvg[1] + Math.sin(angleRad - fovHalf) * rayLen;
    const x2 = camSvg[0] + Math.cos(angleRad + fovHalf) * rayLen;
    const y2 = camSvg[1] + Math.sin(angleRad + fovHalf) * rayLen;
    fovWedgePath = `M ${camSvg[0].toFixed(1)} ${camSvg[1].toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rayLen} ${rayLen} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="minimap-collapsed no-print"
        title="Buka Denah 2D"
      >
        <Map size={14} />
        <span>Denah 2D</span>
        <Maximize2 size={12} />
      </button>
    );
  }

  return (
    <div className="minimap-card no-print" aria-label="Minimap Denah 2D Sinkron">
      <div className="minimap-hd">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Map size={13} />
          <span>Denah 2D (X–Z)</span>
        </span>
        <button
          type="button"
          className="minimap-min-btn"
          onClick={() => setCollapsed(true)}
          title="Kecilkan Denah 2D"
          aria-label="Kecilkan Denah 2D"
        >
          <Minimize2 size={12} />
        </button>
      </div>

      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className="minimap-svg"
        role="img"
        aria-label="Denah 2D ruangan, jalur aman, dan titik bahaya"
      >
        {/* Base Slab */}
        <rect
          x={pad - 4}
          y={pad - 4}
          width={innerW + 8}
          height={innerH + 8}
          rx={9}
          fill="#F6EFE8"
          stroke="#D7C7B7"
          strokeWidth={1.2}
        />

        {/* Room Zones */}
        {rooms.map((room) => {
          const [cx, cy] = toSvg(room.bounds.x, room.bounds.z);
          const rw = toSvgW(room.bounds.w);
          const rh = toSvgH(room.bounds.d);
          return (
            <rect
              key={room.id}
              x={cx - rw / 2}
              y={cy - rh / 2}
              width={rw}
              height={rh}
              rx={3}
              fill={room.floorStyle === 'tile' ? '#EFE9E1' : '#E9D6BE'}
              stroke="#D5C4B2"
              strokeWidth={0.8}
              style={{ cursor: onSelectRoom ? 'pointer' : 'default' }}
              onClick={() => onSelectRoom?.(room.id)}
            />
          );
        })}

        {/* Walls */}
        {walls.map((wall, idx) => {
          const [cx, cy] = toSvg(wall.x, wall.z);
          const ww = toSvgW(wall.w);
          const wh = toSvgH(wall.d);
          return (
            <rect
              key={idx}
              x={cx - ww / 2}
              y={cy - wh / 2}
              width={ww}
              height={wh}
              fill="#A89A8B"
            />
          );
        })}

        {/* GTA 5 Style Glowing GPS Route */}
        {showWayfinding && routePath.length >= 2 && (
          <g>
            <polyline
              fill="none"
              stroke={gpsGlow}
              strokeWidth={7.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pathPoints}
            />
            <polyline
              fill="none"
              stroke={gpsStroke}
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pathPoints}
            />
            <polyline
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={1.3}
              strokeDasharray="4 6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="gta-route-dash"
              points={pathPoints}
            />
            {routeStartSvg && (
              <circle
                cx={routeStartSvg[0]}
                cy={routeStartSvg[1]}
                r={3.8}
                fill="#FFFFFF"
                stroke={gpsStroke}
                strokeWidth={1.8}
              />
            )}
            {routeEndSvg && (
              <g>
                <circle
                  cx={routeEndSvg[0]}
                  cy={routeEndSvg[1]}
                  r={7.5}
                  fill="none"
                  stroke={gpsStroke}
                  strokeWidth={1.6}
                  className="gta-dest-pulse"
                />
                <circle
                  cx={routeEndSvg[0]}
                  cy={routeEndSvg[1]}
                  r={4.2}
                  fill={gpsStroke}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                />
              </g>
            )}
          </g>
        )}

        {/* GTA 5 Style Player Arrow & Live FOV Vision Cone */}
        {camSvg && cameraPose && (
          <g>
            {fovWedgePath && (
              <path
                d={fovWedgePath}
                fill={isFirstPerson ? 'rgba(13, 37, 63, 0.22)' : 'rgba(13, 37, 63, 0.12)'}
              />
            )}
            <g transform={`translate(${camSvg[0].toFixed(1)}, ${camSvg[1].toFixed(1)}) rotate(${camHeadingDeg.toFixed(1)})`}>
              <polygon
                points="0,-6.5 4.8,5 0,2.5 -4.8,5"
                fill="#0D253F"
                stroke="#FFFFFF"
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            </g>
          </g>
        )}

        {/* Hazard Pins */}
        {hazards.map((item, idx) => {
          const [px, py] = toSvg(item.position[0], item.position[2]);
          const isSelected = item.id === selectedHazardId;
          const fill = item.reviewed
            ? '#2E7D5B'
            : item.severity === 'critical'
              ? '#F4721E'
              : '#D97706';
          return (
            <g
              key={item.id}
              onClick={() => onSelectHazard(item.id)}
              style={{ cursor: 'pointer' }}
              data-testid={`minimap-pin-${item.id}`}
            >
              {isSelected && (
                <circle cx={px} cy={py} r={10} fill="none" stroke="#0D253F" strokeWidth={1.5} />
              )}
              <circle cx={px} cy={py} r={7.2} fill={fill} stroke="#FFFFFF" strokeWidth={1.5} />
              <text
                x={px}
                y={py + 3}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={700}
                fill="#FFFFFF"
              >
                {idx + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
