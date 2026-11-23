#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scan L2d_model / L2d_models and write the static models.json manifest.

Local development: server.py exposes the same scan through /api/models, so this
script is mainly for GitHub Pages (and for committing an up-to-date manifest).

Usage:
    python scan_models.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_DIRS = ["L2d_model", "L2d_models"]
ACCENT = "#7ef0c8"


def model_dirs(base: Path) -> list[Path]:
    return [base / name for name in MODEL_DIRS if (base / name).is_dir()]


def scan_models(base: Path | None = None) -> list[dict]:
    base = (base or ROOT).resolve()
    found: list[dict] = []
    seen: set[str] = set()
    for root in model_dirs(base):
        for model_file in sorted(root.rglob("*.model3.json")):
            rel = model_file.relative_to(base).as_posix()
            if rel in seen:
                continue
            seen.add(rel)
            folder = model_file.parent.name
            display = folder.replace("_", " · ") if "_" in folder and " " not in folder else folder
            short = display.replace("·", " ").split()[-1] if display else folder
            found.append(
                {
                    "id": rel,
                    "name": display,
                    "shortName": short,
                    "subtitle": root.name,
                    "path": rel,
                    "accent": ACCENT,
                }
            )
    found.sort(key=lambda item: item["name"].lower())
    return found


def load_existing(path: Path) -> dict[str, dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data = data.get("models", [])
        return {str(item.get("path")): item for item in data if isinstance(item, dict) and item.get("path")}
    except Exception:
        return {}


def build_manifest(base: Path | None = None) -> list[dict]:
    base = (base or ROOT).resolve()
    models = scan_models(base)
    existing = load_existing(base / "models.json")
    for item in models:
        old = existing.get(item["path"], {})
        for key in ("id", "name", "shortName", "subtitle", "accent"):
            if old.get(key):
                item[key] = old[key]
    return models


def write_manifest(base: Path | None = None) -> list[dict]:
    base = (base or ROOT).resolve()
    models = build_manifest(base)
    out = base / "models.json"
    out.write_text(json.dumps(models, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return models


def main() -> int:
    models = write_manifest()
    print(f"models.json: {len(models)} model(s)")
    for item in models:
        print(f"  - {item['name']}  ({item['path']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
