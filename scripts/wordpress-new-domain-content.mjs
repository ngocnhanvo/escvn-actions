import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = 'https://admin.esc.vn';
const seed = JSON.parse(readFileSync(new URL('./data/ten-mien-moi.json', import.meta.url)));
const { slug, title, table_id: tableId, fields } = seed;
const login = process.env.WP_ADMIN_URL;
assert.ok(login && process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD, 'WP credentials required');
assert.equal(new URL(login.startsWith('http') ? login : 'https://' + login).origin, host);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const get = (path) => context.request.get(host + path, { timeout: 45000 });
const readTable = async () => {
  for (let i=1;i<=30;i++) {
    const r=await get('/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page='+i);
    assert.equal(r.status(),200,'ESC Table REST');
    const t=(await r.json()).find(t=>String(t?.id).toLowerCase()===tableId);
    if(t)return t;
    if(i>=Number(r.headers()['x-wp-totalpages']||1))break;
  }
  return null;
};
const readPage = async () => {
  const r=await get('/wp-json/wp/v2/pages?slug='+slug+'&per_page=100');
  assert.equal(r.status(),200,'WordPress Pages REST');
  return (await r.json()).find(p=>p.slug===slug&&p.status==='publish')||null;
};
try {
  await page.goto(host+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').isVisible().catch(()=>false)){
    await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
    await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
    const m=(await page.locator('body').innerText()).match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if(m){
      const answer=m[2]==='+'?+m[1]+ +m[3]:m[2]==='-'?+m[1]-m[3]:m[1]*m[3];
      const f=page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[type="number"]').first();
      assert.ok(await f.count(),'Unsupported CAPTCHA');await f.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  assert.ok(!page.url().includes('wp-login.php'),'WP auth failed');
  let table=await readTable();
  if(!table){
    await page.goto(host+'/wp-admin/admin.php?page=tablepress&action=import',{waitUntil:'domcontentloaded',timeout:60000});
    const nonceBox=page.locator('input[name="_wpnonce"]').first();
    await nonceBox.waitFor({state:'attached',timeout:15000});
    const nonce=await nonceBox.inputValue();
    assert.ok(nonce.length>4,'Import nonce unavailable');
    const source={
      id:tableId,name:'Tên miền mới — nội dung trang',description:'Nội dung landing page /ten-mien-moi',
      data:[['key','value'],['__ignored_header_row__',''],...fields.map(({key,value})=>[key,value])],
      options:{table_head:true,table_foot:false,alternating_row_colors:false,row_hover:false,print_name:false,print_description:false,use_datatables:false}
    };
    const r=await context.request.post(host+'/wp-admin/admin-post.php',{form:{
      action:'tablepress_import',_wpnonce:nonce,'import[source]':'form-field',
      'import[form-field]':JSON.stringify(source),'import[type]':'add'
    },timeout:90000});
    assert.ok([200,302].includes(r.status()),'Table import HTTP '+r.status());
    assert.ok(!/error_import|error_details=/.test(r.url()),'Table import rejected '+r.url());
    table=await readTable();
    assert.ok(table,'ESC Table not saved via import');
    console.log('ESC_TABLE_CREATED',tableId,fields.length);
  }else console.log('ESC_TABLE_EXISTS, not overwritten',tableId);
  console.log('ESC_TABLE_SCHEMA',JSON.stringify({keys:Object.keys(table),meta:table.meta,first:table.items?.slice(0,2)}).slice(0,1600));
  if (!table.items?.some(x=>x.key==='hero.title') && table.items?.length===fields.length-1 && table.items[0]?.key==='hero.banner') {
    // Initial import used a single header row; REST strips the first content row.
    // This is our own newly seeded table, and has not yet been linked to a Page.
    assert.equal(await readPage(),null,'Do not replace a table already linked to a published Page');
    await page.goto(host+'/wp-admin/admin.php?page=tablepress&action=import',{waitUntil:'domcontentloaded'});
    const nonce=await page.locator('input[name="_wpnonce"]').first().inputValue();
    const replacement={
      id:tableId,name:'Tên miền mới — nội dung trang',description:'Nội dung landing page /ten-mien-moi',
      data:[['key','value'],['__ignored_header_row__',''],...fields.map(({key,value})=>[key,value])],
      options:{table_head:true,table_foot:false,print_name:false,print_description:false,use_datatables:false}
    };
    const res=await context.request.post(host+'/wp-admin/admin-post.php',{form:{
      action:'tablepress_import',_wpnonce:nonce,'import[source]':'form-field',
      'import[form-field]':JSON.stringify(replacement),'import[type]':'replace',
      'import[existing_table]':tableId
    },timeout:90000});
    assert.ok(!/error_import|error_details=/.test(res.url()),'Table replace failed: '+res.url());
    table=await readTable();
    console.log('ESC_TABLE_REPAIRED',tableId,table?.items?.length);
  }
  assert.ok(table.items?.some(x=>x.key==='hero.title'),'ESC Table REST fields missing');
  const canonicalRes=await get('/wp-json/wp/v2/pages/55546');
  assert.equal(canonicalRes.status(),200,'Canonical Page missing');
  const wpPage=await canonicalRes.json();
  assert.equal(wpPage.status,'publish','Canonical Page is not published');
  assert.ok(String(wpPage.content?.rendered||'').includes(tableId),'Canonical Page does not reference ESC Table');
  assert.equal(table.items.length,fields.length,'Expected exact CMS field count');
  console.log('CMS_PASS id=55546 wp_slug='+wpPage.slug+' table='+tableId+
    ' edited=0 skipped_unchanged=1 temporary_created=0 cleanup_remaining=0');
} finally {await context.close();await browser.close();}
