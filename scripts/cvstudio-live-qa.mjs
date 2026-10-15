import { chromium } from 'playwright';
const url='https://esc.vn/tao-cv-truc-tuyen/';
const api='https://admin.esc.vn/wp-json/esc-cv/v1/templates';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:860}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const seen=async(q)=>await page.locator(q).first().isVisible();
try {
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert(response?.status()===200,'CV Studio returns HTTP '+response?.status());
  await page.locator('#main-header').waitFor({state:'visible',timeout:15000});
  await page.locator('[data-tablepress-preview="cvstudio_00"] h1').waitFor({state:'visible',timeout:15000});
  for(const id of ['cvstudio_00','cvstudio_01','cvstudio_02'])
    assert(await page.locator('[data-tablepress-preview="'+id+'"]').count()>=1,'Section missing: '+id);
  const gallery=page.locator('[data-cv-gallery]');
  await gallery.waitFor({state:'attached'});
  const apiRes=await page.request.get(api,{timeout:30000});
  assert(apiRes.ok(),'CV Manager public REST returned '+apiRes.status());
  const data=await apiRes.json();
  assert(Array.isArray(data.templates),'CV Manager REST payload shape invalid');
  console.log('Active CV templates:',data.templates.map(t=>t.id+'@'+t.version).join(', ') || '(none)');
  if(!data.templates.length)throw Error('No active templates in ESC CV Manager; activate at least one before end-to-end QA');
  await gallery.locator('article').first().waitFor({state:'visible',timeout:30000});
  // The browser gallery, not only the privileged runner's server-side REST,
  // must be capable of accessing the cross-origin API and loading imagery.
  const first=gallery.locator('article').first();
  assert((await first.locator('img').getAttribute('src'))?.startsWith('https://admin.esc.vn/'),'Gallery image is not the public WordPress image');
  // Full-template preview works without starting the wizard.
  await first.locator('button').first().click();
  const popup=page.locator('[data-cv-sample-preview]');
  await popup.waitFor({state:'visible',timeout:10000});
  await popup.locator('[data-cv-sample-image]').waitFor({state:'visible'});
  assert((await popup.locator('img').getAttribute('src'))?.startsWith('https://admin.esc.vn/'),
    'Template preview must use public WordPress image');
  await popup.locator('[data-cv-sample-close]').click();
  assert(!(await popup.isVisible()),'Template preview modal did not close');
  const demoUser=page.locator('[data-cv-dialog]');
  await page.locator('[data-cv-start]').first().click();
  await demoUser.waitFor({state:'visible'});
  const login=demoUser.locator('[data-cv-login-form]');
  await login.locator('input[name=email]').fill('demo@esc.vn');
  const password=login.locator('input[name=password]');
  const toggle=login.locator('[data-cv-password-toggle]');
  assert(await password.getAttribute('type')==='password','Password must initially be concealed');
  await toggle.click();
  assert(await password.getAttribute('type')==='text','Password eye must show plaintext');
  assert(await toggle.getAttribute('aria-pressed')==='true','Password toggle pressed state missing');
  await toggle.click();
  assert(await password.getAttribute('type')==='password','Password eye must conceal again');
  await password.fill('wrong-password');
  await login.locator('button[type=submit]').click();
  assert(await seen('[data-cv-login-error]'),'Invalid demo login must show an error');
  assert(!(await seen('[data-cv-step="domain"]')),'Invalid login bypassed the domain step gate');
  await login.locator('input[name=password]').fill('Demo@123');
  await login.locator('button[type=submit]').click();
  const domainStep=demoUser.locator('[data-cv-step="domain"]');
  await domainStep.waitFor({state:'visible',timeout:8000});
  assert(await domainStep.locator('h3').count()===0,'Domain step repeated title');
  assert(await domainStep.locator('svg').count()===1,'Domain step icon must remain visible');
  assert((await demoUser.locator('#cvstudio-dialog-title').textContent())?.trim()==='Chọn tên miền cho CV',
    'Domain title belongs to dialog header only');
  const radios=domainStep.locator('input[name=cv-domain]');
  assert(await radios.count()>=1,'Missing WordPress-configured demo domain');
  const selected=await radios.first().inputValue();
  await radios.first().check();
  await domainStep.locator('[data-cv-domain-next]').click();
  const templateStep=demoUser.locator('[data-cv-step="templates"]');
  await templateStep.waitFor({state:'visible',timeout:15000});
  assert(await templateStep.locator('h3').count()===0,'Template step repeated title');
  assert(await templateStep.locator('svg').count()===0,'Template step icon must be removed');
  await templateStep.locator('[data-cv-dialog-templates] article').first().waitFor({state:'visible',timeout:15000});
  // The old fixed 3-field CV form has been removed.
  assert(await page.locator('[data-cv-step="editor"]').count()===0,'Obsolete 3-field editor still exists');
  const chosenTemplate=data.templates.find(t=>t.id==='M26')||data.templates[0];
  const target=templateStep.locator('article').filter({hasText:chosenTemplate.id}).first();
  // Preview does not advance the wizard.
  await target.locator('button').first().click();
  await popup.waitFor({state:'visible',timeout:10000});
  await popup.locator('[data-cv-sample-close]').click();
  await target.locator('button').last().click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  const workspace=page.locator('[data-cv-builder-workspace]');
  await workspace.waitFor({state:'visible',timeout:30000});
  assert((await page.locator('[data-cv-domain]').textContent())===selected,
    'Selected domain must be carried to the Builder');
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes(chosenTemplate.id),
    'Builder must load the clicked active template');
  const frame=page.locator('[data-cv-live-frame]');
  await frame.waitFor({state:'visible'});
  const srcdoc=await frame.getAttribute('srcdoc');
  assert(srcdoc?.includes('Content-Security-Policy'),'Preview must be sandboxed');
  const advanced=page.locator('[data-cv-advanced]');
  assert(!(await advanced.getAttribute('open')),'Long editor form must initially be collapsed');
  const cvFrame=page.frameLocator('[data-cv-live-frame]');
  const nameTarget=cvFrame.locator('[data-cv-inline="profile.fullName"]').first();
  await nameTarget.waitFor({state:'visible',timeout:15000});
  await nameTarget.click();
  const focusedLabel=page.locator('[data-cv-focused] label');
  assert((await focusedLabel.textContent())?.includes('Họ và tên'),'Click CV name must select contextual field');
  await focusedLabel.locator('input').fill('NGUYỄN VĂN QA');
  await page.waitForFunction(()=>{
    const f=document.querySelector('[data-cv-live-frame]');
    return f?.getAttribute('srcdoc')?.includes('NGUYỄN VĂN QA');
  },null,{timeout:15000});
  assert(await page.locator('[data-cv-builder-fields] details').count()>0,
    'Template-defined array fields must be editable');
  await cvFrame.locator('[data-cv-inline="profile.avatarUrl"]').first().click();
  assert((await page.locator('[data-cv-focused] label').textContent())?.includes('Ảnh chân dung'),
    'Click portrait must open its contextual file picker');
  assert(await page.locator('[data-cv-focused] input[type=file]').count()===1,
    'Portrait field must accept an image upload');
  const other=cvFrame.locator('[data-cv-inline^="experiences."]').first();
  assert(await other.count()>0,'Experience entries must be addressable on the CV');
  await other.click();
  assert(await page.locator('[data-cv-focused] input,[data-cv-focused] textarea').count()>0,
    'Click experience must focus a template-defined editor');
  await advanced.locator('summary').first().click();
  assert(await advanced.getAttribute('open')!==null,'Adding and removing groups must remain available');
  await page.locator('[data-cv-draft-save]').click();
  assert((await page.locator('[data-cv-status]').textContent())?.includes('trình duyệt'),
    'Save must clearly state browser-local draft status');
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const restored=page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first();
  await restored.waitFor({state:'visible',timeout:15000});
  await restored.click();
  assert((await page.locator('[data-cv-focused] input').inputValue())==='NGUYỄN VĂN QA',
    'Draft should survive a reload in the same test browser');
  assert(errors.length===0,'Frontend JavaScript exception: '+errors.join(' | '));
  console.log('ESC CV Studio: password eye, clean wizard, visual CV click-to-edit, photo/experience inspector and local draft: PASS');

}catch(e){
  console.error('ESC CV Studio public-flow QA failed:',e?.stack||e, 'Browser errors:',errors);
  await page.screenshot({path:'cvstudio-public-qa-failure.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{await browser.close();}
