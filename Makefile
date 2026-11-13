PYTHON ?= python3
VENV ?= .venv
UVICORN ?= $(VENV)/bin/uvicorn

.DEFAULT_GOAL := help

.PHONY: help install run test test-isolated smoke hygiene docker-build docker-up docker-down docker-logs clean

help:
	@echo "NORA — perintah yang tersedia:"
	@echo "  make install          Buat virtualenv dan pasang dependensi"
	@echo "  make run              Jalankan server di http://127.0.0.1:8000"
	@echo "  make test             Jalankan seluruh tes pytest"
	@echo "  make test-isolated    Jalankan tes tanpa plugin pytest eksternal"
	@echo "  make smoke            Smoke test terhadap server yang berjalan"
	@echo "  make hygiene          Periksa artefak terlarang dan kebocoran rahasia"
	@echo "  make docker-build     Build image Docker"
	@echo "  make docker-up        Jalankan stack Docker Compose"
	@echo "  make docker-down      Hentikan stack (volume tetap)"
	@echo "  make docker-logs      Ikuti log container"
	@echo "  make clean            Hapus cache Python/pytest"

install:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -r backend/requirements.txt

run:
	PYTHONPATH=backend $(UVICORN) app.main:create_app --factory --host 0.0.0.0 --port 8000

test:
	PYTHONPATH=backend $(VENV)/bin/python -m pytest -q

test-isolated:
	PYTHONPATH=backend PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 $(VENV)/bin/python -m pytest -q

smoke:
	bash scripts/smoke_test.sh

hygiene:
	bash scripts/check_repo_hygiene.sh

docker-build:
	docker compose build

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f nora

clean:
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .pytest_cache
