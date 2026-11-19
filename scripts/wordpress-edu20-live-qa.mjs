import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true});
const title='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11';
const detailTitle='Tri ân Ngày Nhà giáo Việt Nam 20/11 – ESC tặng 20 tên miền .EDU.VN';
try {
  for (const size of [{width:1440,height:900},{width:390,height:844}]) {
    const page=await browser.newPage({viewport:size});
    try {
      const response=await page.goto('https://esc.vn/khuyen-mai',{waitUntil:'domcontentloaded',timeout:60000});
      assert.equal(response?.status(),200,'Promotion page HTTP');
      const heading=page.getByRole('heading',{name:title,exact:true});
      await heading.waitFor({state:'visible',timeout:20000});
      assert.equal(await heading.count(),1,'Exactly one EDU20 promotion card is expected');
      const card=heading.locator('xpath=ancestor::*[.//a[contains(normalize-space(.), "Đăng ký ngay")]]').first();
      assert.ok(await card.count(),'EDU20 card not found');
      const cta=card.getByRole('link',{name:'Đăng ký ngay'}).first();
      assert.equal(new URL(await cta.getAttribute('href'),'https://esc.vn').pathname,'/dang-ky-ten-mien','CTA target mismatch');
      for (const text of ['Tặng 20 tên miền .EDU.VN','Mã KM: EDU20','Liên hệ: 1900 2069','Free Support 24/24']) {
        assert.ok((await card.innerText()).includes(text),'Card missing: '+text);
      }
      const view=card.getByText('Xem chi tiết',{exact:true}).first();
      assert.ok(await view.isVisible(),'Xem chi tiết missing');
      await view.click();
      const detail=card.getByRole('heading',{name:detailTitle,exact:true}).first();
      await detail.waitFor({state:'visible',timeout:5000});
      const detailText=await card.innerText();
      for(const text of ['Nhân Ngày Nhà giáo Việt Nam','Thông tin chương trình','Các tổ chức hoạt động trong lĩnh vực giáo dục','20/11/2026','EDU20'])assert.ok(detailText.includes(text),'Details missing: '+text);
      const banner=card.locator('img[alt*="Tri ân Ngày Nhà giáo Việt Nam"]').first();
      assert.ok(await banner.count(),'Campaign banner missing');
      await banner.scrollIntoViewIfNeeded();
      await banner.evaluate(img=>new Promise((resolve,reject)=>{
        if(img.complete)return img.naturalWidth>0?resolve():reject(Error('Banner has no pixels'));
        img.addEventListener('load',()=>resolve(),{once:true});
        img.addEventListener('error',()=>reject(Error('Banner could not load')),{once:true});
      }));
      console.log('EDU20_LIVE_QA_PASS',JSON.stringify({viewport:size,cta:await cta.getAttribute('href'),banner:await banner.getAttribute('src')}));
    } catch(error) {
      console.error('EDU20_QA_FAIL',JSON.stringify({viewport:size,reason:String(error),titleCount:await page.getByRole('heading',{name:title,exact:true}).count(),pageText:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1100)}));
      await page.screenshot({path:'edu20-failure-'+size.width+'.png',fullPage:true}).catch(()=>{});
      throw error;
    } finally {await page.close();}
  }
} finally {await browser.close();}
