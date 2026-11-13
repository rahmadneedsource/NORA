"""Frame quality screening and overlap estimation with OpenCV.

This is real, explainable analysis (brightness, blur, ORB feature overlap). It
does not claim to reconstruct geometry; it only tells the caregiver whether the
captured media is usable as input for a reconstruction pipeline.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

RECONSTRUCTION_NOTE = (
    "Prototipe ini belum menjalankan COLMAP/3D Gaussian Splatting secara live. "
    "Pemeriksaan di sini menilai kelayakan media, bukan menghasilkan model 3D baru."
)


def _orb_overlap(paths: list[Path]) -> tuple[float, int]:
    try:
        import cv2
        import numpy as np  # noqa: F401
    except Exception:
        return 0.0, 0

    orb = cv2.ORB_create(nfeatures=600)
    descriptors = []
    for path in paths:
        image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if image is None:
            descriptors.append(None)
            continue
        height, width = image.shape[:2]
        if max(height, width) > 720:
            scale = 720.0 / max(height, width)
            image = cv2.resize(image, (int(width * scale), int(height * scale)))
        _, descriptor = orb.detectAndCompute(image, None)
        descriptors.append(descriptor)

    count = len(descriptors)
    if count < 2:
        return 0.0, 0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    adjacency = {index: set() for index in range(count)}
    matched_pairs = 0
    for i in range(count):
        if descriptors[i] is None or len(descriptors[i]) < 12:
            continue
        for j in range(i + 1, count):
            if descriptors[j] is None or len(descriptors[j]) < 12:
                continue
            try:
                matches = matcher.knnMatch(descriptors[i], descriptors[j], k=2)
            except cv2.error:
                continue
            good = [
                pair[0]
                for pair in matches
                if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance
            ]
            score = min(1.0, len(good) / 45.0)
            if score >= 0.15:
                adjacency[i].add(j)
                adjacency[j].add(i)
                matched_pairs += 1

    # Coverage = size of the largest overlap-connected component.
    seen: set[int] = set()
    largest = 0
    for start in range(count):
        if start in seen:
            continue
        queue = deque([start])
        seen.add(start)
        size = 0
        while queue:
            node = queue.popleft()
            size += 1
            for neighbour in adjacency[node]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    queue.append(neighbour)
        largest = max(largest, size)

    return round(largest / count, 3), matched_pairs


def analyze_frames(frames: list[dict]) -> dict:
    try:
        import cv2
    except Exception:
        return {
            "frameCount": len(frames),
            "usableFrames": len(frames),
            "brightnessAvg": None,
            "blurAvg": None,
            "coverageScore": None,
            "warnings": ["OpenCV tidak tersedia. Pemeriksaan kualitas frame dilewati."],
            "frames": [
                {"index": index, "brightness": None, "blurScore": None, "flags": [], "usable": True}
                for index in range(len(frames))
            ],
            "matchedPairs": 0,
            "note": RECONSTRUCTION_NOTE,
        }

    metrics = []
    paths: list[Path] = []
    low_light = 0
    blurry = 0
    low_resolution = 0

    for index, frame in enumerate(frames):
        path = Path(frame["localPath"])
        paths.append(path)
        image = cv2.imread(str(path))
        if image is None:
            metrics.append(
                {
                    "index": index,
                    "brightness": None,
                    "blurScore": None,
                    "flags": ["unreadable"],
                    "usable": False,
                }
            )
            continue
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        brightness = float(gray.mean())
        blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        height, width = gray.shape[:2]
        flags = []
        if brightness < 50:
            flags.append("low_light")
            low_light += 1
        if blur_score < 30:
            flags.append("blurred")
            blurry += 1
        if min(width, height) < 480:
            flags.append("low_resolution")
            low_resolution += 1
        metrics.append(
            {
                "index": index,
                "brightness": round(brightness, 1),
                "blurScore": round(blur_score, 1),
                "flags": flags,
                "usable": min(width, height) >= 240,
            }
        )

    coverage, matched_pairs = _orb_overlap(paths)
    usable = sum(1 for item in metrics if item["usable"])
    brightness_values = [item["brightness"] for item in metrics if item["brightness"] is not None]
    blur_values = [item["blurScore"] for item in metrics if item["blurScore"] is not None]

    warnings: list[str] = []
    if usable < 3:
        warnings.append("Kurang dari 3 frame layak. Tambahkan foto/video dari sudut lain.")
    if coverage and coverage < 0.35 and len(frames) >= 2:
        warnings.append(
            "Tumpang tindih antar-frame rendah. Rekonstruksi 3D membutuhkan gambar yang saling menutupi."
        )
    if low_light >= max(1, len(frames) // 2):
        warnings.append("Sebagian besar frame gelap. Nyalakan lampu dan ulangi perekaman.")
    if blurry >= max(1, len(frames) // 2):
        warnings.append("Sebagian besar frame buram. Gerakkan kamera lebih perlahan.")
    if low_resolution:
        warnings.append("Ada frame beresolusi rendah. Gunakan kamera belakang pada resolusi penuh.")

    return {
        "frameCount": len(frames),
        "usableFrames": usable,
        "brightnessAvg": round(sum(brightness_values) / len(brightness_values), 1)
        if brightness_values
        else None,
        "blurAvg": round(sum(blur_values) / len(blur_values), 1) if blur_values else None,
        "coverageScore": coverage,
        "warnings": warnings,
        "frames": metrics,
        "matchedPairs": matched_pairs,
        "note": RECONSTRUCTION_NOTE,
    }
