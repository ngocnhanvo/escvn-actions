import { chromium } from 'playwright';
import AdmZip from 'adm-zip';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One-time data-only M01 migration through the ESC CV Manager admin's normal
// immutable ZIP upload + activation workflow. No changes to Astro or templates.
const origin = new URL(process.env.WP_ADMIN_URL || 'https://admin.esc.vn').origin;
if (new URL(origin).hostname !== 'admin.esc.vn') throw Error('Wrong WordPress target');
for (const key of ['WP_ADMIN_USERNAME', 'WP_ADMIN_PASSWORD'])
  if (!process.env[key]) throw Error('Missing WordPress credential '+key);
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const admin=origin+'/wp-admin/admin.php?page=esc-cv-manager';
const api=origin+'/wp-json/esc-cv/v1/templates';
const example=(key,collection='',i=0)=>{
  const k=key.toLowerCase(),c=collection.toLowerCase();
  const presets={
    fullname:'Nguyễn Văn A',jobtitle:'Chuyên viên Digital Marketing',
    headline:'Chuyên viên Digital Marketing',position:i?'Nhân viên Marketing':'Chuyên viên Marketing',
    role:i?'Nhân viên Marketing':'Chuyên viên Marketing',
    phone:'090 123 4567',email:'nguyenvana@example.com',
    address:'TP. Hồ Chí Minh',location:'TP. Hồ Chí Minh',
    summary:'Có 5 năm kinh nghiệm xây dựng nội dung, tối ưu chiến dịch và phát triển thương hiệu.',
    objective:'Phát triển chuyên môn và mang lại kết quả đo lường được cho doanh nghiệp.',
    careerobjective:'Trở thành chuyên gia Digital Marketing, đóng góp vào tăng trưởng dài hạn.',
    company:i?'Công ty XYZ':'Công ty ABC',employer:i?'Công ty XYZ':'Công ty ABC',
    period:i?'2020 – 2022':'2022 – Nay',duration:i?'2020 – 2022':'2022 – Nay',
    date:i?'2020 – 2022':'2022 – Nay',
    school:'Đại học Kinh tế TP. Hồ Chí Minh',institution:'Đại học Kinh tế TP. Hồ Chí Minh',
    degree:'Cử nhân Marketing',major:'Marketing',issuer:'Google',year:'2023',
    proficiency:i?'Khá':'Thành thạo',level:i?80:90,percentage:i?80:90,
    githuburl:'https://github.com/nguyenvana',githublabel:'github.com/nguyenvana',
    linkedinurl:'https://www.linkedin.com/',linkedinlabel:'LinkedIn',
    website:'https://example.com',url:'https://example.com',
    avatarurl:'',footernote:'Thông tin trong CV chỉ mang tính minh họa.'
  };
  if(k==='name'){
    if(c.includes('skill'))return ['SEO & Content','Google Ads','Phân tích dữ liệu'][Math.min(i,2)];
    if(c.includes('language'))return ['Tiếng Việt','Tiếng Anh'][Math.min(i,1)];
    if(c.includes('cert'))return 'Google Analytics Certification';
    if(c.includes('project'))return 'Chiến dịch tăng trưởng trực tuyến';
    return c?'Tên mục minh họa':'Nguyễn Văn A';
  }
  if(k in presets)return presets[k];
  if(['text','description','details','achievement','highlight','result','content'].includes(k))
    return c.includes('experience')||c.includes('work')?'Triển khai chiến dịch truyền thông và tối ưu hiệu quả tiếp cận khách hàng.':
      c.includes('education')?'Tốt nghiệp chuyên ngành Marketing và tham gia các dự án thực tế.':
      'Hoàn thành mục tiêu công việc và phối hợp hiệu quả với đội nhóm.';
  if(k.includes('title'))return c?'Dự án phát triển thương hiệu':'Chuyên viên Digital Marketing';
  if(k.includes('date')||k.includes('time'))return '2022 – Nay';
  if(k.includes('email'))return 'nguyenvana@example.com';
  if(k.includes('url')||k.includes('link'))return 'https://example.com';
  return 'Nội dung minh họa';
};
function makeSample(html){
  const root={fields:new Set(),groups:{}},stack=[root];
  const tokens=html.matchAll(/{{\s*(#each\s+([A-Za-z][\w.]*)|\/each|([A-Za-z][\w.]*))\s*}}/g);
  for(const match of tokens){
    if(match[2]){
      const key=match[2].split('.').pop();
      const groups=stack[stack.length-1].groups;
      if(!groups[key])groups[key]={fields:new Set(),groups:{}};
      stack.push(groups[key]);
    }else if(match[1]==='/each'){
      assert(stack.length>1,'Unbalanced /each in M01');stack.pop();
    }else if(match[3]&&match[3]!=='escRowId'){
      if(match[3].startsWith('profile.'))root.fields.add(match[3]);
      else stack[stack.length-1].fields.add(match[3].split('.').pop());
    }
  }
  assert(stack.length===1,'Unbalanced #each in M01');
  assert(Object.keys(root.groups).length>0,'Cannot seed M01 without a collection');
  const data={profile:{}};
  for(const path of root.fields){
    if(path.startsWith('profile.'))data.profile[path.slice(8)]=example(path.slice(8));
    else data[path]=example(path);
  }
  const rows=(groups,dest,parent='')=>{
    for(const [key,group] of Object.entries(groups)){
      const collection=(parent+'.'+key).replace(/^\./,'');
      const amount=/experien|employment|language|job/i.test(key)?2:/skill/i.test(key)?3:1;
      dest[key]=Array.from({length:amount},(_,i)=>{
        const row={};
        for(const field of group.fields)row[field]=example(field,collection,i);
        rows(group.groups,row,collection);
        return row;
      });
    }
  };
  rows(root.groups,data);
  data.profile.fullName='Nguyễn Văn A';
  return data;
}
const hasSample=(sample)=>{
  const p=sample?.profile;
  return typeof p?.fullName==='string'&&p.fullName.trim()&&
    Object.entries(sample).some(([k,v])=>k!=='profile'&&Array.isArray(v)&&
      v.some(x=>x&&typeof x==='object'&&Object.values(x).some(y=>typeof y==='string'&&y.trim())));
};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:920}});
const directory=mkdtempSync(join(tmpdir(),'esc-m01-'));
const goto=url=>page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
const get=async url=>{
  const res=await page.request.get(url+(url.includes('?')?'&':'?')+'cv_seed_check='+Date.now(),{timeout:45000});
  assert(res.ok(),'REST '+res.status()+' '+url);
  return res.json();
};
const findCard=async()=>{
  for(let n=1;n<=30;n++){
    await goto(admin+'&esc_cv_page='+n);
    const root=page.locator('#esc-cv-edit-M01');
    if(await root.count())return root.locator('xpath=ancestor::article');
    if(!(await page.locator('.esc-cv-paging a').count()))break;
  }
  throw Error('M01 not found in WordPress CV Manager');
};
try{
  const registry=await get(api);
  const template=registry.templates?.find(t=>t.id==='M01');
  assert(template&&/^\d+\.\d+\.\d+$/.test(template.version),'Active M01 not found');
  const current=await get(api+'/M01/builder');
  assert(current.version===template.version,'Builder version out of sync');
  if(hasSample(current.sample)){
    console.log('M01 demo already populated, no change needed:',current.version);
  }else{
    await goto(admin);
    if(await page.locator('#user_login').isVisible().catch(()=>false)){
      await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
      await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
      const body=await page.locator('body').innerText();
      const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
      if(m){
        const a=Number(m[1]),b=Number(m[3]);
        const answer=m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
        let field=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i],#loginform input[type=number]').first();
        if(!await field.isVisible().catch(()=>false))
          field=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type=hidden]):not([type=checkbox]):not([type=submit])').first();
        assert(await field.isVisible(),'Cannot find login verification field');
        await field.fill(String(answer));
      }
      await page.locator('#wp-submit').click();
      assert(!page.url().includes('wp-login.php'),'WordPress login failed');
    }
    let card=await findCard();
    await card.locator('details summary').first().click(); // reveal version-history links
    const rows=card.locator('.esc-cv-versions tbody tr');
    const versions=(await rows.locator('td:first-child strong').allTextContents()).map(s=>s.trim());
    assert(versions.includes(template.version),'Active M01 version missing in history');
    const newer=versions.sort((a,b)=>{
      const aa=a.split('.').map(Number),bb=b.split('.').map(Number);
      for(let i=0;i<3;i++)if(aa[i]!==bb[i])return bb[i]-aa[i];
      return 0;
    })[0];
    const active=rows.filter({hasText:'Đang chọn'}).first();
    assert((await active.locator('td:first-child strong').textContent()).trim()===template.version,'M01 active version changed');
    const href=await active.getByRole('link',{name:'Tải ZIP'}).getAttribute('href');
    assert(href,'M01 source ZIP link missing');
    const download=await page.request.get(new URL(href,origin).href,{timeout:60000});
    assert(download.ok()&&/zip/.test(download.headers()['content-type']||''),'M01 source download failed');
    const originalZip=new AdmZip(await download.body());
    const manifestEntry=originalZip.getEntries().find(e=>/^(?:[A-Za-z0-9_-]+\/)?template\.json$/.test(e.entryName));
    assert(manifestEntry,'Cannot find M01 template.json');
    const prefix=manifestEntry.entryName.slice(0,-'template.json'.length);
    const manifest=JSON.parse(manifestEntry.getData().toString('utf8'));
    assert(manifest.id==='M01'&&manifest.engine==='esc-cv-v1','Wrong ZIP/engine');
    const html=originalZip.getEntry(prefix+manifest.entry)?.getData().toString('utf8');
    assert(html&&html.includes('{{profile.fullName}}'),'M01 template HTML unavailable');
    const oldSampleName=typeof manifest.sample==='string'?prefix+manifest.sample:'';
    let oldSample={};
    if(oldSampleName&&originalZip.getEntry(oldSampleName)){
      try{oldSample=JSON.parse(originalZip.getEntry(oldSampleName).getData().toString('utf8'))}catch{}
    }
    assert(!hasSample(oldSample),'ZIP contains usable data but public API did not; investigate before versioning');
    const sample=makeSample(html);
    if(oldSample&&typeof oldSample==='object'&&!Array.isArray(oldSample)){
      for(const [k,v] of Object.entries(oldSample)){
        if(k==='profile'&&v&&typeof v==='object'&&!Array.isArray(v))
          for(const [field,value] of Object.entries(v))
            if(value!==''&&value!==null&&value!==undefined)sample.profile[field]=value;
        else if(Array.isArray(v)&&v.length)sample[k]=v;
        else if(typeof v==='string'&&v.trim())sample[k]=v;
      }
    }
    const vnew=newer.split('.').map(Number);
    vnew[2]++;
    const version=vnew.join('.');
    manifest.version=version;
    manifest.sample='sample-data.json';
    const updated=new AdmZip(await download.body());
    updated.updateFile(manifestEntry.entryName,Buffer.from(JSON.stringify(manifest,null,2)+'\n','utf8'));
    const sampleEntry=prefix+'sample-data.json';
    if(updated.getEntry(sampleEntry))
      updated.updateFile(sampleEntry,Buffer.from(JSON.stringify(sample,null,2)+'\n','utf8'));
    else updated.addFile(sampleEntry,Buffer.from(JSON.stringify(sample,null,2)+'\n','utf8'));
    const sourceEntries=originalZip.getEntries();
    assert(updated.getEntries().length<=100,'ZIP entry limit exceeded');
    for(const entry of sourceEntries){
      if(entry.isDirectory||entry.entryName===manifestEntry.entryName||entry.entryName===sampleEntry)continue;
      assert(updated.getEntry(entry.entryName)?.getData().equals(entry.getData()),'Presentation asset changed: '+entry.entryName);
    }
    const payload=updated.toBuffer();
    assert(payload.length<5242880,'ZIP exceeds 5MB');
    const output=join(directory,'M01-demo-'+version+'.zip');
    writeFileSync(output,payload);
    assert((await get(api+'/M01/builder')).version===template.version,'M01 changed during preparation');
    await card.locator('.esc-cv-edit-launch').click();
    const upload=page.locator('#esc-cv-edit-M01 form');
    await upload.locator('input[name=esc_cv_zip]').setInputFiles(output);
    await upload.getByRole('button',{name:'Upload bản sửa'}).click();
    const notice=new URL(page.url()).searchParams;
    assert(notice.get('esc_cv_notice')==='success','Upload rejected: '+(notice.get('esc_cv_message')||page.url()));
    card=await findCard();
    await card.locator('details summary').first().click(); // activation controls live inside details
    const versionRow=card.locator('.esc-cv-versions tbody tr').filter({has:page.getByText(version,{exact:true})});
    assert(await versionRow.count()===1,'Uploaded M01 version not found');
    const form=versionRow.locator('form').filter({has:page.locator('input[name=operation][value=activate]')});
    assert(await form.count()===1,'Version activation unavailable');
    await form.getByRole('button').click();
    const activation=new URL(page.url()).searchParams;
    assert(activation.get('esc_cv_notice')==='success','Activation rejected: '+(activation.get('esc_cv_message')||page.url()));
    const after=await get(api+'/M01/builder');
    assert(after.version===version,'New M01 version not active');
    assert(hasSample(after.sample),'Builder still has empty sample');
    assert(after.sample.profile.fullName==='Nguyễn Văn A','Demo name incorrect');
    assert(after.html===current.html&&after.css===current.css,'Builder presentation changed');
    console.log('SUCCESS: M01 sample updated and activated:',version,'groups:',Object.keys(sample).filter(k=>k!=='profile').join(','));
  }
}catch(error){
  console.error('M01 demo migration failed:',error?.stack||error);
  await page.screenshot({path:'cvstudio-m01-demo-failure.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
  rmSync(directory,{recursive:true,force:true});
}