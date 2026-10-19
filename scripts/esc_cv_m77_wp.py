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
if MODE not in ("probe","prepare","publish"):
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

# Patch only approved M77 declarations from the *actual* original ZIP.
with zipfile.ZipFile(io.BytesIO(asset.content)) as src:
    payload={item.filename:src.read(item.filename) for item in src.infolist() if not item.is_dir()}
old_css=payload[manifest["stylesheet"]].decode("utf-8")
base_rule="width:800px;min-height:1130px"
border_rule=".cv.top{border:2px solid #383f3d;min-height:1125px}"
assert old_css.count(base_rule)==1 and old_css.count(border_rule)==1, "M77 live CSS has drifted: refusing unverified patch"
updated_css=old_css.replace(base_rule,"width:100%;min-width:800px;min-height:1130px").replace(
  border_rule,".cv.top{border:0;min-height:1125px}")
assert updated_css.count(".cv.top{border:0;min-height:1125px}")==1
assert updated_css.replace("width:100%;min-width:800px;min-height:1130px",base_rule).replace(
    ".cv.top{border:0;min-height:1125px}",border_rule)==old_css, "Unintended CSS changes"

available_versions=re.findall(r"\b\d+\.\d+\.\d+\b",summary)
available_versions.append(active)
highest=max(tuple(map(int,item.split("."))) for item in available_versions)
new_version=f"{highest[0]}.{highest[1]}.{highest[2]+1}"
assert new_version!=active and highest[0]<=99 and highest[1]<=999 and highest[2]<=999,"Unexpected version"
new_manifest=dict(manifest,version=new_version)
payload[manifest["stylesheet"]]=updated_css.encode("utf-8")
payload["template.json"]=json.dumps(new_manifest,ensure_ascii=False,indent=2).encode("utf-8")

# Previous (immutable) version stays in WordPress; stage new version separately.
stage=OUTPUT/"package-work"
stage.mkdir(exist_ok=True)
for filename,binary in payload.items():
    assert ".." not in pathlib.PurePosixPath(filename).parts and not filename.startswith("/"),"Bad ZIP path"
    target=stage/filename
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(binary)
(OUTPUT/"M77-new-style.css").write_text(updated_css,encoding="utf-8")
(OUTPUT/"previous-version.txt").write_text(active)
(OUTPUT/"next-version.txt").write_text(new_version)
(OUTPUT/"original-sha256.txt").write_text(hashlib.sha256(asset.content).hexdigest())
print("M77 CSS patch validated",active,"to",new_version,
      "CSS changed only approved width + border declarations",flush=True)
if MODE=="prepare":
    print("PREPARE SUCCESS - ZIP staging; no WordPress write",flush=True)
    sys.exit(0)

# Never publish if work package does not match the known exact original.
expected_old=(OUTPUT/"original-sha256.txt").read_text().strip()
assert expected_old==hashlib.sha256(asset.content).hexdigest(),"M77 source changed between prepare/publish"
assert (OUTPUT/"previous-version.txt").read_text()==active,"M77 active version changed during deployment"
assert (OUTPUT/"next-version.txt").read_text()==new_version,"M77 new version drifted"
with zipfile.ZipFile(io.BytesIO(asset.content)) as original:
    expected_files={x.filename for x in original.infolist() if not x.is_dir()}
assert set(str(x.relative_to(stage)).replace("\\","/") for x in stage.rglob("*") if x.is_file())==expected_files
assert (stage/manifest["stylesheet"]).read_bytes()==updated_css.encode("utf-8")
assert (stage/"template.json").read_bytes()==json.dumps(new_manifest,ensure_ascii=False,indent=2).encode("utf-8")
# Preview is a refreshed screenshot of *the same* original M77 template/demo.
assert (stage/manifest["preview"]).stat().st_size>5000,"New thumbnail not generated"
with io.BytesIO() as binary:
    with zipfile.ZipFile(binary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=8) as archive:
        for item in sorted(stage.rglob("*")):
            if item.is_file():
                archive.write(item,arcname=str(item.relative_to(stage)).replace("\\","/"))
    revised=binary.getvalue()
assert len(revised)<=5*1024*1024 and revised[:2]==b"PK","ZIP too large or invalid"
(OUTPUT/("M77-"+new_version+".zip")).write_bytes(revised)
print("M77 new package validated",new_version,"bytes",len(revised),
      "sha256",hashlib.sha256(revised).hexdigest(),flush=True)

panel=card.select_one("#esc-cv-edit-M77")
assert panel is not None, "M77 edit form not found"
form=panel.select_one("form")
assert form is not None, "M77 editor form missing"
inputs={x.get("name"):x.get("value","") for x in form.select("input[name]") if x.get("type")!="file"}
assert inputs.get("action")=="esc_cv_edit" and inputs.get("template_id")=="M77"
assert re.fullmatch(r"[a-z0-9]{10,}",inputs.get("_wpnonce","")),"M77 edit nonce not found"
upload=req(session,"POST",BASE+"/wp-admin/admin-post.php",data=inputs,
           files={"esc_cv_zip":("M77-"+new_version+".zip",revised,"application/zip")})
assert upload.status_code==200, "M77 edit returned non-200"
assert "Đã lưu bản sửa M77 v"+new_version in upload.text, "M77 ZIP upload not confirmed by plugin"
print("M77 new version saved in WordPress pending activation",new_version,flush=True)

# Activate exact new version through the same ESC CV Manager UI workflow.
newcard=None
for page_no in range(1,16):
    fresh=req(session,"GET",BASE+"/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page="+str(page_no))
    freshsoup=BeautifulSoup(fresh.text,"html.parser")
    for item in freshsoup.select("article.esc-cv-card"):
        if item.select_one("h3") and re.match(r"^M77\s*[—-]",item.select_one("h3").get_text(" ",strip=True)):
            newcard=item;break
    if newcard:break
assert newcard is not None, "M77 missing after update"
activation=None
for candidate in newcard.select("form"):
    fields={x.get("name"):x.get("value","") for x in candidate.select("input[name]")}
    if fields.get("action")=="esc_cv_change" and fields.get("operation")=="activate" and fields.get("version")==new_version:
        activation=fields;break
assert activation and re.fullmatch(r"[a-z0-9]{10,}",activation.get("_wpnonce","")),"Activation nonce missing"
activated=req(session,"POST",BASE+"/wp-admin/admin-post.php",data=activation)
assert activated.status_code==200 and "Đã cập nhật trạng thái template M77" in activated.text,"M77 activation not confirmed"
print("M77 activated",new_version,"old",active,"retained for rollback",flush=True)

# Independent public-facing assertions (no cache assumptions).
public=req(session,"GET",BASE+"/wp-json/esc-cv/v1/templates/M77/builder?cv_qa="+new_version)
assert public.status_code==200,"M77 public Builder REST failed"
current=public.json()
assert current.get("id")=="M77" and current.get("version")==new_version,"Public active version mismatch"
actual_css=current.get("css","")
assert "width:100%;min-width:800px;min-height:1130px" in actual_css
assert ".cv.top{border:0;min-height:1125px}" in actual_css
assert "border:2px solid #383f3d" not in actual_css
print("SUCCESS M77 LIVE version",new_version,
      "CSS root width 100%, border 0, original version retained",flush=True)
