import { chromium } from 'playwright';
const url=process.env.WP_ADMIN_URL;
const user=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if(!url||!user||!password)throw Error('Missing WordPress QA credentials');
const origin=new URL(url).origin;
if(new URL(origin).hostname!=='admin.esc.vn')throw Error('Unexpected Builder target');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const visible=async s=>{try{return await page.locator(s).first().isVisible({timeout:1500})}catch{return false}};
const arithmetic=text=>{
  const m=text.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i) || text.match(/(\d+)\s*([+\-x×*])\s*(\d+)/i);
  if(!m)return null;
  const a=Number(m[1]),b=Number(m[3]);
  return m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
};
try{
  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await visible('#user_login')){
    await page.locator('#user_login').fill(user);
    await page.locator('#user_pass').fill(password);
    const answer=arithmetic(await page.locator('body').innerText());
    if(answer!==null){
      const sel='#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i],#loginform input[type="number"]';
      let input=page.locator(sel).first();
      if(!await visible(sel)){
        input=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type=hidden]):not([type=checkbox]):not([type=submit])').first();
      }
      await input.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
    if(page.url().includes('wp-login.php'))throw Error('Builder QA login failed');
  }
  await page.goto(origin+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page=55454',
    {waitUntil:'domcontentloaded',timeout:60000});
  const frame=page.locator('#esc-vb-frame');
  await frame.waitFor({state:'visible',timeout:20000});
  const src=await frame.getAttribute('src');
  if(!src||!src.includes('/esc-builder/preview/55454?'))throw Error('Builder preview frame URL missing or wrong Page ID');
  const preview=page.frameLocator('#esc-vb-frame');
  const heading=preview.locator('[data-tablepress-preview="cvstudio_00"] h1[data-esc-builder-field="value"]').first();
  await heading.waitFor({state:'visible',timeout:60000});
  const copy=(await heading.textContent()||'').trim();
  if(!copy.includes('Không chỉ là CV'))throw Error('Builder did not render WordPress-owned CV Studio title');
  for(const id of ['cvstudio_00','cvstudio_01','cvstudio_02']){
    const n=await preview.locator('[data-tablepress-preview="'+id+'"]').count();
    if(!n)throw Error('Missing CV section in Builder preview: '+id);
  }
  await heading.click();
  // Selecting a source-owned cell must open the Builder inspector editor.
  await page.locator('#esc-vb-text-editor').waitFor({state:'visible',timeout:15000});
  const row=page.locator('#esc-vb-edit-row');
  await row.waitFor({state:'attached',timeout:15000});
  const field=page.locator('#esc-vb-edit-title');
  await field.waitFor({state:'visible',timeout:15000});
  // The panel becomes visible BEFORE its POST editable-text request finishes.
  // Wait for a populated, enabled editor instead of checking the initial disabled state.
  try {
    await page.waitForFunction(() => {
      const el=document.querySelector('#esc-vb-edit-title');
      return el && !el.disabled && el.value.includes('Không chỉ là CV');
    },null,{timeout:25000,polling:300});
  } catch (error) {
    const diagnostic=await page.evaluate(()=>({
      caption:document.querySelector('#esc-vb-edit-caption')?.textContent||'',
      feedback:document.querySelector('#esc-vb-edit-feedback')?.textContent||'',
      value:document.querySelector('#esc-vb-edit-title')?.value||'',
      row:document.querySelector('#esc-vb-edit-row')?.value||'',
      disabled:document.querySelector('#esc-vb-edit-title')?.disabled,
    }));
    throw Error('Builder editable-text did not become ready: '+JSON.stringify(diagnostic),{cause:error});
  }
  const current=(await field.inputValue()).trim();
  if(!current.includes('Không chỉ là CV'))throw Error('Builder textarea does not contain the clicked WP-owned headline');
  // QA must not save or change source content.
  console.log('ESC CV Studio Visual Builder: Hero cell editable, 3 sections rendered, WordPress source: PASS');
  // No save button is clicked: testing does not alter WordPress.
}catch(e){
  console.error('CV Studio Builder QA failed:',e?.stack||e);
  await page.screenshot({path:'cvstudio-builder-parent.png',fullPage:true}).catch(()=>{});
  try{await page.frameLocator('#esc-vb-frame').locator('body').screenshot({path:'cvstudio-builder-frame.png'})}catch{}
  throw e;
}finally{await browser.close();}
