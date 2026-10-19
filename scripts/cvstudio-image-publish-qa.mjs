import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const cases=[
  {name:'Mẫu CV.người dùng.PNG',mime:'image/png',b64:'iVBORw0KGgoAAAANSUhEUgAAAA8AAAARCAIAAACNaGH2AAAAGUlEQVR4nGMU17ZnIBowEa90VPWo6iGnGgC/7wCjiBM1HwAAAABJRU5ErkJggg==',magic:'89504e47'},
  {name:'Hồ sơ thiết kế.jpg',mime:'image/jpeg',b64:'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAARAA8DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyaiiiuw5AooooA//Z',magic:'ffd8ff'},
  {name:'Ảnh CV đồ họa.webp',mime:'image/webp',b64:'UklGRjwAAABXRUJQVlA4IDAAAACwAgCdASoPABEAPm0qkkWkIqGYBABABsSygAA9kAAA/vfkn/natj7Pv9JxBR0AAAA=',magic:'52494646'}
];
const browser=await chromium.launch({headless:true});
try{
  for(const item of cases){
    const page=await browser.newPage({viewport:{width:1366,height:900}});
    let posted=null;
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('[data-cv-user-upload-input]').setInputFiles({
      name:item.name,mimeType:item.mime,buffer:Buffer.from(item.b64,'base64')
    });
    await page.locator('[data-cv-upload-report]').waitFor({state:'visible',timeout:20000});
    await page.locator('[data-cv-upload-report-view]').click();
    await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
    await page.locator('[data-cv-upload-readonly]').waitFor({state:'visible',timeout:30000});
    const publish=page.locator('[data-cv-publish]');
    assert(await publish.isEnabled(),item.mime+' image publish should be enabled');
    assert((await publish.textContent()).includes('Công khai ảnh qua FTPS'));
    await page.route('https://admin.esc.vn/wp-json/esc-cv/v1/publish/**',async route=>{
      const req=route.request();
      const h={
        'Access-Control-Allow-Origin':'https://esc.vn',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, Accept',
        'Content-Type':'application/json'
      };
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:h,body:''});
      if(req.url().endsWith('/session'))return route.fulfill({status:200,headers:h,body:JSON.stringify({
        token:'1700000000.'+'a'.repeat(64),expires_in:600,protocol:'FTPS'
      })});
      if(req.url().endsWith('/certificate')){
        const sent=req.postDataJSON();
        assert.deepEqual(Object.keys(sent).sort(),['host','token']);
        return route.fulfill({status:200,headers:h,body:JSON.stringify({
          host:sent.host,subject:'QA only',issuer:'QA only',expires:'2035-01-01',
          self_signed:true,fingerprint:'f'.repeat(64),
          fingerprint_sha256:'FF:'.repeat(31)+'FF',
          epoch:Math.floor(Date.now()/1000),proof:'c'.repeat(64),expires_in:300
        })});
      }
      if(req.url().endsWith('/ftps')){
        posted=req.postDataJSON();
        return route.fulfill({status:200,headers:h,body:JSON.stringify({
          ok:true,url:'https://example.com/test-cv-image/',note:'MOCK only'
        })});
      }
      return route.abort();
    });
    await publish.click();
    const dialog=page.locator('[data-cv-publish-dialog]');
    await dialog.waitFor({state:'visible'});
    const form=dialog.locator('[data-cv-publish-ftps-form]');
    await form.locator('input[name=domain]').fill('example.com');
    await form.locator('input[name=username]').fill('qa-user');
    await form.locator('input[name=password]').fill('dummy-never-sent');
    await form.locator('input[name=root]').fill('public_html');
    await form.locator('input[name=slug]').fill('test-cv-image');
    const cert=dialog.locator('[data-cv-publish-cert-inspect]');
    assert(await cert.isEnabled());
    await cert.click();
    await dialog.locator('[data-cv-publish-cert-panel]').waitFor({state:'visible'});
    await dialog.locator('[data-cv-publish-cert-confirm]').check();
    const send=dialog.locator('[data-cv-publish-ftps-submit]');
    assert(await send.isEnabled());
    await send.click();
    await dialog.locator('[data-cv-publish-finish]').waitFor({state:'visible',timeout:20000});
    assert.equal(posted?.format,'image');
    assert.equal(posted?.image_mime,item.mime);
    assert.equal(posted?.slug,'test-cv-image');
    assert.equal(posted?.html,undefined);
    assert.equal(posted?.pdf_base64,undefined);
    assert.equal(Buffer.from(posted.image_base64,'base64').subarray(0,4).toString('hex').slice(0,item.magic.length),item.magic);
    assert.equal(Buffer.from(posted.image_base64,'base64').toString('base64'),item.b64);
    assert.deepEqual(errors,[]);
    console.log('PASS browser readonly CV image publication',item.mime,': MOCK FTPS intercepted; no customer secrets');
    await page.close();
  }
}finally{await browser.close();}
