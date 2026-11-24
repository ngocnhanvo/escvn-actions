#!/usr/bin/env python3
"""Synchronize ESC Astro runtime .env over certificate-verified FTPS.

Never place a credential in an Astro release archive or on a public URL.
Verify HTTP denial BEFORE touching a real environment file; unchanged env
is reused, otherwise stage outside document-root, checksum then atomically
replace with a reversible backup.
"""
from __future__ import annotations

import ftplib
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import secrets
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location("esc_ftps", Path(__file__).with_name("esc-ftps-upload.py"))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
MAX_ENV_BYTES = 262144


def exists(ftp: ftplib.FTP_TLS, name: str) -> bool:
    try:
        return ftp.size(name) is not None
    except ftplib.error_perm as exc:
        if str(exc).startswith("550"):
            return False
        raise


def remote_hash(ftp: ftplib.FTP_TLS, name: str) -> str:
    digest = hashlib.sha256()
    ftp.retrbinary("RETR " + name, digest.update)
    return digest.hexdigest()


def denied(host: str) -> bool:
    """Never read or log the response body even when misconfigured."""
    url = "https://" + host + "/.env?esc-guard=" + secrets.token_hex(6)
    try:
        with urlopen(Request(url, headers={"Cache-Control": "no-store"}), timeout=20) as response:
            return response.status in (401, 403, 404)
    except HTTPError as exc:
        return exc.code in (401, 403, 404)
    except URLError as exc:
        raise RuntimeError("Cannot establish HTTP protection of runtime env") from exc


def main() -> None:
    raw = os.environ.get("ENV_FILE", "")
    content = (raw.rstrip("\r\n") + "\n").encode("utf-8")
    if (not raw or len(content) > MAX_ENV_BYTES or b"\x00" in content
            or b"WC_URL_CLIENT=" not in content or b"WC_URL=" not in content):
        raise ValueError("Invalid ESC runtime environment payload")
    target = transport.target_from_env(raw)
    host = target.split("/")[2]
    expected = hashlib.sha256(content).hexdigest()
    parent = target.rsplit("/public_html/", 1)[0]
    remote = target + ".env"
    ftp = None
    temporary = None
    backup = None
    installed = False
    backup_moved = False
    success = False
    try:
        ftp = transport.connect()
        # Do not expose a real .env if hosting is configured incorrectly.
        # A harmless probe is allowed only if the original .env does not exist.
        original_present = exists(ftp, remote)
        if not original_present:
            probe = ("ESC_ENV_PROBE=" + secrets.token_hex(12) + "\n").encode()
            ftp.storbinary("STOR " + remote, io.BytesIO(probe))
            try:
                if not denied(host):
                    raise RuntimeError("Public .env HTTP guard is absent")
            finally:
                ftp.delete(remote)
        elif not denied(host):
            raise RuntimeError("Existing public .env is exposed by HTTPS")
        if original_present and remote_hash(ftp, remote) == expected:
            ftp.sendcmd("SITE CHMOD 600 " + remote)
            print("ESC_RUNTIME_ENV=PASS unchanged=true guarded=true")
            return
        temporary = parent + "/.esc-env-" + secrets.token_hex(10) + ".incoming"
        backup = parent + "/.esc-env-" + secrets.token_hex(10) + ".rollback"
        if exists(ftp, temporary) or exists(ftp, backup):
            raise RuntimeError("Runtime env staging collision")
        ftp.storbinary("STOR " + temporary, io.BytesIO(content), blocksize=65536)
        ftp.sendcmd("SITE CHMOD 600 " + temporary)
        if remote_hash(ftp, temporary) != expected:
            raise RuntimeError("Runtime env staging checksum mismatch")
        if original_present:
            ftp.rename(remote, backup)
            backup_moved = True
        ftp.rename(temporary, remote)
        installed = True
        ftp.sendcmd("SITE CHMOD 600 " + remote)
        if remote_hash(ftp, remote) != expected or not denied(host):
            raise RuntimeError("Runtime env activation verification failed")
        success = True
        print("ESC_RUNTIME_ENV=PASS unchanged=false guarded=true")
    finally:
        if ftp:
            if not success and installed:
                try:
                    if exists(ftp, remote):
                        ftp.delete(remote)
                except ftplib.all_errors:
                    pass
            if not success and backup_moved:
                try:
                    ftp.rename(backup, remote)
                    backup_moved = False
                except ftplib.all_errors:
                    print("::error::ESC_RUNTIME_ENV_ROLLBACK=MANUAL_REVIEW_REQUIRED", file=sys.stderr)
            if temporary:
                try:
                    if exists(ftp, temporary):
                        ftp.delete(temporary)
                except ftplib.all_errors:
                    pass
            if backup and success and backup_moved:
                try:
                    ftp.delete(backup)
                except ftplib.all_errors:
                    pass
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, *ftplib.all_errors) as exc:
        print("::error::ESC runtime FTPS failed: " + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
