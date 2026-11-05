import { chromium } from 'playwright';

const configured = process.env.WP_ADMIN_URL;
if (!configured) throw new Error('WP_ADMIN_URL secret missing');
const origin = new URL(configured.includes('://') ? configured : 'https://' + configured).origin;
if (origin !== 'https://admin.esc.vn') throw new Error('Wrong WordPress target');

const browser = await chromium.launch({headless: true});
try {
  const guest = await browser.newContext({ignoreHTTPSErrors: false});
  const get = async (path) => {
    const response = await guest.request.get(origin + '/wp-json/esc-hkd/v1' + path, {timeout: 45000});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error('Invalid JSON for ' + path + ' HTTP ' + response.status()); }
    return {status: response.status(), body};
  };
  const health = await get('/health');
  if (health.status !== 200 || health.body.ok !== true || health.body.provinces !== 34)
    throw new Error('Health parity failed: HTTP ' + health.status + ' ' + JSON.stringify(health.body).slice(0, 180));
  const meta = await get('/meta');
  if (meta.status !== 200 || meta.body.stats?.businesses !== 0 || meta.body.provinces?.length !== 34 || meta.body.industries?.length !== 15)
    throw new Error('Meta parity failed');
  const provinces = await get('/provinces');
  if (provinces.status !== 200 || !Array.isArray(provinces.body) || provinces.body.length !== 34)
    throw new Error('Province parity failed');
  const wards = await get('/provinces/79/wards');
  if (wards.status !== 200 || !Array.isArray(wards.body) || wards.body.length !== 168 || wards.body.some(w => w.provCode !== '79'))
    throw new Error('HCM ward parity failed');
  const industries = await get('/industries');
  if (industries.status !== 200 || !Array.isArray(industries.body) || industries.body.length !== 15)
    throw new Error('Industry parity failed');
  const list = await get('/businesses?limit=20&page=1');
  if (list.status !== 200 || list.body.total !== 0 || !Array.isArray(list.body.items) || list.body.items.length !== 0)
    throw new Error('Business list empty state failed');
  const pts = await get('/map/points?bbox=8,102,24,110');
  if (pts.status !== 200 || pts.body.truncated !== false || !Array.isArray(pts.body.points) || pts.body.points.length !== 0)
    throw new Error('Map points empty state failed');
  const ext = await get('/map/extent');
  if (ext.status !== 200 || ext.body.total !== 0 || ext.body.withGeo !== 0 || ext.body.bounds !== null)
    throw new Error('Map extent empty state failed');
  const detail = await get('/businesses/unknown-no-record');
  if (detail.status !== 404 || detail.body.code !== 'hkd_not_found')
    throw new Error('Business 404 handling failed');
  const invalid = await get('/map/points?bbox=invalid');
  if (invalid.status !== 400 || invalid.body.code !== 'hkd_bad_bbox')
    throw new Error('Invalid bbox handling failed');
  const badPage = await get('/businesses?page=0');
  if (badPage.status !== 400) throw new Error('Invalid page handling failed');
  const noWrite = await guest.request.post(origin + '/wp-json/esc-hkd/v1/businesses', {data:{name:'test'}, timeout:30000});
  if (noWrite.status() !== 404 && noWrite.status() !== 405)
    throw new Error('Unexpected write route');
  console.log('HKD Step4 PASS: anonymous health, 34 provinces, 3321 wards (168 HCM), 15 industries, 0 businesses, empty directory/map, 400/404, no write route');
  await guest.close();
} finally {await browser.close();}
