#!/usr/bin/env python3
"""ESC CV Manager original template width normalization, versioned and reversible.
Only the strictly-known CSS family M27..M76, excluding M48. No Astro/FTP edits.
prepare: read-only on WordPress, create local 1.0.1 staging from each original ZIP.
publish: upload pending 1.0.1 then activate via existing WP admin nonces, verify REST.
"""
import hashlib,io,json,os,pathlib,re,time,zipfile
from urllib.parse import urlparse,urljoin
import requests
from bs4 import BeautifulSoup
BASE="https://admin.esc.vn"
ROOT=pathlib.Path("qa-legacy-batch")
ROOT.mkdir(exist_ok=True)
IDS=["M"+str(i) for i in range(27,77) if i!=48]
OLD=".cv{display:grid;grid-template-columns:34% 66%;width:800px;min-height:1130px;margin:0 auto;background:white;"
NEW=".cv{display:grid;grid-template-columns:34% 66%;width:100%;min-width:800px;min-height:1130px;margin:0 auto;background:white;"
assert len(IDS)==49
MODE=os.environ.get("LEGACY_MODE","prepare")
assert MODE in ("prepare","publish")
def req(session,method,url,**kwargs):
  parts=urlparse(url)
  if parts.scheme!="https" or parts.hostname!="admin.esc.vn":
    raise RuntimeError("Unexpected WP target; refusing operation")
  response=session.request(method,url,allow_redirects=True,timeout=70,**kwargs)
  if urlparse(response.url).hostname!="admin.esc.vn":
    raise RuntimeError("Unexpected external redirect; refusing")
  return response
def login():
  user=os.environ.get("WP_ADMIN_USERNAME","").strip()
  password=os.environ.get("WP_ADMIN_PASSWORD","")
  if not user or not password:raise RuntimeError("Missing ESC WP credentials")
  s=requests.Session()
  req(s,"GET",BASE+"/wp-login.php")
  result=req(s,"POST",BASE+"/wp-login.php",
    data={"log":user,"pwd":password,"wp-submit":"Log In",
       "redirect_to":BASE+"/wp-admin/admin.php?page=esc-cv-manager","testcookie":"1"},
    headers={"Referer":BASE+"/wp-login.php"})
  if "wordpress_logged_in_" not in " ".join(s.cookies.keys()):
    raise RuntimeError("WP authentication failed")
  print("AUTH ESC CV Manager SUCCESS (no credentials logged)",flush=True)
  return s
def cardid(tag):
  head=tag.select_one("h3")
  m=re.match(r"^(M\d+)\s*[—-]",head.get_text(" ",strip=True)) if head else None
  return m.group(1) if m else None
def listcards(s):
  found={}
  for page in range(1,18):
    r=req(s,"GET",BASE+f"/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page={page}")
    if r.status_code!=200 or "ESC CV Manager" not in r.text:
      raise RuntimeError("ESC CV Manager page inaccessible")
    cards=BeautifulSoup(r.text,"html.parser").select("article.esc-cv-card")
    if not cards:break
    for card in cards:
      id=cardid(card)
      if id and id in IDS:found[id]=card
    if len(cards)<12:break
  return found
def active_version(card):
  m=re.search(r"Phiên bản đang chọn:\s*(\d+\.\d+\.\d+)",card.get_text(" ",strip=True))
  return m.group(1) if m else ""
def original_zip(s,card,id,version):
  url=next((urljoin(BASE,a.get("href")) for a in card.select("a[href]")
      if a.get_text(" ",strip=True)=="Tải ZIP" and "version="+version in a.get("href","")),None)
  if not url:raise RuntimeError(id+": active ZIP URL not found")
  r=req(s,"GET",url)
  if r.status_code!=200 or r.content[:2]!=b"PK":raise RuntimeError(id+": original ZIP unavailable")
  return r.content
def inputs(form):
  return {e.get("name"):e.get("value","") for e in form.select("input[name]") if e.get("type")!="file"}
def is_selected(card):
  summary=card.get_text(" ",strip=True)
  return "Đang công khai trong kho" in summary and "Đã xóa khỏi kho" not in summary
def cv_version(row):
  return row["old"].split(".")[:2]+["1"]
def prepare():
  s=login()
  cards=listcards(s)
  manifest=[]
  if len(cards)!=49:print("Unexpected found cards",len(cards),flush=True)
  for id in IDS:
    if id not in cards:raise RuntimeError("Missing original template "+id)
    card=cards[id]
    if not is_selected(card):raise RuntimeError("Inactive/archived expected CV "+id)
    active=active_version(card)
    if active!="1.0.0":raise RuntimeError(id+" active unexpectedly differs from audited 1.0.0: "+active)
    original=original_zip(s,card,id,active)
    data={}
    with zipfile.ZipFile(io.BytesIO(original)) as z:
      if z.testzip() is not None:raise RuntimeError(id+" ZIP checksum failed")
      data={zi.filename:z.read(zi.filename) for zi in z.infolist() if not zi.is_dir()}
    meta=json.loads(data["template.json"])
    if (meta.get("id"),meta.get("version"),meta.get("engine"),meta.get("schema"))!=(
       id,active,"esc-cv-v1","esc-cv-v1"):
      raise RuntimeError(id+" manifest not matching protected template")
    stylesheet=meta["stylesheet"]
    before=data[stylesheet].decode("utf8")
    if before.count(OLD)!=1 or before.count(NEW)!=0:
      raise RuntimeError(id+" CSS not in pre-approved 800px family, refusing bulk edit")
    after=before.replace(OLD,NEW)
    if after.replace(NEW,OLD)!=before:
      raise RuntimeError(id+" unauthorized CSS difference")
    meta["version"]="1.0.1"
    data[stylesheet]=after.encode("utf8")
    data["template.json"]=json.dumps(meta,ensure_ascii=False,indent=2).encode("utf8")
    folder=ROOT/id
    folder.mkdir(exist_ok=True)
    stage=folder/"stage"
    for path,b in data.items():
      p=pathlib.PurePosixPath(path)
      if p.is_absolute() or ".." in p.parts or "\x00" in path:raise RuntimeError("Unexpected ZIP path in "+id)
      target=stage/path
      target.parent.mkdir(parents=True,exist_ok=True)
      target.write_bytes(b)
    (folder/"original.zip").write_bytes(original)
    row={"id":id,"old":active,"new":"1.0.1","source_sha":hashlib.sha256(original).hexdigest(),
      "stylesheet":stylesheet,"preview":meta["preview"],
      "original_bytes":len(original),
      "count_files":len(data)}
    manifest.append(row)
    print("PREPARED",id,"1.0.0 => 1.0.1","original_sha256",row["source_sha"][:16],
      "CSS EXACT PATCH",flush=True)
  (ROOT/"batch.json").write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding="utf8")
  print("PREPARE SUCCESS",len(manifest),"templates. NO WORDPRESS WRITES",flush=True)

def post_admin(s,card,id,action,**kwargs):
  if action=="edit":
    form=card.select_one("#esc-cv-edit-"+id+" form")
    if form is None:raise RuntimeError(id+" edit form missing")
    data=inputs(form)
    if data.get("action")!="esc_cv_edit" or data.get("template_id")!=id or not data.get("_wpnonce"):
      raise RuntimeError(id+" edit security fields changed")
    result=req(s,"POST",BASE+"/wp-admin/admin-post.php",data=data,**kwargs)
    if result.status_code!=200:return False
    return "Đã lưu bản sửa "+id in result.text
  raise RuntimeError("Wrong operation")
def get_latest_card(s,id):
  # Changing a template updates its timestamp and brings it to page one.
  for n in (1,2,3):
    r=req(s,"GET",BASE+"/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page="+str(n))
    if r.status_code!=200:raise RuntimeError("WP admin unavailable")
    for card in BeautifulSoup(r.text,"html.parser").select("article.esc-cv-card"):
      if cardid(card)==id:return card
  raise RuntimeError(id+" cannot locate updated card")
def activate(s,card,id,version):
  for form in card.select("form"):
    values=inputs(form)
    if (values.get("action"),values.get("operation"),values.get("template_id"),values.get("version"))==(
        "esc_cv_change","activate",id,version):
      if not values.get("_wpnonce"):raise RuntimeError(id+" activation nonce missing")
      r=req(s,"POST",BASE+"/wp-admin/admin-post.php",data=values)
      return r.status_code==200 and "Đã cập nhật trạng thái template "+id in r.text
  raise RuntimeError(id+" activation form for "+version+" missing")
def verify(s,id,version):
  r=req(s,"GET",BASE+"/wp-json/esc-cv/v1/templates/"+id+"/builder?width_qa="+version+"&t="+str(time.time_ns()),
        headers={"Cache-Control":"no-cache"})
  if r.status_code!=200:return False
  doc=r.json()
  return doc.get("id")==id and doc.get("version")==version and NEW in doc.get("css","") and OLD not in doc.get("css","")
def publish():
  path=ROOT/"batch.json"
  if not path.is_file():raise RuntimeError("Missing prepared and audited manifest")
  rows=json.loads(path.read_text("utf8"))
  if len(rows)!=49 or set(x["id"] for x in rows)!=set(IDS):
    raise RuntimeError("Batch scope drift; no changes permitted")
  s=login()
  cards=listcards(s)
  failures=[]
  completed=[]
  for index,row in enumerate(rows,1):
    id=row["id"]
    try:
      old=row["old"];new=row["new"]
      if old!="1.0.0" or new!="1.0.1":raise RuntimeError("Unexpected release version")
      meta=json.loads((ROOT/id/"stage/template.json").read_text("utf8"))
      if (meta.get("id"),meta.get("version"),meta.get("stylesheet"),meta.get("preview"))!=(
        id,new,row["stylesheet"],row["preview"]):
        raise RuntimeError("Staged metadata mismatch")
      css=(ROOT/id/"stage"/row["stylesheet"]).read_text("utf8")
      orig=(ROOT/id/"original.zip").read_bytes()
      if hashlib.sha256(orig).hexdigest()!=row["source_sha"]:raise RuntimeError("Backup checksum mismatch")
      if css.count(NEW)!=1 or css.count(OLD)!=0:raise RuntimeError("CSS patch drift")
      payload={}
      for p in (ROOT/id/"stage").rglob("*"):
        if p.is_file():payload[str(p.relative_to(ROOT/id/"stage")).replace("\\","/")]=p.read_bytes()
      with zipfile.ZipFile(io.BytesIO(orig)) as z:
        original_files={x.filename:x for x in z.infolist() if not x.is_dir()}
        if set(payload)!=set(original_files):raise RuntimeError("New ZIP changed file set")
        original_css=z.read(row["stylesheet"]).decode("utf8")
        if css.replace(NEW,OLD)!=original_css:raise RuntimeError("Unexpected template design change")
      with io.BytesIO() as data:
        with zipfile.ZipFile(data,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=8) as z:
          for name in sorted(payload):
            z.writestr(name,payload[name])
        newzip=data.getvalue()
      if len(newzip)>5*1024*1024 or newzip[:2]!=b"PK":
        raise RuntimeError("Invalid size/format")
      (ROOT/id/(id+"-"+new+".zip")).write_bytes(newzip)
      card=cards.get(id)
      if card is None:raise RuntimeError("Missing old card")
      if not is_selected(card) or active_version(card)!=old:
        raise RuntimeError("Active version or visibility changed; refusing")
      current=original_zip(s,card,id,old)
      if hashlib.sha256(current).hexdigest()!=row["source_sha"]:
        raise RuntimeError("Original ZIP changed; refusing publish")
      if not post_admin(s,card,id,"edit",files={"esc_cv_zip":(id+"-"+new+".zip",newzip,"application/zip")}):
        raise RuntimeError("ESC CV Manager rejected new package")
      print("UPLOADED PENDING",id,new,index,"/",len(rows),flush=True)
      fresh=get_latest_card(s,id)
      if not activate(s,fresh,id,new):
        raise RuntimeError("ESC CV Manager activation failed (old remains active)")
      if not verify(s,id,new):
        # Restore old version if new REST data is invalid.
        print("WARN: public REST mismatch, attempting M"+id+" rollback",flush=True)
        rollback_card=get_latest_card(s,id)
        activate(s,rollback_card,id,old)
        raise RuntimeError("Post-activation public validation failed; rollback attempted")
      completed.append(id)
      print("ACTIVATED PASS",id,"v"+new,"Builder REST correct; original retained",
        len(completed),"/",len(rows),flush=True)
      time.sleep(.6)
    except Exception as exc:
      failures.append({"id":id,"reason":str(exc)[:220]})
      print("FAILED",id,str(exc)[:220],flush=True)
      # Do not use stale card state to post to remaining templates.
      cards=listcards(s)
      continue
  report={"expected":len(rows),"successful":len(completed),
       "updated":completed,"failed":failures}
  (ROOT/"deploy-report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf8")
  print("FINAL DEPLOY REPORT",json.dumps(report,ensure_ascii=False),flush=True)
  if failures:raise SystemExit("Some original CVs were not updated; see report")
  print("SUCCESS: all 49 legacy CSS fixes saved + activated; M77 / M26 / M48 / M78 / M79 unchanged",flush=True)
if MODE=="prepare":prepare()
else:publish()
