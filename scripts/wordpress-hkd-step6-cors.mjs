import { chromium } from 'playwright';

const base='https://admin.esc.vn/wp-json/esc-hkd/v1/';
const browser=await chromium.launch({headless:true});
try {
 const ctx=await browser.newContext();
 const page=await ctx.newPage();
 await page.goto('https://esc.vn/',{waitUntil:'domcontentloaded',timeout:60000});
 const results=await page.evaluate(async base=>{
   const paths=['meta','provinces','industries','businesses?limit=2','map/points','map/extent'];
   const out={};
   for(const path of paths){
     try{
       const response=await fetch(base+path,{mode:'cors',headers:{Accept:'application/json'}});
       const data=await response.json();
       out[path]={status:response.status, data};
     }catch(e){out[path]={error:String(e)}}
   }
   return out;
 },base);
 for(const [route,result] of Object.entries(results)){
   if(result.error||result.status!==200)throw new Error('HKD CORS route '+route+': '+(result.error||result.status));
 }
 if(results.meta.data.provinces?.length!==34 || results.meta.data.industries?.length!==15)
   throw new Error('HKD meta reference mismatch');
 if(results['businesses?limit=2'].data.total!==0)throw new Error('Unexpected production business records');
 console.log('HKD Step6 CORS PASS: esc.vn browser -> admin.esc.vn six REST endpoints; 34 provinces, 15 industries, zero businesses');
 await ctx.close();
}finally{await browser.close()}
