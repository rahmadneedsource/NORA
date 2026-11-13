"""Frame extraction from uploaded photos and videos."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from ..config import Settings
from .storage import MediaError, normalise_image, make_thumbnail, probe_video

MAX_TOTAL_FRAMES = 36
MAX_VIDEO_FRAMES = 24


class FrameExtractionError(RuntimeError):
    pass


def _media_url(settings: Settings, path: Path) -> str:
    try:
        relative = path.resolve().relative_to(settings.media_dir.resolve())
    except ValueError:
        return ""
    return "/media/" + relative.as_posix()


def extract_frames(
    settings: Settings,
    job_id: str,
    inputs: list[Path],
    kinds: list[dict],
) -> list[dict]:
    frames_dir = settings.scans_media_dir / job_id / "frames"
    thumbs_dir = settings.scans_media_dir / job_id / "thumbs"
    frames_dir.mkdir(parents=True, exist_ok=True)
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    frames: list[dict] = []
    errors: list[str] = []
    counter = 0

    for file_index, (source, kind) in enumerate(zip(inputs, kinds)):
        if len(frames) >= MAX_TOTAL_FRAMES:
            break

        if kind["kind"] == "image":
            counter += 1
            filename = f"frame_{counter:03d}.jpg"
            destination = frames_dir / filename
            try:
                width, height = normalise_image(source, destination, max_px=1600)
                thumb = thumbs_dir / filename
                make_thumbnail(destination, thumb)
                frames.append(
                    {
                        "filename": filename,
                        "path": _media_url(settings, destination),
                        "thumbPath": _media_url(settings, thumb),
                        "timestampS": 0.0,
                        "width": width,
                        "height": height,
                    }
                )
            except (MediaError, OSError) as exc:
                errors.append(f"{source.name}: {exc}")
            continue

        # Video: sample roughly one frame per interval, capped per video.
        remaining = MAX_TOTAL_FRAMES - len(frames)
        limit = max(1, min(MAX_VIDEO_FRAMES, remaining))
        duration = float(kind.get("duration") or 0)
        interval = max(0.5, duration / limit) if duration > 0 else 1.0
        pattern = frames_dir / f"video_{file_index + 1:02d}_%03d.jpg"
        command = [
            settings.ffmpeg_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-vf",
            f"fps=1/{interval:.3f},scale=1280:-2:force_original_aspect_ratio=decrease",
            "-frames:v",
            str(limit),
            "-q:v",
            "3",
            str(pattern),
        ]
        try:
            completed = subprocess.run(command, capture_output=True, text=True, timeout=240)
        except FileNotFoundError:
            errors.append("FFmpeg tidak tersedia di server.")
            continue
        except subprocess.TimeoutExpired:
            errors.append(f"{source.name}: ekstraksi video melebihi batas waktu.")
            continue
        if completed.returncode != 0:
            errors.append(f"{source.name}: FFmpeg gagal mengekstrak frame.")
            continue

        generated = sorted(frames_dir.glob(f"video_{file_index + 1:02d}_*.jpg"))
        for sample_index, generated_path in enumerate(generated):
            if len(frames) >= MAX_TOTAL_FRAMES:
                generated_path.unlink(missing_ok=True)
                continue
            counter += 1
            filename = f"frame_{counter:03d}.jpg"
            destination = frames_dir / filename
            try:
                shutil.move(str(generated_path), destination)
                with __import__("PIL.Image").Image.open(destination) as image:
                    width, height = image.size
                thumb = thumbs_dir / filename
                make_thumbnail(destination, thumb)
                frames.append(
                    {
                        "filename": filename,
                        "path": _media_url(settings, destination),
                        "thumbPath": _media_url(settings, thumb),
                        "timestampS": round(sample_index * interval, 2),
                        "width": width,
                        "height": height,
                    }
                )
            except (OSError, ValueError) as exc:
                errors.append(f"{source.name}: {exc}")

    if not frames:
        detail = " ".join(errors) if errors else "Tidak ada frame yang berhasil diekstrak."
        raise FrameExtractionError(detail)

    return frames


def cleanup_job_dirs(settings: Settings, job_id: str) -> None:
    shutil.rmtree(settings.scans_media_dir / job_id, ignore_errors=True)
    shutil.rmtree(settings.scans_upload_dir / job_id, ignore_errors=True)
