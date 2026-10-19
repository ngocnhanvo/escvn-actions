#!/usr/bin/env python3
"""Safely install only ESC Apache root redirect. Does not deploy/overwrite WP theme."""
import hashlib
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

HOST = "admin.esc.vn"
ROOT = f"/domains/{HOST}/public_html"
TARGET = ROOT + "/.htaccess"
BACKUP_DIR = f"/domains/{HOST}/.esc-admin-root-backups"  # Outside public_html
RUN_ID = os.environ["GITHUB_RUN_ID"]
STAGED = ROOT + f"/.esc-admin-root-stage-{RUN_ID}.tmp"
BACKUP = BACKUP_DIR + f"/htaccess-before-{RUN_ID}.bak"
MARKER = b"# ESC ADMIN ROOT FAST REDIRECT"
LOCAL = pathlib.Path("/tmp/esc-admin-root-redirect")
LOCAL.mkdir(parents=True, exist_ok=True)
SOURCE = pathlib.Path("source/.htaccess").read_bytes()
PREFIX, sep, _ = SOURCE.partition(b"# BEGIN WordPress")
if not sep or not PREFIX.startswith(MARKER):
    raise RuntimeError("Expected source .htaccess contains dedicated ESC root rule at file start")
for needed in (b"RewriteCond %{QUERY_STRING} ^$", b"^admin\\.esc\\.vn$", b"https://admin.esc.vn/wp-admin/"):
    if needed not in PREFIX:
        raise RuntimeError("Guard missing in committed Apache rule")
if b"RewriteRule ^$" not in PREFIX or b"[R=302,L]" not in PREFIX:
    raise RuntimeError("Expected narrowly-scoped temporary 302 rule")
admin_host = urllib.parse.urlparse(os.environ["WP_ADMIN_URL"]).hostname
if admin_host != HOST:
    raise RuntimeError("Wrong WordPress target: deployment prohibited")
protocol = os.environ.get("FTP_PROTOCOL", "") or "ftp"
if protocol not in ("ftp", "ftps", "sftp"):
    raise RuntimeError("Unrecognized FTP protocol")
server = os.environ["FTP_SERVER"]
if any(c in server for c in ("'", '"', " ", ";", "\n")):
    raise RuntimeError("Unexpected FTP server syntax")
endpoint = protocol + "://" + server
user, password = os.environ["FTP_USERNAME"], os.environ["FTP_PASSWORD"]
if not user or not password:
    raise RuntimeError("Missing FTP credentials")
def quote(value):
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
def lftp(commands):
    script = ("set cmd:fail-exit yes; set net:max-retries 2; "
              "set net:timeout 25; set net:reconnect-interval-base 3; "
              "set ssl:verify-certificate no; " + commands + "; bye")
    done = subprocess.run(["lftp", "-u", user + "," + password, "-e", script, endpoint],
                          capture_output=True, text=True, timeout=130)
    if done.returncode:
        # Never print command lines or password, as FTP clients may reflect arguments.
        raise RuntimeError("FTP transaction failed (status " + str(done.returncode) + ")")
def get(remote, name):
    path = LOCAL / name
    lftp("get " + quote(remote) + " -o " + quote(str(path)))
    return path.read_bytes()
def put(data, target, name):
    path = LOCAL / name
    path.write_bytes(data)
    lftp("put " + quote(str(path)) + " -o " + quote(target))
def sha(data):
    return hashlib.sha256(data).hexdigest()
def probe(path, status, redirect=None, apache_only=False):
    url = "https://" + HOST + path
    p = subprocess.run(["curl", "--http1.1", "-sS", "-D", "-", "-o", "/dev/null",
                        "-w", "\nESC_HTTP=%{http_code}|%{time_total}\n",
                        "--connect-timeout", "12", "--max-time", "35", url],
                       capture_output=True, text=True, timeout=42)
    if p.returncode:
        raise RuntimeError("GET probe failed: " + path)
    lines = p.stdout.splitlines()
    stats = next((x.split("ESC_HTTP=", 1)[1] for x in lines if x.startswith("ESC_HTTP=")), "")
    if not stats or int(stats.split("|")[0]) != status:
        raise RuntimeError("Unexpected HTTP status for " + path + ": " + stats[:60])
    headers = {}
    for ln in lines:
        if ":" in ln:
            k, _, v = ln.partition(":")
            if k.lower() in ("location", "x-redirect-by"):
                headers[k.lower()] = v.strip()
    if redirect:
        loc = urllib.parse.urlsplit(headers.get("location", ""))
        if loc.hostname != HOST or loc.path != redirect or loc.scheme != "https":
            raise RuntimeError("Wrong redirect target for " + path)
    if apache_only and "x-redirect-by" in headers:
        raise RuntimeError("Root redirect still executed through WordPress")
    print("PASS GET " + path + " " + str(status) + " time=" + stats.split("|")[1]
          + "s" + (" Apache-first" if apache_only else ""), flush=True)

live = get(TARGET, "htaccess-live-before.txt")
if b"# BEGIN WordPress" not in live or b"# END WordPress" not in live:
    raise RuntimeError("Live WordPress .htaccess markers missing - no overwrite permitted")
if b"# ESC ADMIN ROOT FAST REDIRECT" in live:
    if live.startswith(PREFIX):
        print("PASS Already installed; no FTP writes", flush=True)
        for path,code,redir,fast in [
            ("/",302,"/wp-admin/",True),
            ("/wp-admin/",302,"/wp-login.php",False),
            ("/wp-json/",200,None,False),
            ("/?rest_route=%2F",200,None,False)]:
            probe(path,code,redir,fast)
        sys.exit(0)
    raise RuntimeError("Live file has a different existing ESC redirect; refusing modification")
# Keep all hosting-specific directives and WP block unchanged, byte for byte.
new = PREFIX + live
if new.count(live) != 1 or new == live:
    raise RuntimeError("Unexpected patch construction")
print("Validated live .htaccess. Preserving original bytes and WordPress markers.", flush=True)
# Save private backup off webroot; verify both staged and original bytes.
lftp("mkdir -p " + quote(BACKUP_DIR))
put(live, BACKUP, "htaccess-backup.txt")
if get(BACKUP, "htaccess-backup-confirm.txt") != live:
    raise RuntimeError("Off-webroot backup failed SHA-256 comparison")
put(new, STAGED, "htaccess-staged.txt")
if sha(get(STAGED, "htaccess-stage-confirm.txt")) != sha(new):
    raise RuntimeError("Staged Apache rule failed SHA-256 comparison")
print("PASS private backup and staged checksum; activating host-scoped rule", flush=True)
moved_old = False
try:
    lftp("mv " + quote(TARGET) + " " + quote(BACKUP + ".original"))
    moved_old = True
    lftp("mv " + quote(STAGED) + " " + quote(TARGET))
    if sha(get(TARGET, "htaccess-installed.txt")) != sha(new):
        raise RuntimeError("Remote installed checksum mismatch")
    # Rollback-protected verification includes both ways to reach REST API.
    for path,code,redir,fast in [
        ("/",302,"/wp-admin/",True),
        ("/wp-admin/",302,"/wp-login.php",False),
        ("/wp-json/",200,None,False),
        ("/?rest_route=%2F",200,None,False)]:
        probe(path,code,redir,fast)
    print("SUCCESS ESC Apache fast root redirect installed; all REST and login tests PASS.", flush=True)
except Exception:
    if moved_old:
        print("Deployment validation failed; restoring original .htaccess", flush=True)
        try:
            # Rename verified original back. If the new file exists, delete it first.
            lftp("set cmd:fail-exit no; rm -f " + quote(TARGET) +
                 "; set cmd:fail-exit yes; mv " + quote(BACKUP + ".original") +
                 " " + quote(TARGET))
            if sha(get(TARGET, "htaccess-restored.txt")) != sha(live):
                raise RuntimeError("Remote rollback checksum mismatch")
            print("PASS original .htaccess restored byte-for-byte", flush=True)
        except Exception:
            print("CRITICAL: Automatic rollback failed; off-webroot backup remains at "
                  + BACKUP, flush=True)
            raise
    raise
