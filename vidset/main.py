import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Body
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_config, register_project, get_projects, remove_project
from .project import (
    create_project, load_project, save_project, is_project,
    new_source, new_clip,
)
from .api.download import download_url, import_local
from .api.split import (
    extract_clip, generate_thumbnail, detect_scenes,
    get_duration, get_fps, ffmpeg_available,
)

TOOL_DIR = Path(__file__).parent.parent

app = FastAPI(title="VIDSET")
app.mount(
    "/static",
    StaticFiles(directory=str(TOOL_DIR / "frontend" / "static")),
    name="static",
)


@app.get("/")
def serve_frontend():
    return FileResponse(str(TOOL_DIR / "frontend" / "index.html"))


# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    return get_projects()


@app.post("/api/projects")
async def create_new_project(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    path = (body.get("path") or "").strip()
    if not name or not path:
        raise HTTPException(400, "name and path required")
    root = Path(path)
    if is_project(root):
        raise HTTPException(400, "A project already exists at that path")
    project = create_project(root, name)
    pid = register_project(name, str(root))
    return {"id": pid, "name": name, "path": str(root)}


@app.post("/api/projects/open")
async def open_project(body: dict = Body(...)):
    path = (body.get("path") or "").strip()
    root = Path(path)
    if not is_project(root):
        raise HTTPException(404, "No project.json found at that path")
    project = load_project(root)
    pid = register_project(project["name"], str(root))
    return {"id": pid, "name": project["name"], "path": str(root)}


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    root = _get_root(pid)
    project = load_project(root)
    return {"id": pid, "path": str(root), **project}


@app.patch("/api/projects/{pid}")
async def update_project(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    for field in ("name", "trigger_word"):
        if field in body:
            project[field] = body[field]
    save_project(root, project)
    return project


@app.delete("/api/projects/{pid}")
def forget_project(pid: str):
    """Remove from recent projects list (does not delete files)."""
    remove_project(pid)
    return {"ok": True}


# ── Sources ───────────────────────────────────────────────────────────────────

@app.get("/api/projects/{pid}/sources")
def list_sources(pid: str):
    root = _get_root(pid)
    return load_project(root)["sources"]


@app.post("/api/projects/{pid}/sources/download")
async def download_source(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url required")
    start_time = body.get("start_time") or None
    end_time = body.get("end_time") or None

    results = await download_url(url, root / "source", start_time, end_time)

    project = load_project(root)
    added = []
    for r in results:
        src = new_source(Path(r["filename"]).name, r["title"], url)
        project["sources"].append(src)
        added.append(src)
    save_project(root, project)
    return added


@app.post("/api/projects/{pid}/sources/import")
async def import_source(pid: str, file: UploadFile = File(...)):
    root = _get_root(pid)
    dest = root / "source" / file.filename
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    title = Path(file.filename).stem.replace("_", " ").replace("-", " ")
    project = load_project(root)
    src = new_source(file.filename, title)
    project["sources"].append(src)
    save_project(root, project)
    return src


@app.patch("/api/projects/{pid}/sources/{sid}")
async def update_source(pid: str, sid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    src = _find(project["sources"], sid)
    if not src:
        raise HTTPException(404, "Source not found")
    for field in ("concept_name", "title"):
        if field in body:
            src[field] = body[field]
    save_project(root, project)
    return src


@app.delete("/api/projects/{pid}/sources/{sid}")
async def delete_source(pid: str, sid: str):
    root = _get_root(pid)
    project = load_project(root)
    src = _find(project["sources"], sid)
    if not src:
        raise HTTPException(404, "Source not found")
    f = root / "source" / src["filename"]
    if f.exists():
        f.unlink()
    project["sources"] = [s for s in project["sources"] if s["id"] != sid]
    save_project(root, project)
    return {"ok": True}


# ── Media serving ─────────────────────────────────────────────────────────────

@app.get("/api/projects/{pid}/media/source/{filename:path}")
def serve_source(pid: str, filename: str):
    root = _get_root(pid)
    path = root / "source" / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(str(path), media_type="video/mp4")


@app.get("/api/projects/{pid}/media/clips/{filename:path}")
def serve_clip(pid: str, filename: str):
    root = _get_root(pid)
    path = root / "clips" / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(str(path), media_type="video/mp4")


@app.get("/api/projects/{pid}/clips/{cid}/thumbnail")
async def get_thumbnail(pid: str, cid: str):
    root = _get_root(pid)
    thumb = root / "clips" / "thumbnails" / f"{cid}.jpg"
    if not thumb.exists():
        project = load_project(root)
        clip = _find(project["clips"], cid)
        if clip:
            vpath = root / "clips" / clip["filename"]
            if vpath.exists():
                await generate_thumbnail(vpath, thumb, clip["duration"] / 2)
    if not thumb.exists():
        raise HTTPException(404)
    return FileResponse(str(thumb), media_type="image/jpeg")


# ── Clips / Split ─────────────────────────────────────────────────────────────

@app.get("/api/projects/{pid}/clips")
def list_clips(pid: str, status: Optional[str] = None):
    root = _get_root(pid)
    project = load_project(root)
    clips = project["clips"]
    if status:
        clips = [c for c in clips if c["status"] == status]
    src_map = {s["id"]: s for s in project["sources"]}
    for c in clips:
        src = src_map.get(c["source_id"], {})
        c["concept_name"] = src.get("concept_name", "")
        c["source_title"] = src.get("title", "")
    return clips


@app.get("/api/projects/{pid}/sources/{sid}/fps")
async def source_fps(pid: str, sid: str):
    root = _get_root(pid)
    project = load_project(root)
    src = _find(project["sources"], sid)
    if not src:
        raise HTTPException(404)
    vpath = root / "source" / src["filename"]
    if not vpath.exists():
        raise HTTPException(404)
    fps = await get_fps(vpath)
    return {"fps": fps}


@app.get("/api/projects/{pid}/sources/{sid}/duration")
async def source_duration(pid: str, sid: str):
    root = _get_root(pid)
    project = load_project(root)
    src = _find(project["sources"], sid)
    if not src:
        raise HTTPException(404)
    vpath = root / "source" / src["filename"]
    if not vpath.exists():
        raise HTTPException(404)
    dur = await get_duration(vpath)
    return {"duration": dur}


@app.post("/api/projects/{pid}/clips/detect")
async def detect_clip_scenes(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    src = _find(project["sources"], body.get("source_id"))
    if not src:
        raise HTTPException(404, "Source not found")
    vpath = root / "source" / src["filename"]
    threshold = float(body.get("threshold", 27.0))
    scenes = await detect_scenes(vpath, threshold)
    return scenes


@app.post("/api/projects/{pid}/clips/extract")
async def extract_clips(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    segments = body.get("segments", [])
    min_duration = float(body.get("min_duration", 1.5))

    src_map = {s["id"]: s for s in project["sources"]}
    added = []

    for seg in segments:
        sid = seg.get("source_id")
        src = src_map.get(sid)
        if not src:
            continue
        start = float(seg["start"])
        end = float(seg["end"])

        existing_for_src = [c for c in project["clips"] if c["source_id"] == sid]
        n = len(existing_for_src) + 1
        base = Path(src["filename"]).stem
        clip_filename = f"{base}_clip_{n:03d}.mp4"

        src_path = root / "source" / src["filename"]
        dest_path = root / "clips" / clip_filename

        ok = await extract_clip(src_path, dest_path, start, end)
        if not ok:
            continue

        clip = new_clip(sid, clip_filename, start, end)
        if clip["duration"] < min_duration:
            clip["status"] = "flagged"

        thumb = root / "clips" / "thumbnails" / f"{clip['id']}.jpg"
        await generate_thumbnail(dest_path, thumb, clip["duration"] / 2)

        project["clips"].append(clip)
        added.append(clip)

    save_project(root, project)
    return added


@app.get("/api/projects/{pid}/clips/{cid}/caption")
def get_caption(pid: str, cid: str):
    root = _get_root(pid)
    cap_path = root / "captions" / f"{cid}.txt"
    return {"text": cap_path.read_text(encoding="utf-8") if cap_path.exists() else ""}


@app.patch("/api/projects/{pid}/clips/{cid}")
async def update_clip(pid: str, cid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    clip = _find(project["clips"], cid)
    if not clip:
        raise HTTPException(404, "Clip not found")

    if "status" in body:
        clip["status"] = body["status"]
    if "tags" in body:
        clip["tags"] = body["tags"]
    if "caption" in body:
        cap_path = root / "captions" / f"{cid}.txt"
        cap_path.write_text(body["caption"], encoding="utf-8")
        clip["has_caption"] = True
        clip["caption_source"] = body.get("caption_source", "manual")

    save_project(root, project)
    return clip


@app.post("/api/projects/{pid}/clips/batch-tag")
async def batch_tag_clips(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    clip_ids = set(body.get("clip_ids", []))
    tag = (body.get("tag") or "").strip()
    action = body.get("action", "add")  # "add" | "remove"

    updated = []
    for clip in project["clips"]:
        if clip["id"] not in clip_ids:
            continue
        if action == "add" and tag and tag not in clip["tags"]:
            clip["tags"].append(tag)
            updated.append(clip["id"])
        elif action == "remove" and tag in clip["tags"]:
            clip["tags"].remove(tag)
            updated.append(clip["id"])

    save_project(root, project)
    return {"updated": updated}


@app.post("/api/projects/{pid}/clips/batch-status")
async def batch_status_clips(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    clip_ids = set(body.get("clip_ids", []))
    status = body.get("status")
    if status not in ("approved", "flagged", "unreviewed"):
        raise HTTPException(400, "Invalid status")
    for clip in project["clips"]:
        if clip["id"] in clip_ids:
            clip["status"] = status
    save_project(root, project)
    return {"ok": True}


@app.delete("/api/projects/{pid}/clips/{cid}")
async def delete_clip(pid: str, cid: str):
    root = _get_root(pid)
    project = load_project(root)
    clip = _find(project["clips"], cid)
    if not clip:
        raise HTTPException(404)
    for p in [
        root / "clips" / clip["filename"],
        root / "clips" / "thumbnails" / f"{cid}.jpg",
        root / "captions" / f"{cid}.txt",
    ]:
        if p.exists():
            p.unlink()
    project["clips"] = [c for c in project["clips"] if c["id"] != cid]
    save_project(root, project)
    return {"ok": True}


# ── Caption stub ──────────────────────────────────────────────────────────────

@app.post("/api/projects/{pid}/clips/{cid}/caption/submit")
async def submit_caption(pid: str, cid: str):
    return {"status": "stub", "message": "ComfyUI integration coming in Phase 3"}


# ── Export ────────────────────────────────────────────────────────────────────

@app.get("/api/projects/{pid}/exports")
def list_exports(pid: str):
    root = _get_root(pid)
    return load_project(root).get("exports", [])


@app.post("/api/projects/{pid}/export")
async def run_export(pid: str, body: dict = Body(...)):
    root = _get_root(pid)
    project = load_project(root)
    export_name = (body.get("name") or "export").strip()
    approved_only = body.get("approved_only", True)

    clips_to_export = [
        c for c in project["clips"]
        if not approved_only or c["status"] == "approved"
    ]
    if not clips_to_export:
        raise HTTPException(400, "No clips to export (are any marked Approved?)")

    export_dir = root / "export" / export_name
    export_dir.mkdir(parents=True, exist_ok=True)

    src_map = {s["id"]: s for s in project["sources"]}
    trigger_word = (project.get("trigger_word") or "").strip()

    total_duration = 0.0
    count = 0

    for i, clip in enumerate(clips_to_export, start=1):
        src = src_map.get(clip["source_id"], {})
        concept = (src.get("concept_name") or "").strip()
        tags = [t for t in clip.get("tags", []) if t.strip()]

        parts = [p for p in [trigger_word, concept] + tags if p]

        cap_path = root / "captions" / f"{clip['id']}.txt"
        if cap_path.exists():
            body_text = cap_path.read_text(encoding="utf-8").strip()
            if body_text:
                parts.append(body_text)

        full_caption = ", ".join(parts)
        out_name = f"clip_{i:04d}"

        src_video = root / "clips" / clip["filename"]
        if src_video.exists():
            shutil.copy2(str(src_video), str(export_dir / f"{out_name}.mp4"))

        (export_dir / f"{out_name}.txt").write_text(full_caption, encoding="utf-8")
        total_duration += clip.get("duration", 0)
        count += 1

    dataset_info = {
        "project": project["name"],
        "export_name": export_name,
        "exported_at": datetime.now().isoformat(),
        "clip_count": count,
        "total_duration_seconds": round(total_duration, 1),
        "approved_only": approved_only,
    }
    (export_dir / "dataset_info.json").write_text(
        json.dumps(dataset_info, indent=2), encoding="utf-8"
    )

    entry = {
        "name": export_name,
        "path": str(export_dir),
        "clip_count": count,
        "created": dataset_info["exported_at"],
    }
    if "exports" not in project:
        project["exports"] = []
    project["exports"].append(entry)
    save_project(root, project)
    return dataset_info


@app.get("/api/status")
def status():
    return {"ffmpeg": ffmpeg_available()}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_root(pid: str) -> Path:
    cfg = get_config()
    entry = next((p for p in cfg.get("projects", []) if p["id"] == pid), None)
    if not entry:
        raise HTTPException(404, "Project not found")
    return Path(entry["path"])


def _find(items: list, id_val: str) -> Optional[dict]:
    return next((x for x in items if x.get("id") == id_val), None)
