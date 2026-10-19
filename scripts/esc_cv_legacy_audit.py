#!/usr/bin/env python3
"""Read-only audit of existing ESC CV Manager template CSS.
Only IDs in the original ESC-generated range M27..M76 / M78..M79 are candidates;
M77 has already been approved and updated, and user-uploaded M80+ are excluded.
No database writes, ZIP modifications, uploads or private draft access.
"""
import io,json,os,re,zipfile,hashlib,time
from html import unescape
from urllib.parse import urljoin,urlparse
from pathlib import Path
import requests
from bs4 import BeautifulSoup
BASE="https://admin.esc.vn"
OUT=Path("qa-legacy-cv");OUT.mkdir(exist_ok=True)
def req(s,method,url,**kwargs):
  assert urlparse(url).hostname=="admin.esc.vn" and urlparse(url).scheme=="https", "Unexpected host"
  r=s.request(method,url,timeout=50,allow_redirects=True,**kwargs)
  assert urlparse(r.url).hostname=="admin.esc.vn","Redirect to untrusted domain"
  return r
s=requests.Session()
user=os.environ.get("WP_ADMIN_USERNAME","").strip()
pwd=os.environ.get("WP_ADMIN_PASSWORD","")
assert user and pwd,"Missing credentials"
req(s,"GET",BASE+"/wp-login.php")
login=req(s,"POST",BASE+"/wp-login.php",data={"log":user,"pwd":pwd,"wp-submit":"Log In",
  "redirect_to":BASE+"/wp-admin/admin.php?page=esc-cv-manager","testcookie":"1"},
  headers={"Referer":BASE+"/wp-login.php"})
assert "wordpress_logged_in_" in " ".join(s.cookies.keys()),"Not authenticated"
records=[]
for page in range(1,18):
  res=req(s,"GET",BASE+f"/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page={page}")
  assert res.status_code==200 and "ESC CV Manager" in res.text
  soup=BeautifulSoup(res.text,"html.parser")
  cards=soup.select("article.esc-cv-card")
  if not cards:break
  for card in cards:
    head=card.select_one("h3")
    m=re.match(r"^(M\d+)\s*[—-]",head.get_text(" ",strip=True)) if head else None
    if not m:continue
    id=m.group(1)
    summary=card.get_text(" ",strip=True)
    match=re.search(r"Phiên bản đang chọn:\s*(\d+\.\d+\.\d+)",summary)
    if not match:continue
    active=match.group(1)
    rec={"id":id,"active":active,"eligible":bool(re.fullmatch(r"M(?:[2-6]\d|7[0-6]|7[89])",id)),
         "visible":"Đang công khai trong kho" in summary,
         "archived":"Đã xóa khỏi kho" in summary,
         "title":head.get_text(" ",strip=True)[:100]}
    link=next((x.get("href") for x in card.select("a[href]") if x.get_text(" ",strip=True)=="Tải ZIP" and "version="+active in x.get("href","")),None)
    if rec["eligible"] and rec["visible"] and not rec["archived"] and link:
      zipresp=req(s,"GET",urljoin(BASE,link))
      assert zipresp.status_code==200 and zipresp.content[:2]==b"PK","Missing ZIP for "+id
      rec["sha256"]=hashlib.sha256(zipresp.content).hexdigest()
      with zipfile.ZipFile(io.BytesIO(zipresp.content)) as z:
        manifest=json.loads(z.read("template.json"))
        assert manifest["id"]==id and manifest["version"]==active
        css=z.read(manifest["stylesheet"]).decode("utf8")
        rec["manifest"]={"entry":manifest["entry"],"stylesheet":manifest["stylesheet"],
          "preview":manifest["preview"],"engine":manifest.get("engine"),"schema":manifest.get("schema")}
        rec["css_bytes"]=len(css)
        rec["rule_cv"]=[x.strip() for x in re.findall(r"(?:(?<![-\w])\.cv(?=[\s.{:#>]|$)[^{]*|body[^{]*|html[^{]*)\{[^}]*\}",css) if "width:" in x or "border:" in x][:12]
        rec["fixed_widths"]=re.findall(r"(?:max-|min-)?width\s*:\s*\d{3,4}px",css)
        rec["outer_borders"]=re.findall(r"\.cv(?:\.[\w-]+)*\s*\{[^}]*\bborder\s*:\s*[^;}]+",css)
        rec["layout_hint"]={"cv800":bool(re.search(r"(?<![\d])width\s*:\s*800px",css)),
          "cv100":bool(re.search(r"width\s*:\s*100%",css)),"borderOuter":bool(rec["outer_borders"])}
        (OUT/(id+".css")).write_text(css,encoding="utf8")
    records.append(rec)
  print("AUDIT page",page,"cards",len(cards),"total so far",len(records),flush=True)
  if len(cards)<12:break
(OUT/"summary.json").write_text(json.dumps(records,indent=2,ensure_ascii=False),encoding="utf8")
print("AUDIT TEMPLATE COUNT",len(records),flush=True)
for rec in sorted(records,key=lambda a:int(a["id"][1:])):
  if rec.get("sha256"):print("AUDIT",json.dumps(rec,ensure_ascii=False),flush=True)
print("AUDIT COMPLETE (read-only; no versions added and no activation)",flush=True)
