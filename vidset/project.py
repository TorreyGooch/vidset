import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

SUBFOLDERS = ["source", "clips", "clips/thumbnails", "captions", "export"]


def create_project(root: Path, name: str) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    for folder in SUBFOLDERS:
        (root / folder).mkdir(parents=True, exist_ok=True)
    project = {
        "name": name,
        "created": datetime.now().isoformat(),
        "trigger_word": "",
        "sources": [],
        "clips": [],
        "exports": [],
    }
    save_project(root, project)
    return project


def load_project(root: Path) -> dict:
    with open(root / "project.json", encoding="utf-8") as f:
        return json.load(f)


def save_project(root: Path, project: dict):
    with open(root / "project.json", "w", encoding="utf-8") as f:
        json.dump(project, f, indent=2)


def is_project(root: Path) -> bool:
    return (root / "project.json").exists()


def new_source(filename: str, title: str, url: Optional[str] = None) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "filename": filename,
        "url": url,
        "title": title,
        "concept_name": title,
        "downloaded_at": datetime.now().isoformat(),
    }


def new_clip(source_id: str, filename: str, start: float, end: float) -> dict:
    clip_id = Path(filename).stem
    return {
        "id": clip_id,
        "source_id": source_id,
        "filename": filename,
        "start": round(start, 3),
        "end": round(end, 3),
        "duration": round(end - start, 3),
        "status": "unreviewed",
        "tags": [],
        "has_caption": False,
        "caption_source": None,
    }
