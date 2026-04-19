import asyncio
import json
import shutil
from pathlib import Path


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


async def get_duration(video_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", str(video_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    data = json.loads(out)
    return float(data["format"]["duration"])


async def extract_clip(source: Path, dest: Path, start: float, end: float) -> bool:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", str(source),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        str(dest),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    return proc.returncode == 0


async def generate_thumbnail(video_path: Path, thumb_path: Path, time: float = 0.5) -> bool:
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(max(time, 0)),
        "-i", str(video_path),
        "-vframes", "1",
        "-vf", "scale=320:-1",
        "-q:v", "3",
        str(thumb_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()
    return thumb_path.exists()


async def get_fps(video_path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", "-select_streams", "v:0", str(video_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        data = json.loads(out)
        streams = data.get("streams", [])
        if streams:
            r = streams[0].get("r_frame_rate", "30/1")
            num, den = r.split("/")
            return round(float(num) / float(den), 6)
    except Exception:
        pass
    return 30.0


async def detect_scenes(video_path: Path, threshold: float = 27.0) -> list[dict]:
    loop = asyncio.get_event_loop()

    def _detect():
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector

        video = open_video(str(video_path))
        sm = SceneManager()
        sm.add_detector(ContentDetector(threshold=threshold))
        sm.detect_scenes(video, show_progress=False)
        scenes = sm.get_scene_list()

        results = []
        for i, (start, end) in enumerate(scenes):
            results.append({
                "index": i,
                "start": round(start.get_seconds(), 3),
                "end": round(end.get_seconds(), 3),
                "duration": round(end.get_seconds() - start.get_seconds(), 3),
            })
        return results

    return await loop.run_in_executor(None, _detect)
