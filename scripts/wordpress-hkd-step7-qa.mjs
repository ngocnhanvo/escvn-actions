import { chromium } from 'playwright';

const base='https://admin.esc.vn/wp-json/esc-hkd/v1/';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const request=ctx.request;

async function getMeta() {
  const response=await request.get(base+'meta',{timeout:45000});
  const data=await response.json();
  if(response.status()!==200||data?.demo!==false||data.provinces?.length!==34||data.industries?.length!==15)
    throw Error('HKD public metadata regression');
  return data.stats.businesses;
}
async function post(payload,origin) {
  const headers={ 'Content-Type':'application/json' };
  if(origin)headers.Origin=origin;
  const response=await request.post(base+'registrations',{
    data:payload,headers,timeout:45000,
  });
  const data=await response.json().catch(()=>({}));
  return {status:response.status(),error:data?.error||data?.code};
}

try {
  const initial=await getMeta();
  const startedAt=Date.now()-5000;
  const empty={company_site:'',startedAt};
  const badOrigin=await post(empty,'https://example.invalid');
  if(badOrigin.status!==403)throw Error('Untrusted origin not rejected '+badOrigin.status);
  const missing=await post(empty,'https://esc.vn');
  if(missing.status!==400)throw Error('Missing required registration data not rejected: '+missing.status);
  const spam=await post({company_site:'nonempty',startedAt},'https://esc.vn');
  if(spam.status!==400)throw Error('Honeypot not rejected');
  const tooFast=await post({company_site:'',startedAt:Date.now()},'https://esc.vn');
  if(tooFast.status!==400)throw Error('Fast spam attempt not rejected');

  const unknownCodes=await post({
    company_site:'',startedAt, name:'INVALID QA - MUST NOT SAVE',contact:'QA',
    phone:'0123456789',addr:'INVALID',provCode:'00',wardCode:'00000',
    ind:'no-such-industry',updateId:'',
  },'https://esc.vn');
  if(unknownCodes.status!==400)throw Error('Invalid reference data not rejected');

  const preflight=await request.fetch(base+'registrations',{
    method:'OPTIONS',
    headers:{
      Origin:'https://esc.vn',
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'content-type',
    },
    timeout:45000,
  });
  if(preflight.status()!==200)throw Error('CORS preflight failed '+preflight.status());
  const cors=(preflight.headers()['access-control-allow-origin']||'');
  if(cors!=='https://esc.vn')throw Error('Registration CORS missing esc.vn origin: '+cors);
  const after=await getMeta();
  if(after!==initial)throw Error('HKD public business count changed after invalid submissions');
  const forbidden=await request.get(base+'registrations',{timeout:45000});
  if(forbidden.status()===200)throw Error('Registration list exposed anonymously');
  console.log('HKD Step7 API QA PASS: untrusted origin, empty payload, honeypot, speed check, invalid codes, CORS; no valid submissions or fake records written');
}finally{await ctx.close();await browser.close()}
