# syntax=docker/dockerfile:1

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    DATA_DIR=/data

# FFmpeg/FFprobe power real video frame extraction. The OpenCV headless build
# still needs libglib and libgomp at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 nora \
    && useradd --uid 10001 --gid nora --create-home --shell /usr/sbin/nologin nora

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

RUN mkdir -p /data \
    && chown -R nora:nora /data /app

USER nora

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
