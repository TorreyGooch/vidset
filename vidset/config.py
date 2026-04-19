import json
import uuid
from pathlib import Path

TOOL_DIR = Path(__file__).parent.parent
CONFIG_PATH = TOOL_DIR / "config.json"


def get_config() -> dict:
    if not CONFIG_PATH.exists():
        return {"projects": []}
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def register_project(name: str, path: str) -> str:
    cfg = get_config()
    existing = next((p for p in cfg["projects"] if p["path"] == path), None)
    if existing:
        existing["name"] = name  # keep name in sync
        save_config(cfg)
        return existing["id"]
    pid = str(uuid.uuid4())
    cfg["projects"].append({"id": pid, "name": name, "path": path})
    save_config(cfg)
    return pid


def get_projects() -> list:
    cfg = get_config()
    # Filter out projects whose folder no longer exists
    valid = [p for p in cfg.get("projects", []) if Path(p["path"]).exists()]
    return valid


def remove_project(pid: str):
    cfg = get_config()
    cfg["projects"] = [p for p in cfg["projects"] if p["id"] != pid]
    save_config(cfg)
