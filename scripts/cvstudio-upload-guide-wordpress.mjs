/**
 * One-time guarded ESC CV Studio content release. Publishes one standards guide
 * as a WordPress article and patches ONLY upload_button in cvstudio_02.
 * Does not add a Table shortcode or modify any other website/project.
 */
import {chromium} from 'playwright';
const env=['WP_ADMIN_URL','WP_ADMIN_USERNAME','WP_ADMIN_PASSWORD'];
for(const key of env)if(!process.env[key])throw Error('Missing '+key);
const origin=new URL(process.env.WP_ADMIN_URL).origin;
if(new URL(origin).hostname!=='admin.esc.vn')throw Error('Unexpected WordPress target');
const slug='huong-dan-chuan-hoa-mau-cv';
const title='Hướng dẫn chuẩn hóa mẫu CV để chỉnh sửa trực tuyến trên ESC CV Studio';
const html=[
'<p>ESC CV Studio cho phép tải lên mẫu CV của bạn. Để thay đổi chữ, ảnh và các nhóm kinh nghiệm trực tiếp trên trang, mẫu phải được đóng gói thành tệp ZIP theo chuẩn <strong>esc-cv-v1</strong>. Mẫu chưa chuẩn hóa vẫn có thể được xem trước ở chế độ chỉ đọc.</p>',
'<h2>1. Những định dạng được hỗ trợ</h2>',
'<ul><li><strong>ZIP chuẩn ESC CV v1</strong> (tối đa 5 MB): có thể chỉnh sửa trực tuyến khi vượt qua bước kiểm tra an toàn.</li><li><strong>HTML rời (.html, .htm)</strong> (tối đa 2 MB): chỉ xem trước; ảnh và stylesheet tách rời có thể không hiển thị.</li><li><strong>ZIP HTML</strong> chưa đạt chuẩn ESC: chỉ xem trước nếu bên trong có HTML an toàn.</li><li><strong>PDF, PNG, JPG, WebP</strong>: chỉ xem trước, không thể chỉnh sửa các trường CV.</li><li><strong>DOCX</strong>: chưa hỗ trợ.</li></ul>',
'<h2>2. Cấu trúc thư mục ZIP chuẩn ESC</h2>',
'<pre><code>M01/\n  template.json\n  index.html\n  style.css\n  sample-data.json\n  preview.webp\n  assets/\n    portrait.webp</code></pre>',
'<p>ZIP có thể chứa các file trực tiếp ở gốc hoặc bên trong đúng một thư mục bao ngoài. Các file bắt buộc là <code>template.json</code>, tệp HTML, tệp CSS và ảnh preview đúng theo đường dẫn khai báo trong <code>template.json</code>. Dữ liệu demo và ảnh trong <code>assets/</code> là tùy chọn.</p>',
'<h2>3. Ví dụ template.json tối thiểu</h2>',
'<pre><code>{\n  "id": "M99",\n  "version": "1.0.0",\n  "name": "CV cá nhân của bạn",\n  "engine": "esc-cv-v1",\n  "schema": "esc-cv-v1",\n  "entry": "index.html",\n  "stylesheet": "style.css",\n  "preview": "preview.webp",\n  "sample": "sample-data.json"\n}</code></pre>',
'<p><code>id</code> phải bắt đầu bằng chữ in hoa, chỉ gồm chữ in hoa, chữ số, dấu gạch dưới hoặc gạch ngang. <code>version</code> dùng dạng 1.0.0. <code>engine</code> và <code>schema</code> phải cùng bằng <code>esc-cv-v1</code>. Ảnh xem trước chỉ dùng PNG, JPG hoặc WebP, không quá 1 MB.</p>',
'<h2>4. Chuẩn hóa các trường chỉnh sửa trong HTML</h2>',
'<p>File HTML phải chứa biến <code>&#123;&#123;profile.fullName&#125;&#125;</code> để ESC nhận diện họ tên. Bạn có thể sử dụng thêm <code>&#123;&#123;profile.jobTitle&#125;&#125;</code>, <code>&#123;&#123;profile.email&#125;&#125;</code>, <code>&#123;&#123;profile.avatarUrl&#125;&#125;</code>. Các mục nhiều dòng sử dụng khối lặp như sau:</p>',
'<pre><code>&lt;h1&gt;&#123;&#123;profile.fullName&#125;&#125;&lt;/h1&gt;\n&lt;p&gt;&#123;&#123;profile.jobTitle&#125;&#125;&lt;/p&gt;\n&lt;img src="&#123;&#123;profile.avatarUrl&#125;&#125;" alt="Ảnh đại diện"&gt;\n&lt;section&gt;\n &lt;h2&gt;Kỹ năng&lt;/h2&gt;\n &#123;&#123;#each skills&#125;&#125;\n  &lt;p&gt;&#123;&#123;name&#125;&#125;&lt;/p&gt;\n &#123;&#123;/each&#125;&#125;\n&lt;/section&gt;</code></pre>',
'<p>Để chỉnh sửa thêm/xóa/đổi thứ tự của kinh nghiệm, học vấn hoặc kỹ năng, mỗi nhóm cần dùng đúng cú pháp <code>&#123;&#123;#each tênNhóm&#125;&#125; ... &#123;&#123;/each&#125;&#125;</code> và dữ liệu demo là một mảng JSON.</p>',
'<h2>5. Quy định an toàn và dung lượng</h2>',
'<ul><li>ZIP tối đa 5 MB, tối đa 100 tệp, tổng dữ liệu giải nén tối đa 20 MB.</li><li>Không chứa JavaScript, thẻ script, iframe, mã PHP, các file thực thi, sự kiện HTML dạng onclick, hay tài nguyên CSS tải từ máy chủ ngoài.</li><li>File HTML/CSS/JSON dùng UTF-8; đường dẫn trong ZIP phải là đường dẫn tương đối, không có <code>../</code>.</li><li>Chỉ dùng tài nguyên ảnh/font web được phép, đặt trong ZIP khi cần thiết.</li></ul>',
'<h2>6. Cách kiểm tra và sử dụng</h2>',
'<ol><li>Truy cập <a href="/tao-cv-truc-tuyen/#cvstudio-templates">Trang tạo CV trực tuyến</a>.</li><li>Bấm <strong>Tải lên mẫu CV của bạn</strong>, đọc tiêu chí và chọn file.</li><li>Hệ thống kiểm tra ZIP: nếu đạt chuẩn, mở Builder để sửa trực tiếp. Nếu không đạt nhưng là tệp được hỗ trợ, mở chế độ chỉ xem.</li><li>Hãy kiểm tra nội dung, ảnh và các nhóm lặp trước khi tải CV về máy.</li></ol>',
'<p><strong>Lưu ý:</strong> file CV cá nhân hiện được lưu trong trình duyệt của bạn, không tự tải lên WordPress/hosting. Tính năng công khai CV lên hosting đang tạm hoãn.</p>'
].join('\n');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1450,height:1000}});
const assert=(v,msg)=>{if(!v)throw Error(msg);};
const answer=text=>{
  const m=text.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/);
  if(!m)return null;
  const a=Number(m[1]),b=Number(m[3]);
  return m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
};
async function login(){
  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').count()){
    await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
    await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
    const n=answer(await page.locator('body').innerText());
    if(n!==null){
      const x=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i]').first();
      assert(await x.count(),'Login challenge field unavailable');await x.fill(String(n));
    }
    await page.locator('#wp-submit').click();
    await page.waitForLoadState('domcontentloaded');
  }
  assert(!page.url().includes('wp-login.php')&&!(await page.locator('#login_error').count()),'Admin login failed');
}
async function restNonce(){
  // Core WP admin-ajax REST nonce endpoint uses the existing authenticated cookie.
  const r=await page.request.get(origin+'/wp-admin/admin-ajax.php?action=rest-nonce',{timeout:20000});
  assert(r.ok(),'Unable to read WP REST nonce: '+r.status());
  const n=(await r.text()).trim();
  assert(/^[a-zA-Z0-9]{8,32}$/.test(n),'WP REST nonce invalid');
  return n;
}
async function guide(){
  const nonce=await restNonce();
  const base=origin+'/wp-json/wp/v2/posts';
  const headers={'X-WP-Nonce':nonce,'Content-Type':'application/json'};
  const prev=await page.request.get(base+'?slug='+slug+'&status=any&context=edit',{headers,timeout:30000});
  assert(prev.ok(),'Post lookup failed '+prev.status());
  const existing=await prev.json();
  if(existing.length){
    assert(existing.length===1 && existing[0].slug===slug,'Multiple guide articles: refusing overwrite');
    assert(existing[0].status==='publish','Existing CV guide is not published');
    console.log('[CV GUIDE] Existing published WordPress post',existing[0].id);
    return existing[0].id;
  }
  const response=await page.request.post(base,{
    headers,data:{title,slug,status:'publish',content:html,excerpt:'Cấu trúc ZIP esc-cv-v1, HTML/CSS, dữ liệu CV và quy định an toàn để chỉnh sửa trực tuyến trên ESC CV Studio.'},timeout:40000
  });
  assert(response.ok(),'Guide create denied HTTP '+response.status()+' '+(await response.text()).slice(0,350));
  const post=await response.json();
  assert(post.slug===slug&&post.status==='publish'&&post.id,'Guide publish contract failed');
  const verify=await page.request.get(base+'/'+post.id,{timeout:30000});
  assert(verify.ok()&&(await verify.json()).status==='publish','Guide not persisted');
  console.log('[CV GUIDE] CREATED + VERIFIED',post.id,'slug='+slug);
  return post.id;
}
async function patchTable(){
  const id='cvstudio_02',url=origin+'/wp-admin/admin.php?page=tablepress&action=edit&table_id='+id;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>!!globalThis.tp?.table?.data&&!!globalThis.tp?.nonces?.edit_table,null,{timeout:30000});
  const changed=await page.evaluate(async ()=>{
    const id='cvstudio_02',expected=['key','value','order'];
    const table=globalThis.tp.table;
    const cells=table.data.map(row=>row.map(value=>String(value??'')));
    if(cells[0].map(x=>x.trim().toLowerCase()).join('|')!==expected.join('|'))throw Error('Unexpected ESC Table schema');
    const rows=cells.map((row,i)=>row[0]==='upload_button'?i:-1).filter(i=>i>=1);
    if(rows.length>1)throw Error('Duplicate upload_button key: refusing modification');
    const after='↑ Tải lên mẫu CV của bạn';
    if(rows.length===0){
      const order=Math.max(0,...cells.slice(1).map(row=>Number(row[2])||0))+1;
      cells.push(['upload_button',after,String(order)]);
    }else{
      const index=rows[0],before=cells[index][1];
      if(before===after)return false;
      cells[index][1]=after;
    }
    const visibility={
      ...(table.visibility||{}),
      rows:Array.isArray(table.visibility?.rows)?[...table.visibility.rows]:[],
      columns:Array.isArray(table.visibility?.columns)?[...table.visibility.columns]:[]
    };
    while(visibility.rows.length<cells.length)visibility.rows.push(true);
    while(visibility.columns.length<expected.length)visibility.columns.push(true);
    const params=new URLSearchParams({
      action:'tablepress_save_table',_ajax_nonce:globalThis.tp.nonces.edit_table,
      'tablepress[id]':String(table.id),'tablepress[new_id]':id,
      'tablepress[name]':String(table.name||''),
      'tablepress[description]':String(table.description||''),
      'tablepress[data]':JSON.stringify(cells),
      'tablepress[options]':JSON.stringify(table.options||{}),
      'tablepress[visibility]':JSON.stringify(visibility),
      'tablepress[number][rows]':String(cells.length),
      'tablepress[number][columns]':String(expected.length)
    });
    const res=await fetch(globalThis.ajaxurl,{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
      body:params.toString()
    });
    if(!res.ok)throw Error('ESC Table HTTP '+res.status);
    const json=await res.json();
    if(!json?.success||json.table_id!==id)throw Error('ESC Table rejected save: '+JSON.stringify(json));
    return true;
  });
  const updated=await page.request.get(origin+'/wp-json/tablepress/v1/table/'+id+'?refresh='+Date.now(),{timeout:20000});
  assert(updated.ok(),'Cannot verify ESC Table');
  const table=await updated.json();
  assert((table.items||[]).some(row=>row.key==='upload_button'&&row.value==='↑ Tải lên mẫu CV của bạn'),
    'ESC Table persisted incorrect upload button');
  console.log('[CV BUTTON] '+(changed?'UPDATED':'ALREADY CURRENT')+' + REST VERIFIED');
}
try{
  await login();
  await guide();
  await patchTable();
  console.log('[CV WP CONTENT] SUCCESS');
}catch(err){
  console.error(err);
  await page.screenshot({path:'cvstudio-upload-guide-wp-error.png',fullPage:true}).catch(()=>{});
  throw err;
}finally{await browser.close();}
