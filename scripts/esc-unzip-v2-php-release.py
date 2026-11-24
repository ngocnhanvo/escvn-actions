#!/usr/bin/env python3
"""Reversible FTPS promotion of existing escvn-php signed unzip-v2 endpoint.

Only two allowlisted files, from escvn-php/master, are touched. Everything
else in WordPress/public_html is preserved. Signed live readback is mandatory.
"""
from __future__ import annotations

import ftplib
import hashlib
import importlib.util
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

SCRIPT = Path(__file__).with_name("esc-ftps-upload.py")
spec = importlib.util.spec_from_file_location("esc_ftps_transport", SCRIPT)
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
FILES = ("unzip-v2.php", "unzip-v2.ready")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exists(ftp: ftplib.FTP_TLS, path: str) -> bool:
    try:
        ftp.size(path)
        return True
    except ftplib.error_perm as exc:
        if str(exc).startswith("550"):
            return False
        raise


def remote_sha(ftp: ftplib.FTP_TLS, path: str) -> str:
    h = hashlib.sha256()
    ftp.retrbinary("RETR " + path, h.update)
    return h.hexdigest()


def main() -> None:
    raw = os.environ["ENV_FILE"]
    origins = [line.split("=", 1)[1].strip().strip("\"'") for line in raw.splitlines()
               if line.strip().startswith("WC_URL=")]
    if len(origins) != 1:
        raise ValueError("Missing unique WordPress production origin")
    parsed = urlsplit(origins[0])
    wp_host = (parsed.hostname or "").lower()
    if (parsed.scheme != "https" or not wp_host.endswith(".esc.vn")
            or wp_host != "admin.esc.vn" or parsed.port not in (None, 443)
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("Refusing unexpected WordPress deployment target")
    if not os.environ.get("SOURCE_REPO_PAT"):
        raise ValueError("Missing signed endpoint authorization")
    root = "/domains/" + wp_host
    live = root + "/public_html/"
    source = Path(os.environ.get("ESC_PHP_ROOT", "backend"))
    data = {name: (source/name).read_bytes() for name in FILES}
    if data["unzip-v2.ready"] != b"ESC_ASTRO_UNZIP_PROTOCOL=2\n":
        raise ValueError("Invalid signed protocol marker")
    for name, payload in data.items():
        if not payload or len(payload) > 1024 * 1024:
            raise ValueError("Invalid release asset: " + name)
    ftp = None
    staged = {}
    backups = {}
    installed = []
    release_ok = False
    run_id = secrets.token_hex(10)
    try:
        ftp = transport.connect()
        ftp.cwd(root)
        for name, payload in data.items():
            dest = live + name
            stage = root + "/.esc-unzip-v2-" + run_id + "-" + name + ".incoming"
            backup = root + "/.esc-unzip-v2-" + run_id + "-" + name + ".rollback"
            if exists(ftp, stage) or exists(ftp, backup):
                raise RuntimeError("Unexpected pre-existing release path")
            import io
            ftp.storbinary("STOR " + stage, io.BytesIO(payload), blocksize=65536)
            if remote_sha(ftp, stage) != digest(payload):
                raise RuntimeError("FTPS stage checksum mismatch: " + name)
            staged[name] = stage
            backups[name] = backup if exists(ftp, dest) else None
        for name in FILES:
            dest = live + name
            if backups[name] is not None:
                ftp.rename(dest, backups[name])
            # Include attempted file in rollback even if activation fails.
            installed.append(name)
            ftp.rename(staged[name], dest)
            if remote_sha(ftp, dest) != digest(data[name]):
                raise RuntimeError("FTPS promoted source checksum mismatch: " + name)
        # Authenticated readback confirms correct frontend host, signed PHP
        # identity and HMAC secret BEFORE the new v2 endpoint is accepted.
        check = subprocess.run([sys.executable, str(Path(__file__).with_name("esc-signed-unzip.py")), "check"],
                               capture_output=True, text=True, timeout=90)
        if check.returncode != 0:
            raise RuntimeError("Live signed preflight failed; restoring previous WordPress files")
        release_ok = True
        print("ESC_PHP_UNZIP_V2=PASS paths=2 signed_check=PASS")
    except BaseException:
        if ftp:
            errors = 0
            for name in reversed(installed):
                dest = live + name
                try:
                    if exists(ftp, dest):
                        ftp.delete(dest)
                    if backups.get(name):
                        ftp.rename(backups[name], dest)
                except ftplib.all_errors:
                    errors += 1
            if errors:
                print("::error::ESC_UNZIP_ROLLBACK=MANUAL_REVIEW_REQUIRED count=" + str(errors), file=sys.stderr)
        raise
    finally:
        if ftp:
            for path in staged.values():
                try:
                    if exists(ftp, path):
                        ftp.delete(path)
                except ftplib.all_errors:
                    pass
            # Backups are deleted ONLY after signed readback was successful.
            if release_ok:
                for name in FILES:
                    path = backups.get(name)
                    if path:
                        try:
                            # If rollback happened, backup was moved back.
                            if (exists(ftp, path) and exists(ftp, live + name)
                                    and remote_sha(ftp, live + name) == digest(data[name])):
                                ftp.delete(path)
                        except ftplib.all_errors:
                            pass
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, *ftplib.all_errors) as exc:
        print("::error::ESC WordPress signed unzip release failed: " + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
