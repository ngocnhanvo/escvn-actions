#!/usr/bin/env python3
"""ESC.VN signed delta ZIP: reuse byte-identical public client assets only.

Server/ SSR and client/index.html are always included. A signed WordPress PHP
manifest supplies the old production hashes; no untrusted client-side guesses.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time

SAFE = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*")
ASSET = re.compile(r"\.(?:html|css|js|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|webmanifest)$")
META = {"index.html", "robots.txt", "sitemap.xml", "llms.txt"}
LIMIT_FILES = 10000
LIMIT_FILE_BYTES = 41943040
LIMIT_TOTAL_BYTES = 805306368


def eligible(name: str) -> bool:
    return (isinstance(name, str) and bool(name) and len(name) <= 260
            and all(SAFE.fullmatch(part) for part in name.split("/"))
            and name not in META and bool(ASSET.search(name)))


def checksum(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda: f.read(1024 * 1024), b""):
            sha.update(data)
    return sha.hexdigest()


def collect(root: Path) -> dict[str, dict]:
    if not root.is_dir() or root.is_symlink():
        raise ValueError("Compiled Astro client directory missing or symlinked")
    found: dict[str, dict] = {}
    total = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError("Unexpected symlink in compiled public client")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("Unexpected client filesystem entry")
        name = path.relative_to(root).as_posix()
        if not eligible(name):
            continue
        size = path.stat().st_size
        total += size
        if size > LIMIT_FILE_BYTES or total > LIMIT_TOTAL_BYTES or len(found) >= LIMIT_FILES:
            raise ValueError("Compiled client delta inventory exceeds safe limits")
        found[name] = {"size": size, "sha256": checksum(path)}
    return found


def validate_remote(files: object) -> dict[str, dict]:
    if not isinstance(files, dict) or len(files) > LIMIT_FILES:
        raise ValueError("Signed remote inventory malformed")
    total = 0
    for name, meta in files.items():
        if (not eligible(name) or not isinstance(meta, dict)
                or type(meta.get("size")) is not int or meta["size"] < 0
                or meta["size"] > LIMIT_FILE_BYTES
                or not isinstance(meta.get("sha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", meta["sha256"])):
            raise ValueError("Unsafe or malformed signed remote inventory entry")
        total += meta["size"]
        if total > LIMIT_TOTAL_BYTES:
            raise ValueError("Oversized signed remote inventory")
    return files


def make_delta(deploy_root: Path, remote: dict[str, dict]) -> tuple[int, int, int]:
    client = deploy_root / "client"
    if not (client / "index.html").is_file():
        raise ValueError("Missing newly compiled client/index.html")
    files = collect(client)
    reused = [name for name, meta in files.items() if remote.get(name) == meta]
    saved = sum(files[name]["size"] for name in reused)
    # Marker remains private inside signed ZIP and must be removed by PHP
    # after reconstruction but before activating any live paths.
    marker = deploy_root / "esc-delta-manifest.json"
    if marker.exists() or marker.is_symlink():
        raise ValueError("Delta manifest already exists in compiled release")
    marker.write_text(json.dumps({"format": 1, "files": files, "reuse": reused},
                                 sort_keys=True, separators=(",", ":")), encoding="utf-8")
    for name in reused:
        (client / name).unlink()
    # Remove empty folders only. Keep compiled client/index.html and server/.
    for path in sorted(client.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not path.is_symlink():
            try:
                path.rmdir()
            except OSError:
                pass
    return len(files), len(reused), saved


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("Usage: esc-delta-package.py <compiled-deploy-directory>")
    root = Path(sys.argv[1])
    if not (root / "server/entry.mjs").is_file():
        raise ValueError("SSR server entry missing from new ZIP staging")
    start = time.monotonic()
    mode = os.environ.get("ESC_DELTA_MODE", "auto")
    if mode not in ("auto", "full"):
        raise ValueError("Unsupported delta mode")
    if mode == "full":
        print("ESC_DELTA=FULL explicitly selected; all public assets retained")
        return
    spec = importlib.util.spec_from_file_location("esc_signed", Path(__file__).with_name("esc-signed-unzip.py"))
    signed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(signed)
    config = signed.configuration()
    manifest = signed.post(config, {"action": "manifest", "host": config["host"], "target": config["target"]})
    if manifest.get("format") != 1:
        raise ValueError("Unexpected signed remote public-client manifest version")
    remote = validate_remote(manifest.get("files"))
    total, reused, bytes_saved = make_delta(root, remote)
    print(f"ESC_SIGNED_DELTA=PASS assets={total} reused={reused} bytes_saved={bytes_saved} elapsed_ms={round((time.monotonic()-start)*1000)}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"- Signed client delta: {reused}/{total} assets reused, {bytes_saved} bytes excluded from ZIP.\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as exc:
        print(f"::error::ESC delta package failed: {type(exc).__name__}", file=sys.stderr)
        sys.exit(1)
