import assert from 'node:assert/strict';

const token = process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const after = Number(process.env.DISPATCH_AFTER_EPOCH);
assert.ok(token && repo === 'ngocnhanvo/escvn-actions' && Number.isFinite(after) && after>0, 'Invalid GitHub build tracking parameters');

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: 'Bearer ' + token,
  'X-GitHub-Api-Version': '2022-11-28',
};
async function get(path) {
  const response = await fetch('https://api.github.com/repos/'+repo+path, { headers });
  if (!response.ok) throw Error('GitHub runs API HTTP '+response.status);
  return response.json();
}
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
let run = null;
for(let i=0;i<36;i++){
  const listing = await get('/actions/runs?event=repository_dispatch&per_page=40');
  const matches = (listing.workflow_runs||[]).filter(r=>r.path==='.github/workflows/deploy.yml' && Date.parse(r.created_at)>=after*1000).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
  if(matches.length){run=matches[0];break;}
  console.log('EDU20_DEPLOY_WAIT dispatch '+(i+1));
  await delay(5000);
}
assert.ok(run, 'WordPress build dispatch not found in GitHub Actions');
console.log('EDU20_DEPLOY_RUN '+run.html_url);
for(let i=0;i<210;i++){
  const detail=await get('/actions/runs/'+run.id);
  console.log('EDU20_DEPLOY_STATUS '+detail.status+' '+(detail.conclusion||'pending'));
  if(detail.status==='completed'){
    assert.equal(detail.conclusion,'success','ESC production deploy failed: '+detail.html_url+' ('+detail.conclusion+')');
    console.log('EDU20_DEPLOY_PASS '+detail.html_url);
    process.exit(0);
  }
  await delay(6000);
}
throw Error('ESC production build timed out, check '+run.html_url);
