#!/usr/bin/env python3
"""ESC production FTPS. Always authenticate the TLS server certificate.

probe performs an authenticated read-only connection; upload uses a checksum-
bound temporary archive, verifies size and lets signed PHP verify remote SHA256.
"""
from __future__ import annotations

import ftplib
import hashlib
import os
from pathlib import Path
import re
import ssl
import sys
import time
from urllib.parse import urlsplit


def target_from_env(raw: str) -> str:
    lines = [s.partition("=")[2].strip().strip("\"'") for s in raw.splitlines()
             if s.strip().startswith("WC_URL_CLIENT=")]
    if len(lines) != 1:
        raise ValueError("Missing unique frontend origin")
    url = urlsplit(lines[0])
    if (url.scheme != "https" or not url.hostname or url.path not in ("", "/")
            or url.query or url.fragment or url.username or url.password or url.port not in (None, 443)
            or not re.fullmatch(r"[a-z0-9.-]+", url.hostname.lower()) or ".." in url.hostname):
        raise ValueError("Invalid frontend origin")
    return "/domains/" + url.hostname.lower() + "/public_html/"


def connect() -> ftplib.FTP_TLS:
    server = os.environ["FTP_SERVER"].strip()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", server):
        raise ValueError("FTP_SERVER must be a valid hostname")
    if not os.environ.get("FTP_USERNAME") or not os.environ.get("FTP_PASSWORD"):
        raise ValueError("Missing FTP credentials")
    ctx = ssl.create_default_context()
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    # The optional CA bundle is an X.509 certificate chain, never a toggle to
    # disable certificate validation. PSE-equivalent strict verified TLS only.
    extra_ca = os.environ.get("ESC_FTPS_CA_PEM", "")
    if extra_ca:
        ctx.load_verify_locations(cadata=extra_ca)
    ftp = ftplib.FTP_TLS(context=ctx, timeout=25)
    ftp.connect(server, 21, timeout=25)
    ftp.login(os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"])
    ftp.prot_p()
    ftp.set_pasv(True)
    target = target_from_env(os.environ["ENV_FILE"])
    if os.environ.get("ASTRO_FTP_TARGET", target) != target:
        raise ValueError("Remote FTP target mismatch")
    ftp.cwd(target)
    ftp.voidcmd("TYPE I")
    return ftp


def size(ftp: ftplib.FTP_TLS, path: str) -> int:
    try:
        found = ftp.size(path)
    except ftplib.error_perm as ex:
        if str(ex).startswith("550"):
            return 0
        raise
    if found is None:
        raise RuntimeError("FTP SIZE response missing")
    return int(found)


def upload(ftp: ftplib.FTP_TLS, path: Path) -> None:
    expected = path.stat().st_size
    if expected <= 0:
        raise ValueError("Archive must not be empty")
    sha = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            sha.update(chunk)
    temporary = ".escvn-stage-" + sha.hexdigest() + ".zip"
    current = size(ftp, temporary)
    if current > expected:
        ftp.delete(temporary)
        current = 0
    if current < expected:
        with path.open("rb") as f:
            f.seek(current)
            ftp.storbinary("STOR " + temporary, f, blocksize=262144,
                           rest=current if current else None)
    if size(ftp, temporary) != expected:
        raise RuntimeError("FTPS archive size mismatch")
    try:
        ftp.rename(temporary, "escvn.zip")
    except ftplib.error_perm:
        if size(ftp, "escvn.zip") <= 0:
            raise
        ftp.delete("escvn.zip")
        ftp.rename(temporary, "escvn.zip")
    if size(ftp, "escvn.zip") != expected:
        raise RuntimeError("FTPS final archive size mismatch")
    print("ESC_VERIFIED_FTPS=PASS bytes=" + str(expected) + " sha_prefix=" + sha.hexdigest()[:12])


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) == 2 else ""
    if mode not in ("probe", "upload"):
        raise ValueError("Usage: esc-ftps-upload.py probe|upload")
    ftp = None
    try:
        start = time.monotonic()
        ftp = connect()
        if mode == "probe":
            print("ESC_VERIFIED_FTPS_PROBE=PASS elapsed_ms=" + str(int((time.monotonic() - start) * 1000)))
            return
        filename = Path(os.environ.get("ZIP_PATH", "source/upload/escvn.zip"))
        if not filename.is_file():
            raise ValueError("Archive not found")
        upload(ftp, filename)
    finally:
        if ftp:
            try:
                ftp.quit()
            except ftplib.all_errors:
                ftp.close()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, ssl.SSLError, *ftplib.all_errors) as e:
        print("::error::ESC verified FTPS failed (" + type(e).__name__ + ")", file=sys.stderr)
        sys.exit(1)
