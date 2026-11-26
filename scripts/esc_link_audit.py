#!/usr/bin/env python3
"""Read-only public link audit for esc.vn. GET/HEAD only; no CMS writes."""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import csv
import datetime as dt
import json
import pathlib
import re
import threading
import time
import urllib.parse as urlp
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

ROOT = "https://esc.vn/"
HOSTS = {"esc.vn", "www.esc.vn"}
USER_AGENT = "ESC-Link-Audit/1.0 (+https://esc.vn; read-only)"
BLACKLIST = re.compile(
    r"/(?:wp-admin|logout|log-out|signout|delete|remove-item|add-to-cart|"
    r"checkout|order-pay|payment|pay-now)(?:[/?.#]|$)", re.I
)
HTML_EXTENSIONS = {"", ".html", ".htm", ".php", ".asp", ".aspx"}
LEGACY = re.compile(r"escvn\.com", re.I)
HREF_TAGS = [("a", "href"), ("area", "href"), ("link", "href"),
             ("form", "action")]
THREAD = threading.local()
lock = threading.Lock()
last_request = [0.0]


def session():
    if not hasattr(THREAD, "session"):
        s = requests.Session()
        s.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5"})
        THREAD.session = s
    return THREAD.session


def throttle(min_interval=0.12):
    with lock:
        remaining = last_request[0] + min_interval - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
        last_request[0] = time.monotonic()


def normalized(raw, base=ROOT):
    raw = (raw or "").strip()
    if not raw or raw.startswith(("#", "javascript:", "mailto:", "tel:", "sms:", "data:", "blob:")):
        return ""
    try:
        u = urlp.urlsplit(urlp.urljoin(base, raw))
        if u.scheme not in ("https", "http") or not u.hostname:
            return ""
        port = f":{u.port}" if u.port else ""
        return urlp.urlunsplit((u.scheme.lower(), u.hostname.lower() + port,
                               u.path or "/", u.query, ""))
    except (ValueError, TypeError):
        return ""


def on_site(u):
    return urlp.urlsplit(u).hostname in HOSTS


def safe(u):
    return not BLACKLIST.search(urlp.urlsplit(u).path)


def page_candidate(u):
    p = urlp.urlsplit(u)
    if not on_site(u) or not safe(u):
        return False
    ext = pathlib.PurePosixPath(p.path).suffix.lower()
    return ext in HTML_EXTENSIONS and not p.path.startswith((
        "/wp-content/", "/wp-includes/", "/api/", "/wp-json/",
        "/_astro/", "/data/", "/assets/", "/esc-builder/"
    ))


def fetch_page(u):
    try:
        throttle()
        r = session().get(u, timeout=(8, 18), allow_redirects=True)
        body = r.text if "html" in r.headers.get("content-type", "").lower() else ""
        return {"url": u, "status": r.status_code, "final": r.url,
                "html": body, "error": "", "ctype": r.headers.get("content-type", "")}
    except requests.RequestException as e:
        return {"url": u, "status": 0, "final": "", "html": "",
                "error": type(e).__name__ + ": " + str(e)[:160], "ctype": ""}


def probe_url(u):
    # No POST, no GET to endpoints that look like state-changing actions.
    if not safe(u):
        return {"url": u, "status": 0, "final": "", "error": "SKIPPED_UNSAFE"}
    try:
        throttle()
        r = session().head(u, timeout=(7, 14), allow_redirects=True)
        if r.status_code in (400, 403, 405, 406, 429, 500, 501, 502, 503, 504):
            throttle()
            with session().get(u, timeout=(7, 16), allow_redirects=True, stream=True) as g:
                return {"url": u, "status": g.status_code, "final": g.url, "error": ""}
        return {"url": u, "status": r.status_code, "final": r.url, "error": ""}
    except requests.RequestException as e:
        return {"url": u, "status": 0, "final": "", "error": type(e).__name__ + ": " + str(e)[:160]}


def get_sitemaps(max_sitemaps=30):
    pending = collections.deque([urlp.urljoin(ROOT, "/sitemap.xml"),
                                 urlp.urljoin(ROOT, "/sitemap_index.xml"),
                                 urlp.urljoin(ROOT, "/wp-sitemap.xml")])
    seen = set()
    urls = set()
    issues = []
    while pending and len(seen) < max_sitemaps:
        u = pending.popleft()
        if u in seen:
            continue
        seen.add(u)
        try:
            throttle()
            r = session().get(u, timeout=(8, 18))
            if r.status_code != 200:
                issues.append({"url": u, "status": r.status_code})
                continue
            root = ET.fromstring(r.content)
            for el in root.iter():
                if el.tag.endswith("loc") and el.text:
                    loc = normalized(el.text)
                    if not loc:
                        continue
                    if loc.endswith(".xml") and on_site(loc):
                        pending.append(loc)
                    elif on_site(loc):
                        urls.add(loc)
        except (requests.RequestException, ET.ParseError, ValueError) as e:
            issues.append({"url": u, "error": str(e)[:150]})
    return urls, seen, issues


def dump_csv(path, fields, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--page-limit", type=int, default=12000)
    p.add_argument("--url-limit", type=int, default=30000)
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--out", default="link-audit-report")
    a = p.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    sitemap_urls, sitemap_files, sitemap_issues = get_sitemaps()
    queue = collections.deque([ROOT] + sorted(u for u in sitemap_urls if page_candidate(u)))
    queued = set(queue)
    page_results = {}
    edges = []  # Each hyperlink occurrence with exact source page
    legacy_occurrences = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        while queue and len(page_results) < a.page_limit:
            batch = []
            while queue and len(batch) < min(48, a.page_limit - len(page_results)):
                u = queue.popleft()
                if u not in page_results:
                    batch.append(u)
            if not batch:
                continue
            for result in pool.map(fetch_page, batch):
                page = result["url"]
                page_results[page] = {k: v for k, v in result.items() if k != "html"}
                html = result["html"]
                if not html:
                    continue
                soup = BeautifulSoup(html, "html.parser")
                for tag, attr in HREF_TAGS:
                    for node in soup.find_all(tag):
                        raw = node.get(attr)
                        if not isinstance(raw, str):
                            continue
                        target = normalized(raw, result["final"] or page)
                        if not target:
                            continue
                        label = node.get_text(" ", strip=True)[:100]
                        edges.append({"source": page, "target": target, "raw": raw[:300],
                                      "tag": tag, "label": label})
                        if LEGACY.search(raw) or LEGACY.search(target):
                            legacy_occurrences.append({"source": page, "target": target,
                                                       "context": label or tag, "kind": "link"})
                        if page_candidate(target) and target not in queued:
                            queued.add(target)
                            queue.append(target)
                # Capture legacy mentions outside clickable hrefs (e.g., marketing HTML, inline JS).
                if LEGACY.search(html) and not any(x["source"] == page for x in legacy_occurrences):
                    legacy_occurrences.append({"source": page, "target": "",
                                               "context": "HTML body includes escvn.com", "kind": "text"})
            if len(page_results) % 240 < 48:
                print(f"Progress: {len(page_results)} pages / {len(queue)} waiting / {len(edges)} links", flush=True)

    targets = set(x["target"] for x in edges if safe(x["target"]))
    results = dict(page_results)
    to_probe = sorted(targets - set(results))
    # Fail-closed reporting: no undocumented truncation; annotate limits as PARTIAL.
    limits = []
    if queue:
        limits.append(f"PAGE_LIMIT: {len(queue)} queued pages left")
    if len(to_probe) > a.url_limit:
        limits.append(f"URL_LIMIT: {len(to_probe) - a.url_limit} link targets untested")
    to_probe = to_probe[:a.url_limit]
    print(f"Checking {len(to_probe)} unique link destinations (internal and external)...", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as pool:
        for item in pool.map(probe_url, to_probe):
            results[item["url"]] = item

    findings = []
    uncertain = []
    for edge in edges:
        u = edge["target"]
        result = results.get(u)
        if not result:
            continue
        status = result["status"]
        item = {**edge, "status": status, "final": result["final"],
                "error": result.get("error", "")}
        if status in (404, 410) or 500 <= status <= 599:
            findings.append(item)
        elif status in (0, 401, 403, 408, 429) or result.get("error"):
            uncertain.append(item)
    # Failed sitemap pages without inbound links should be reported too.
    for u, r in page_results.items():
        if r["status"] in (404, 410) or r["status"] >= 500:
            if not any(x["target"] == u for x in findings):
                findings.append({"source": "SITEMAP/CRAWL", "target": u, "raw": u,
                                 "tag": "page", "label": "", "status": r["status"],
                                 "final": r["final"], "error": r.get("error", "")})
    findings.sort(key=lambda x: (x["status"], x["target"], x["source"]))
    uncertain.sort(key=lambda x: (x["status"], x["target"], x["source"]))
    legacy_occurrences.sort(key=lambda x: (x["source"], x["target"]))
    dump_csv(out / "broken_links.csv", ["source", "target", "status", "final", "tag", "label", "raw", "error"], findings)
    dump_csv(out / "uncertain_links.csv", ["source", "target", "status", "final", "tag", "label", "raw", "error"], uncertain)
    dump_csv(out / "escvn_com_links.csv", ["source", "target", "kind", "context"], legacy_occurrences)
    dump_csv(out / "all_links.csv", ["source", "target", "tag", "label", "raw"], edges)
    dump_csv(out / "page_status.csv", ["url", "status", "final", "error", "ctype"], page_results.values())
    status_counts = dict(sorted(collections.Counter(x["status"] for x in results.values()).items()))
    summary = {"timestamp_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
               "origin": ROOT, "pages_checked": len(page_results),
               "sitemap_urls": len(sitemap_urls), "sitemap_files": sorted(sitemap_files),
               "sitemap_issues": sitemap_issues, "link_occurrences": len(edges),
               "unique_link_targets": len(targets), "probed_targets": len(to_probe),
               "status_counts": status_counts, "broken_occurrences": len(findings),
               "uncertain_occurrences": len(uncertain),
               "escvn_com_occurrences": len(legacy_occurrences),
               "limits": limits, "complete": not limits}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY_JSON=" + json.dumps(summary, ensure_ascii=False), flush=True)
    for category, rows in [("ESCVN_COM", legacy_occurrences), ("BROKEN", findings), ("UNCERTAIN", uncertain)]:
        for row in rows[:25]:
            print(category, json.dumps(row, ensure_ascii=False)[:450], flush=True)
    # An audit discovering broken links is an audit success, not a CI infrastructure failure.
    if limits:
        print("AUDIT PARTIAL: " + " / ".join(limits), flush=True)


if __name__ == "__main__":
    main()
