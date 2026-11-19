/**
 * ESC Member ID ACF import: match CSV product_name to WordPress ACF tld exactly.
 * Fail closed on ambiguous parents, existing conflicting IDs or changed catalog.
 * Only updates ACF `member_product_id` on already-published WooCommerce product posts.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HOST='https://admin.esc.vn';
const OUTPUT='member-product-id-apply';
const input=JSON.parse(readFileSync('scripts/data/member-products.json','utf8'));
const normalize=x=>String(x??'').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const WP_URL=process.env.WP_ADMIN_URL;
const USER=process.env.WP_ADMIN_USERNAME;
const PASS=process.env.WP_ADMIN_PASSWORD;
assert.ok(WP_URL&&USER&&PASS,'WordPress admin credentials required');
assert.equal(new URL(WP_URL.includes('://')?WP_URL:'https://'+WP_URL).origin,HOST,'Wrong WordPress environment');

async function fetchProducts(){
  let page=1,pages=1;
  const result=[];
  do{
    const url=`${HOST}/wp-json/wp/v2/product?status=publish&per_page=50&page=${page}&_fields=id,title,acf,prices`;
    const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
    assert.equal(response.status,200,`WordPress products page ${page} HTTP ${response.status}`);
    const data=await response.json();
    assert.ok(Array.isArray(data));
    result.push(...data);
    pages=Number(response.headers.get('x-wp-totalpages')||1);
    assert.ok(pages<=200,'Suspicious catalog size');
    page++;
  }while(page<=pages);
  return result;
}

const products=await fetchProducts();
const byKey=new Map();
for(const product of products){
  const key=normalize(product.acf?.tld);
  if(!key)continue;
  if(!byKey.has(key))byKey.set(key,[]);
  byKey.get(key).push(product);
}
const nameCounts=new Map();
for(const row of input){
  const key=normalize(row.product_name);
  nameCounts.set(key,(nameCounts.get(key)||0)+1);
}
const groups=[];
for(const row of input){
  const key=normalize(row.product_name);
  const matches=byKey.get(key)||[];
  const origins=new Set(matches.map(p=>String(p.acf?.origin_product_id||p.id)));
  if(!matches.length||origins.size!==1||nameCounts.get(key)!==1)continue;
  assert.match(String(row.product_id),/^\d+$/);
  groups.push({name:row.product_name,member_id:String(row.product_id),products:matches});
}
assert.equal(groups.length,65,'Matched Member identifiers differ from audited count. Stop without writing.');
const plan=groups.flatMap(g=>g.products.map(p=>({id:p.id,code:g.name,member_id:g.member_id,product_title:p.title?.rendered||'',origin:p.acf?.origin_product_id||p.id})));
assert.equal(plan.length,67,'Matched WordPress record count changed. Stop without writing.');
assert.ok(plan.some(p=>p.id===55601&&p.member_id==='225600'&&normalize(p.code)==='.ap.vn'),'Canary mismatch');
assert.equal(new Set(plan.map(p=>p.id)).size,plan.length,'Duplicate WordPress target!');
mkdirSync(OUTPUT,{recursive:true});
writeFileSync(`${OUTPUT}/plan.json`,JSON.stringify({total_csv:input.length,total_wp:products.length,exact_groups:groups.length,targets:plan},null,2));

const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const results=[];
const save=()=>writeFileSync(`${OUTPUT}/result.json`,JSON.stringify({updated:results.filter(x=>x.status==='UPDATED').length,unchanged:results.filter(x=>x.status==='UNCHANGED').length,conflicts:results.filter(x=>x.status==='CONFLICT').length,errors:results.filter(x=>x.status==='ERROR').length,results},null,2));

async function login(){
  await page.goto(HOST+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').isVisible().catch(()=>false)){
    await page.locator('#user_login').fill(USER);
    await page.locator('#user_pass').fill(PASS);
    const t=await page.locator('body').innerText();
    const m=t.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if(m){
      const answer=m[2]==='+'?Number(m[1])+Number(m[3]):m[2]==='-'?Number(m[1])-Number(m[3]):Number(m[1])*Number(m[3]);
      const captcha=page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[type="number"]').first();
      assert.ok(await captcha.count(),'Unsupported login CAPTCHA');
      await captcha.fill(String(answer));
    }
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
      page.locator('#wp-submit').click()
    ]);
  }
  assert.ok(!page.url().includes('wp-login.php'),'WordPress login failed');
}

async function openACF(target){
  const url=`${HOST}/wp-admin/post.php?post=${target.id}&action=edit`;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert.ok(!page.url().includes('wp-login.php'),`Authentication lost for ${target.id}`);
  const tld=page.locator('.acf-field[data-name="tld"] input:not([type="hidden"])').first();
  const member=page.locator('.acf-field[data-name="member_product_id"] input:not([type="hidden"])').first();
  await tld.waitFor({state:'attached',timeout:30000});
  await member.waitFor({state:'attached',timeout:30000});
  const actualTld=normalize(await tld.inputValue());
  assert.equal(actualTld,normalize(target.code),`WP product ${target.id}: ACF tld mismatch`);
  return {member,url};
}

async function writeOne(target){
  const {member,url}=await openACF(target);
  const existing=String(await member.inputValue()).trim();
  if(existing===target.member_id){
    results.push({id:target.id,code:target.code,member_id:target.member_id,status:'UNCHANGED',previous:existing});
    console.log(`UNCHANGED id=${target.id} tld=${target.code}`);
    return;
  }
  if(existing!==''){
    results.push({id:target.id,code:target.code,member_id:target.member_id,status:'CONFLICT',previous:existing});
    console.error(`CONFLICT id=${target.id} tld=${target.code} old_value=${existing}; not overwritten`);
    return;
  }
  await member.fill(target.member_id);
  const publish=page.locator('#publish');
  assert.ok(await publish.isVisible(),`Classic publish/update button not available for ${target.id}`);
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
    publish.click()
  ]);
  const {member:check}=await openACF(target); // independent database-backed UI read after save
  const after=String(await check.inputValue()).trim();
  assert.equal(after,target.member_id,`Post-save verification failed id=${target.id}`);
  results.push({id:target.id,code:target.code,member_id:target.member_id,status:'UPDATED',previous:existing});
  console.log(`UPDATED id=${target.id} tld=${target.code} member=${target.member_id}`);
}

try{
  await login();
  // Verify one user-provided, independently confirmed item before the remaining exact matches.
  const canary=plan.find(p=>p.id===55601);
  await writeOne(canary);
  save();
  for(const target of plan.filter(p=>p.id!==55601)){
    try{await writeOne(target);}catch(error){
      results.push({id:target.id,code:target.code,member_id:target.member_id,status:'ERROR',message:String(error?.message||error)});
      console.error(`ERROR id=${target.id} ${String(error?.message||error)}`);
    }
    save();
  }
  console.log(`DONE exact_mapping_groups=${groups.length} wp_records=${plan.length} updated=${results.filter(x=>x.status==='UPDATED').length} unchanged=${results.filter(x=>x.status==='UNCHANGED').length} conflicts=${results.filter(x=>x.status==='CONFLICT').length} errors=${results.filter(x=>x.status==='ERROR').length} temporary_created=0 cleanup_remaining=0`);
  assert.equal(results.filter(x=>x.status==='ERROR'||x.status==='CONFLICT').length,0,'One or more records could not be updated');
}finally{
  save();
  await context.close();
  await browser.close();
}
