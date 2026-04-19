#!/usr/bin/env python3
"""
VIDSET launcher.
Installs dependencies on first run, checks for ffmpeg, starts the server,
and opens the browser automatically.
"""
import os
import sys
import subprocess
import time
import threading
import webbrowser
import shutil

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(TOOL_DIR)


def ensure_deps():
    try:
        import fastapi
        import uvicorn
        import yt_dlp
        import scenedetect
        import aiofiles
        import multipart  # python-multipart
    except ImportError:
        print("Installing dependencies (first run)...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "-r", "requirements.txt"],
            cwd=TOOL_DIR,
        )
        print("Dependencies installed.\n")


def check_ffmpeg():
    if shutil.which("ffmpeg") is None:
        print("=" * 60)
        print("WARNING: ffmpeg not found on PATH.")
        print("Split and thumbnail features will not work.")
        print("Install ffmpeg: https://ffmpeg.org/download.html")
        print("=" * 60)
        print()


def open_browser():
    time.sleep(1.8)
    webbrowser.open("http://127.0.0.1:7860")


if __name__ == "__main__":
    ensure_deps()
    check_ffmpeg()

    import uvicorn

    threading.Thread(target=open_browser, daemon=True).start()
    print("VIDSET running at http://127.0.0.1:7860")
    uvicorn.run("vidset.main:app", host="127.0.0.1", port=7860, reload=False)
