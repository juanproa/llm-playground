"""Reliable HF-model downloader for MLX (and generic HF) models.

Replaces `huggingface_hub.snapshot_download()` which silently stalls for us.
Uses subprocess curl with explicit resume + stall detection, writing directly
into the HF cache layout so `mlx_lm.load()` picks the files up normally.

Progress is tracked in-memory per (model_id) so the /mlx-status endpoint
can return real byte-level progress to the UI.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


# ── In-memory progress registry ─────────────────────────────────────────────
# key = model_id (e.g. "mlx-community/Qwen3-8B-4bit")
# value = {state, total_bytes, downloaded_bytes, current_file, error}
_PROGRESS: dict[str, dict] = {}


def _hf_cache_root() -> Path:
    return Path(os.environ.get("HF_HUB_CACHE") or os.path.expanduser("~/.cache/huggingface/hub"))


def _repo_dir(model_id: str) -> Path:
    safe = "models--" + model_id.replace("/", "--")
    return _hf_cache_root() / safe


def _list_repo_files(model_id: str, revision: str = "main") -> tuple[str, list[dict]]:
    """Return (commit_sha, file_list) where file_list contains dicts with
    keys: path, size, lfs_oid (optional)."""
    api = f"https://huggingface.co/api/models/{model_id}/tree/{revision}"
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        r = client.get(api)
        r.raise_for_status()
        files = [f for f in r.json() if f.get("type") == "file"]
        # Get the commit hash for this revision
        r2 = client.get(f"https://huggingface.co/api/models/{model_id}/revision/{revision}")
        r2.raise_for_status()
        sha = r2.json().get("sha", revision)
    return sha, files


def _blob_path_for(model_id: str, file_info: dict) -> Path:
    """Determine the target blob path in the HF cache layout.

    For LFS files, HF uses the LFS OID.  For non-LFS, it uses the git blob SHA.
    We only have the git blob info from the tree API; that's fine because
    snapshot symlinks are created pointing to whatever we name the blob.
    """
    lfs = file_info.get("lfs")
    if lfs and lfs.get("oid"):
        blob_name = lfs["oid"]
    else:
        # Non-LFS — use the blob_id or file hash
        blob_name = file_info.get("blob_id") or file_info.get("oid", "")
        if not blob_name:
            # Fallback: derive from path (not ideal but functional)
            import hashlib
            blob_name = hashlib.sha256(file_info["path"].encode()).hexdigest()
    return _repo_dir(model_id) / "blobs" / blob_name


def _download_single_file(
    url: str,
    dest: Path,
    expected_size: int,
    on_progress=None,
    stall_timeout: int = 120,
) -> None:
    """Download one file to `dest` with curl, resuming if a partial exists.

    Retries indefinitely on network failure (each retry uses the file's
    current size as the new resume offset).  Detects stalls longer than
    stall_timeout seconds and kicks curl to restart.

    Raises RuntimeError on persistent errors.
    """
    incomplete = dest.with_suffix(dest.suffix + ".incomplete")
    dest.parent.mkdir(parents=True, exist_ok=True)
    attempt = 0

    while True:
        attempt += 1
        cur_size = incomplete.stat().st_size if incomplete.exists() else 0
        if cur_size >= expected_size and expected_size > 0:
            incomplete.rename(dest)
            logger.info("Completed %s (%d bytes)", dest.name, expected_size)
            if on_progress:
                on_progress(dest.name, cur_size, expected_size)
            return

        logger.info(
            "[attempt %d] downloading %s from %d/%d bytes (%.1f%%)",
            attempt, dest.name, cur_size, expected_size,
            (cur_size * 100 / expected_size) if expected_size else 0,
        )

        # Launch curl and watch it for stalls
        cmd = [
            "curl", "-L", "-C", "-",
            "--connect-timeout", "30",
            "--max-time", "3600",
            "--fail",
            "--silent",
            "-o", str(incomplete),
            url,
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        last_size = incomplete.stat().st_size if incomplete.exists() else 0
        last_change = time.monotonic()

        while proc.poll() is None:
            time.sleep(5)
            now = time.monotonic()
            cur = incomplete.stat().st_size if incomplete.exists() else 0
            if on_progress:
                on_progress(dest.name, cur, expected_size)
            if cur > last_size:
                last_size = cur
                last_change = now
            elif now - last_change > stall_timeout:
                logger.warning(
                    "Stall detected on %s at %d bytes — killing curl",
                    dest.name, cur,
                )
                proc.kill()
                proc.wait()
                break

        rc = proc.returncode
        err = (proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else "")[:500]

        # If file is complete now, we're done
        cur_size = incomplete.stat().st_size if incomplete.exists() else 0
        if expected_size and cur_size >= expected_size:
            incomplete.rename(dest)
            if on_progress:
                on_progress(dest.name, cur_size, expected_size)
            return

        # Otherwise, wait a bit and retry from current size
        if attempt >= 30:
            raise RuntimeError(
                f"Giving up on {dest.name} after {attempt} attempts "
                f"(rc={rc}, err={err!r})"
            )
        time.sleep(3)


def download_model(model_id: str, revision: str = "main") -> Path:
    """Download every file in a HF model repo into the HF cache layout.

    Returns the snapshot directory path.  Safe to call repeatedly — skips
    files that are already cached.
    """
    _PROGRESS[model_id] = {
        "state": "listing",
        "total_bytes": 0,
        "downloaded_bytes": 0,
        "current_file": None,
        "error": None,
    }

    try:
        sha, files = _list_repo_files(model_id, revision)
    except Exception as e:
        _PROGRESS[model_id] = {
            "state": "error", "total_bytes": 0, "downloaded_bytes": 0,
            "current_file": None, "error": f"Failed to list files: {e}",
        }
        raise

    total_bytes = sum(f.get("size", 0) or 0 for f in files)
    _PROGRESS[model_id].update({
        "state": "downloading",
        "total_bytes": total_bytes,
    })

    repo = _repo_dir(model_id)
    blobs = repo / "blobs"
    snapshot = repo / "snapshots" / sha
    blobs.mkdir(parents=True, exist_ok=True)
    snapshot.mkdir(parents=True, exist_ok=True)
    (repo / "refs").mkdir(exist_ok=True)
    (repo / "refs" / revision).write_text(sha)

    # Initial progress: account for already-downloaded files
    already_down = 0
    for f in files:
        blob = _blob_path_for(model_id, f)
        if blob.exists() and blob.stat().st_size == (f.get("size") or 0):
            already_down += f.get("size", 0) or 0
    _PROGRESS[model_id]["downloaded_bytes"] = already_down

    def progress_cb(filename: str, cur: int, total: int):
        # Called per-file; we track cumulative across all files
        per_file_progress = max(0, cur)
        # Sum completed files + this in-flight one
        done = 0
        for f in files:
            if f["path"] == filename:
                done += per_file_progress
            else:
                blob = _blob_path_for(model_id, f)
                if blob.exists():
                    done += blob.stat().st_size
        _PROGRESS[model_id].update({
            "downloaded_bytes": done,
            "current_file": filename,
        })

    # Download each file + create snapshot symlink
    for f in files:
        path = f["path"]
        size = f.get("size", 0) or 0
        blob = _blob_path_for(model_id, f)
        snap_link = snapshot / path

        # Skip if the blob is already at expected size
        if blob.exists() and blob.stat().st_size == size and size > 0:
            if not snap_link.exists():
                snap_link.parent.mkdir(parents=True, exist_ok=True)
                rel = os.path.relpath(blob, snap_link.parent)
                snap_link.symlink_to(rel)
            continue

        url = f"https://huggingface.co/{model_id}/resolve/{revision}/{path}"
        try:
            _download_single_file(url, blob, size, on_progress=progress_cb)
        except Exception as e:
            _PROGRESS[model_id] = {
                "state": "error",
                "total_bytes": total_bytes,
                "downloaded_bytes": _PROGRESS[model_id].get("downloaded_bytes", 0),
                "current_file": path,
                "error": str(e),
            }
            raise

        snap_link.parent.mkdir(parents=True, exist_ok=True)
        if not snap_link.exists():
            rel = os.path.relpath(blob, snap_link.parent)
            snap_link.symlink_to(rel)

    _PROGRESS[model_id].update({
        "state": "done",
        "downloaded_bytes": total_bytes,
        "current_file": None,
    })
    return snapshot


def download_progress(model_id: str) -> dict | None:
    """Return a snapshot of the in-memory progress registry for this model."""
    return _PROGRESS.get(model_id)


async def download_model_async(model_id: str, revision: str = "main") -> Path:
    """Run the blocking download in a worker thread."""
    return await asyncio.to_thread(download_model, model_id, revision)
