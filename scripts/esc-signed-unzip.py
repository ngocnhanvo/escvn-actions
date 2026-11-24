#!/usr/bin/env python3
"""Signed ESC Astro deployment against existing WordPress unzip-v2.php.

check is read-only and fails closed; unpack requires SHA-bound release marker.
Never dump ENV_FILE or the bearer HMAC secret.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zipfile import ZipFile

HOST = re.compile(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")
SHA = re.compile(r"[a-f0-9]{40}")


class RejectRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def value(env: str, key: str) -> str:
    found = []
    for line in env.splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].lstrip()
        if line.startswith(key + "="):
            v = line.split("=", 1)[1].strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            found.append(v)
    if len(found) != 1 or not found[0]:
        raise ValueError("Invalid environment origin: " + key)
    return found[0]


def origin(value: str) -> tuple[str, str]:
    p = urlsplit(value)
    hostname = (p.hostname or "").lower()
    if (p.scheme != "https" or not HOST.fullmatch(hostname) or "." not in hostname
            or ".." in hostname or p.username or p.password or p.port not in (None, 443)
            or p.path not in ("", "/") or p.query or p.fragment):
        raise ValueError("Invalid HTTPS environment origin")
    return "https://" + hostname, hostname


def configuration() -> dict[str, str]:
    raw = os.environ["ENV_FILE"]
    backend, wp_host = origin(value(raw, "WC_URL"))
    frontend, client_host = origin(value(raw, "WC_URL_CLIENT"))
    if wp_host == client_host:
        raise ValueError("WordPress and frontend hosts must differ")
    target = f"/domains/{client_host}/public_html/"
    if os.environ.get("ASTRO_FTP_TARGET", target) != target:
        raise ValueError("FTP target conflicts with WordPress frontend")
    token = os.environ["SOURCE_REPO_PAT"]
    if len(token) < 20:
        raise ValueError("Missing signed deploy secret")
    return {"backend": backend, "frontend": frontend,
            "host": client_host, "target": target, "token": token}


def http_request(url: str, body: bytes | None = None, headers: dict | None = None,
                 timeout: int = 30) -> tuple[int, bytes]:
    req = Request(url, data=body, headers=headers or {}, method="POST" if body is not None else "GET")
    opener = build_opener(RejectRedirect())
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.status, response.read(2 * 1024 * 1024)
    except HTTPError as error:
        raise RuntimeError(f"Signed deploy server returned HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError("Signed deploy endpoint unavailable") from error


def post(config: dict[str, str], data: dict) -> dict:
    raw = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(time.time()))
    # Domain-separated HMAC secret installed outside WordPress webroot, never
    # the SOURCE_REPO_PAT itself. No PAT copied to shared hosting.
    key = hmac.new(config["token"].encode(), b"esc-wordpress-signed-unzip-v2",
                   hashlib.sha256).hexdigest().encode()
    signature = hmac.new(key, timestamp.encode() + b"\n" + raw,
                         hashlib.sha256).hexdigest()
    status, body = http_request(config["backend"] + "/unzip-v2.php", raw, {
        "Content-Type": "application/json", "Cache-Control": "no-store",
        "X-Esc-Deploy-Timestamp": timestamp,
        "X-Esc-Deploy-Signature": signature,
    }, timeout=300 if data["action"] == "unpack" else 30)
    try:
        parsed = json.loads(body)
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("Signed deploy endpoint returned non-JSON") from exc
    if status != 200 or parsed.get("ok") is not True or parsed.get("protocol") != 2:
        raise RuntimeError("Signed deploy endpoint denied request")
    for field in ("host", "target"):
        if parsed.get(field) != config[field]:
            raise RuntimeError("Signed deploy endpoint disagrees on destination: " + field)
    return parsed


def release_zip(config: dict[str, str], path: Path, commit: str) -> str:
    if not SHA.fullmatch(commit):
        raise ValueError("Missing immutable Astro production SHA")
    if not path.is_file():
        raise ValueError("Missing release ZIP")
    with ZipFile(path) as z:
        members = set(z.namelist())
        if ".env" in members or any(n.startswith(".env/") for n in members):
            raise ValueError("Secret .env cannot be included in ZIP")
        for name in ("server/entry.mjs", "client/index.html", "esc-release.json"):
            if name not in members:
                raise ValueError("Release ZIP missing required item: " + name)
        marker = json.loads(z.read("esc-release.json"))
        if marker != {"branch": "master", "commit": commit, "target": config["host"]}:
            raise ValueError("Release ZIP source/target marker mismatch")
        if z.testzip() is not None:
            raise ValueError("Release ZIP CRC failure")
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("check", "unpack"):
        raise ValueError("Usage: esc-signed-unzip.py check|unpack")
    c = configuration()
    common = {"host": c["host"], "target": c["target"]}
    if sys.argv[1] == "check":
        status, marker = http_request(c["backend"] + "/unzip-v2.ready")
        if status != 200 or marker.strip() != b"ESC_ASTRO_UNZIP_PROTOCOL=2":
            raise RuntimeError("Existing WordPress signed unzip v2 marker missing")
        post(c, {"action": "check", **common})
        print("ESC_SIGNED_UNZIP_PREFLIGHT=PASS")
        return
    digest = release_zip(c, Path(os.environ.get("ZIP_PATH", "source/upload/escvn.zip")),
                         os.environ.get("ESC_DEPLOY_COMMIT", ""))
    result = post(c, {"action": "unpack", "sha256": digest, **common})
    if result.get("sha256") != digest or result.get("files_activated", 0) < 2:
        raise RuntimeError("Signed deploy returned invalid release receipt")
    print("ESC_SIGNED_UNZIP=PASS sha_prefix=" + digest[:12])


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as e:
        print("::error::ESC signed deploy failed (" + type(e).__name__ + "): " + str(e), file=sys.stderr)
        sys.exit(1)
