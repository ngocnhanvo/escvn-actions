#!/usr/bin/env python3
"""M77-only WordPress ESC CV Manager operation. Never modifies other templates."""
import io, json, os, re, sys, zipfile, hashlib, pathlib
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BASE="https://admin.esc.vn"
OUTPUT=pathlib.Path("qa-m77-source")
OUTPUT.mkdir(exist_ok=True)
MODE=os.environ.get("M77_MODE","probe")
if MODE not in ("probe","publish"):
    raise SystemExit("Unsupported operation")
def req(session,method,url,**kwargs):
    if urlparse(url).hostname!="admin.esc.vn" or urlparse(url).scheme!="https":
        raise RuntimeError("Refusing external WordPress URL")
    r=session.request(method,url,timeout=70,allow_redirects=True,**kwargs)
    if urlparse(r.url).hostname!="admin.esc.vn":
        raise RuntimeError("Unexpected WordPress redirect to another host")
    return r
user=os.getenv("WP_ADMIN_USERNAME","").strip()
password=os.getenv("WP_ADMIN_PASSWORD","")
assert user and password, "Missing ESC WordPress login secrets"
session=requests.Session()
login=req(session,"GET",BASE+"/wp-login.php")
print("LOGIN GET",login.status_code,"bytes",len(login.content),flush=True)
login_result=req(session,"POST",BASE+"/wp-login.php",
     data={"log":user,"pwd":password,"wp-submit":"Log In","redirect_to":BASE+"/wp-admin/admin.php?page=esc-cv-manager","testcookie":"1"},
     headers={"Referer":BASE+"/wp-login.php"})
assert "wordpress_logged_in_" in " ".join(session.cookies.keys()), "WordPress login cookie missing (authentication not completed)"
print("LOGIN session obtained (credentials and cookie hidden)",flush=True)
card=None; doc=None
for page in range(1,16):
    admin=req(session,"GET",BASE+"/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page="+str(page))
    assert admin.status_code==200 and "ESC CV Manager" in admin.text,"ESC CV Manager access not ready"
    soup=BeautifulSoup(admin.text,"html.parser")
    for item in soup.select("article.esc-cv-card"):
        head=item.select_one("h3")
        if head and re.match(r"^M77\s*[—-]",head.get_text(" ",strip=True)):
            card=item; doc=soup; break
    if card:break
assert card is not None,"M77 not present in accessible active registry pages"
summary=card.get_text(" ",strip=True)
active_match=re.search(r"Phiên bản đang chọn:\s*(\d+\.\d+\.\d+)",summary)
assert active_match,"M77 has no active version"
active=active_match.group(1)
download=None
for link in card.select("a[href]"):
    if link.get_text(" ",strip=True)=="Tải ZIP" and "version="+active in link.get("href",""):
        download=urljoin(BASE,link["href"]);break
assert download is not None, "Versioned M77 original ZIP download URL not found"
asset=req(session,"GET",download)
assert asset.status_code==200 and asset.content[:2]==b"PK", "Original M77 ZIP download failed"
saved=OUTPUT/("M77-original-v"+active+".zip")
saved.write_bytes(asset.content)
with zipfile.ZipFile(io.BytesIO(asset.content)) as source:
    files=source.namelist()
    assert "template.json" in files, "Missing template manifest"
    manifest=json.loads(source.read("template.json"))
    assert manifest["id"]=="M77" and manifest["version"]==active
    css=source.read(manifest["stylesheet"]).decode("utf-8")
    (OUTPUT/"M77-current.css").write_text(css,encoding="utf-8")
    (OUTPUT/"M77-manifest.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding="utf-8")
print("M77 current",active,"ZIP bytes",len(asset.content),"sha256",hashlib.sha256(asset.content).hexdigest(),flush=True)
print("M77 package paths",json.dumps(files,ensure_ascii=False),flush=True)
print("M77 stylesheet",manifest["stylesheet"],"bytes",len(css),flush=True)
print("M77 preview",manifest["preview"],flush=True)
print("M77 final CSS rules",repr(css[-600:]),flush=True)
if MODE=="probe":
    print("PROBE SUCCESS - NO WORDPRESS TEMPLATE WRITE",flush=True)
    sys.exit(0)
raise RuntimeError("Publish stage not enabled until original ZIP structure is confirmed")
