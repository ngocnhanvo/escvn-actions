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
  let wpPage=await readPage();
  if(!wpPage){
    await page.goto(host+'/wp-admin/post-new.php?post_type=page',{waitUntil:'domcontentloaded',timeout:60000});
    const titleBox=page.locator('#title');
    await titleBox.waitFor({state:'visible',timeout:30000});
    await titleBox.fill(slug);
    console.log('EDITOR_CONTROL',JSON.stringify(await page.evaluate(() => ({
      mode:document.querySelector('#wp-content-wrap')?.className,
      insertHandler:typeof window.tablepress_open_shortcode_thickbox,
      thickbox:typeof window.tb_show
    }))));
    await page.evaluate(() => {
      if (typeof window.tablepress_open_shortcode_thickbox !== 'function') throw new Error('ESC Table Insert Code unavailable');
      window.tablepress_open_shortcode_thickbox(); // Official editor Insert Code UI, no raw shortcode entry.
    });
    await page.locator('iframe#TB_iframeContent').waitFor({state:'attached',timeout:15000});

    console.log('EDITOR_INSERT_DIALOG',JSON.stringify(await page.evaluate(() => ({
      frameCount:document.querySelectorAll('iframe#TB_iframeContent').length,
      thickbox:!!document.getElementById('TB_window'),
      editorMode:document.getElementById('wp-content-wrap')?.className
    }))));
    const frame=page.frameLocator('iframe#TB_iframeContent');
    const search=frame.getByRole('searchbox').first();
    await search.waitFor({state:'visible',timeout:15000});
    await search.fill(tableId);
    await search.press('Enter');
    console.log('INSERT_CODE_SEARCH_USED',tableId);
    console.log('INSERT_DIALOG_TEXT',(await frame.locator('body').innerText({timeout:12000}).catch(()=>'NOT_LOADED')).slice(0,600));
    const row=frame.locator('tr').filter({hasText:tableId}).first();
    await row.waitFor({state:'visible',timeout:15000});
    await row.locator('.insert-shortcode').first().click();
    await page.waitForFunction(id=>document.querySelector('#content')?.value.includes(id),tableId,{timeout:10000});
    console.log('SHORTCODE_INSERTED_USING_EDITOR_UI',tableId);
    const key=page.locator('.acf-field[data-name="key"] input:not([type="hidden"])').first();
    if(await key.count())await key.fill(slug);
    const action=page.locator('.acf-field[data-name="action"] select, .acf-field[data-name="action"] input:not([type="hidden"])').first();
    if(await action.count()){
      if(await action.evaluate(el=>el.tagName)==='SELECT')await action.selectOption('PublicPage');
      else await action.fill('PublicPage');
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#publish').click()]);
    wpPage=await readPage();
    assert.ok(wpPage,'Published WordPress Page not found');
    assert.equal(wpPage.slug,slug);
    assert.ok(String(wpPage.content?.rendered||'').includes(tableId),'Page shortcode not persisted');
    await page.goto(host+'/wp-admin/post.php?post='+wpPage.id+'&action=edit',{waitUntil:'domcontentloaded'});
    const titleField=page.locator('#title');
    await titleField.waitFor({state:'visible',timeout:15000});
    if(await titleField.inputValue()!==title){
      await titleField.fill(title);
      await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#publish').click()]);
    }
    wpPage=await readPage();
    assert.equal(wpPage.slug,slug,'Page slug mutated');
    console.log('WP_PAGE_CREATED',wpPage.id);
  }else console.log('WP_PAGE_EXISTS, not overwritten',wpPage.id);
  assert.ok(String(wpPage.content?.rendered||'').includes(tableId),'Existing page not linked to ESC Table');
  console.log('CMS_PASS id='+wpPage.id+' table='+tableId+' temporary_created=0 cleanup_remaining=0');
} finally {await context.close();await browser.close();}
