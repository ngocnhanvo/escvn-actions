/**
 * ESC Member mapping import using the actual WordPress product identifier.
 * Match CSV `product_name` against ACF `tld` first, then against the FULL
 * WordPress product title (NFKC + whitespace trim + case only). No Woo ID and
 * no fuzzy matching. For exact, unique matches only, fill missing ACF `tld`
 * and `member_product_id` without modifying pre-existing nonempty values.
 *
 * Uses an authenticated WordPress REST request (with WordPress REST nonce),
 * checks the live record immediately before writing, then reads it back.
 * A failed canary aborts before the batch. Does not create/delete products.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HOST = 'https://admin.esc.vn';
const OUTPUT = 'member-product-id-apply';
const input = JSON.parse(readFileSync('scripts/data/member-products.json', 'utf8'));
const WP_URL = process.env.WP_ADMIN_URL;
const USER = process.env.WP_ADMIN_USERNAME;
const PASS = process.env.WP_ADMIN_PASSWORD;
assert.ok(WP_URL && USER && PASS, 'Missing WordPress admin credentials');
assert.equal(new URL(WP_URL.includes('://') ? WP_URL : 'https://' + WP_URL).origin, HOST,
  'Unexpected WordPress environment');
assert.equal(input.length, 596, 'Member CSV changed; stop before writing');

const tidy = value => String(value ?? '').normalize('NFKC').trim();
const norm = value => tidy(value).toLocaleLowerCase('en-US');
const htmlTitle = value => String(value ?? '')
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#039;|&apos;/gi, "'");
const validMember = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchProducts() {
  let page = 1, pages = 1;
  const result = [];
  do {
    const url = `${HOST}/wp-json/wp/v2/product?status=publish&per_page=50&page=${page}&_fields=id,title,acf,slug`;
    let response;
    for (let n = 0; n < 3; n++) {
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
        if (response.ok) break;
        if (response.status < 500 && response.status !== 429) break;
      } catch (err) { if (n === 2) throw err; }
      await sleep(1000 * (n + 1));
    }
    assert.equal(response?.status, 200, `Catalog page ${page} HTTP ${response?.status}`);
    const rows = await response.json();
    assert.ok(Array.isArray(rows) && rows.length > 0, `Invalid catalog page ${page}`);
    result.push(...rows);
    pages = Number(response.headers.get('x-wp-totalpages') || 1);
    assert.ok(pages <= 200);
    page++;
  } while (page <= pages);
  return result;
}

const products = await fetchProducts();
const byIdentifier = new Map(), byTitle = new Map();
for (const product of products) {
  const a = norm(product.acf?.tld);
  const t = norm(htmlTitle(product.title?.rendered));
  if (a) { if (!byIdentifier.has(a)) byIdentifier.set(a, []); byIdentifier.get(a).push(product); }
  if (t) { if (!byTitle.has(t)) byTitle.set(t, []); byTitle.get(t).push(product); }
}
const memberKeys = new Map();
for (const row of input) {
  assert.ok(validMember(row.product_id), 'Invalid CSV Member ID');
  const key = norm(row.product_name);
  memberKeys.set(key, (memberKeys.get(key) || 0) + 1);
}

const candidates = [], unmatched = [], skipped = [], conflicts = [];
const usedWpIds = new Set();
for (const row of input) {
  const label = tidy(row.product_name);
  const key = norm(label);
  const matches = byIdentifier.get(key) || byTitle.get(key) || [];
  if (!matches.length) { unmatched.push({ label, member_id: String(row.product_id), reason: 'NOT_FOUND' }); continue; }
  const origins = new Set(matches.map(p => String(p.acf?.origin_product_id || p.id)));
  if (origins.size !== 1 || memberKeys.get(key) !== 1 || matches.some(p => usedWpIds.has(p.id))) {
    skipped.push({ label, member_id: String(row.product_id), reason: 'AMBIGUOUS_MATCH', wp_ids: matches.map(p => p.id) });
    continue;
  }
  const problems = matches.filter(p =>
    (norm(p.acf?.tld) && norm(p.acf?.tld) !== key) ||
    (tidy(p.acf?.member_product_id) && tidy(p.acf?.member_product_id) !== String(row.product_id))
  );
  if (problems.length) {
    conflicts.push({ label, member_id: String(row.product_id), wp_ids: problems.map(p => p.id), reason: 'EXISTING_VALUE_CONFLICT' });
    continue;
  }
  matches.forEach(p => usedWpIds.add(p.id));
  for (const p of matches) {
    candidates.push({
      id: p.id, label, member_id: String(row.product_id), origin: String(p.acf?.origin_product_id || p.id),
      product_title: htmlTitle(p.title?.rendered), prior_identifier: tidy(p.acf?.tld),
      prior_member_id: tidy(p.acf?.member_product_id),
      source: (byIdentifier.get(key) || []).some(x => x.id === p.id) ? 'IDENTIFIER' : 'EXACT_TITLE'
    });
  }
}
// The reviewed 2026-11-19 read-only snapshot contained 65 already-identified
// Member codes and 269 previously unmarked product titles. A substantial
// deviation indicates changed source data and requires re-review.
assert.ok(candidates.length >= 325 && candidates.length <= 380,
  `Unexpected exact mapping count ${candidates.length}; abort without changes`);
assert.equal(new Set(candidates.map(c => c.id)).size, candidates.length, 'Duplicate WordPress ID');
assert.ok(candidates.some(c => c.id === 55601 && c.member_id === '225600' && norm(c.label) === '.ap.vn'), 'Missing supplied .ap.vn canary');
assert.ok(candidates.some(c => c.id === 50536 && c.member_id === '40500' && norm(c.label) === '.bacninh.vn'), 'Missing blank identifier canary');

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/plan.json`, JSON.stringify({ csv_count: input.length, wp_count: products.length,
  candidates: candidates.length, unmatched, skipped, conflicts,
  records: candidates }, null, 2));
const results = [];
const save = () => writeFileSync(`${OUTPUT}/result.json`, JSON.stringify({
  updated: results.filter(x => x.status === 'UPDATED').length,
  unchanged: results.filter(x => x.status === 'UNCHANGED').length,
  conflict: results.filter(x => x.status === 'CONFLICT').length,
  error: results.filter(x => x.status === 'ERROR').length,
  results
}, null, 2));
assert.equal(conflicts.length, 0, 'Catalog ACF has conflicting mappings; stop before writing');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

async function login() {
  await page.goto(HOST + '/wp-admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await page.locator('#user_login').isVisible().catch(() => false)) {
    await page.locator('#user_login').fill(USER);
    await page.locator('#user_pass').fill(PASS);
    const text = await page.locator('body').innerText();
    const m = text.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if (m) {
      const value = m[2] === '+' ? +m[1] + +m[3] : m[2] === '-' ? +m[1] - +m[3] : +m[1] * +m[3];
      const captcha = page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[type="number"]').first();
      assert.ok(await captcha.count(), 'Unsupported CAPTCHA');
      await captcha.fill(String(value));
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.locator('#wp-submit').click()
    ]);
  }
  assert.ok(!page.url().includes('wp-login.php'), 'WordPress login failed');
  assert.ok(page.url().startsWith(HOST), 'Unexpected login redirect');
}

async function getNonce() {
  const answer = await page.evaluate(async () => {
    const response = await fetch('/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin', cache: 'no-store' });
    return { http: response.status, nonce: (await response.text()).trim() };
  });
  assert.equal(answer.http, 200, 'WordPress REST nonce endpoint failed');
  assert.match(answer.nonce, /^[a-f0-9]{10}$/, 'WordPress REST nonce invalid');
  return answer.nonce;
}

async function apiProduct(id, nonce, data = null) {
  return page.evaluate(async ({ id, nonce, data }) => {
    const options = { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': nonce, Accept: 'application/json' } };
    if (data) {
      options.method = 'POST';
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify({ acf: data });
    }
    const response = await fetch('/wp-json/wp/v2/product/' + id + '?_fields=id,title,acf', options);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }, { id, nonce, data });
}

async function updateOne(target, nonce) {
  const old = await apiProduct(target.id, nonce);
  assert.equal(old.status, 200, `Read ${target.id} HTTP ${old.status}`);
  assert.equal(old.body.id, target.id, `Read ${target.id} returned mismatched product ID`);
  const currentIdentifier = tidy(old.body.acf?.tld);
  const currentMemberId = tidy(old.body.acf?.member_product_id);
  const currentTitle = htmlTitle(old.body.title?.rendered);
  const key = norm(target.label);
  // Field may already have been added by an earlier attempt. Validate
  // current label/identifier before each write to avoid stale-plan updates.
  if (norm(currentIdentifier) && norm(currentIdentifier) !== key) {
    results.push({ id: target.id, label: target.label, status: 'CONFLICT', reason: 'IDENTIFIER_CHANGED' }); save(); return;
  }
  if (currentMemberId && currentMemberId !== target.member_id) {
    results.push({ id: target.id, label: target.label, status: 'CONFLICT', reason: 'MEMBER_ID_CHANGED' }); save(); return;
  }
  if (norm(currentTitle) !== key && norm(currentIdentifier) !== key) {
    results.push({ id: target.id, label: target.label, status: 'CONFLICT', reason: 'TITLE_CHANGED' }); save(); return;
  }
  const data = {};
  if (!currentIdentifier) data.tld = target.label;
  if (!currentMemberId) data.member_product_id = target.member_id;
  if (Object.keys(data).length === 0) {
    results.push({ id: target.id, label: target.label, status: 'UNCHANGED' }); save(); return;
  }
  const response = await apiProduct(target.id, nonce, data);
  assert.equal(response.status, 200, `Update ${target.id} HTTP ${response.status}: ${JSON.stringify(response.body).slice(0, 1500)}`);
  const after = await apiProduct(target.id, nonce);
  assert.equal(after.status, 200, `Readback ${target.id} HTTP ${after.status}`);
  assert.equal(norm(after.body.acf?.tld), key, `Identifier readback mismatch ${target.id}`);
  assert.equal(tidy(after.body.acf?.member_product_id), target.member_id, `Member ID readback mismatch ${target.id}`);
  results.push({ id: target.id, label: target.label, member_id: target.member_id, status: 'UPDATED', updated_fields: Object.keys(data),
    before: { tld: currentIdentifier, member_product_id: currentMemberId } });
  console.log(`UPDATED id=${target.id} identifier=${target.label} fields=${Object.keys(data).join(',')}`);
  save();
}

try {
  await login();
  // If ACF REST cannot write, fail on one reviewed exact-title canary, not
  // after processing hundreds of records.
  const nonce = await getNonce();
  const canary = candidates.find(c => c.id === 50536);
  await updateOne(canary, nonce);
  assert.ok(results.at(-1)?.status === 'UPDATED' || results.at(-1)?.status === 'UNCHANGED', 'Canary did not pass');
  for (const target of candidates.filter(c => c.id !== canary.id)) {
    try { await updateOne(target, nonce); }
    catch (error) {
      results.push({ id: target.id, label: target.label, status: 'ERROR', reason: String(error?.message || error) });
      console.error(`ERROR id=${target.id} ${String(error?.message || error)}`);
      save();
    }
    await sleep(100); // avoid hammering admin REST
  }
  console.log(`DONE wp_count=${products.length} matched=${candidates.length} updated=${results.filter(x => x.status === 'UPDATED').length} unchanged=${results.filter(x => x.status === 'UNCHANGED').length} conflicts=${results.filter(x => x.status === 'CONFLICT').length} errors=${results.filter(x => x.status === 'ERROR').length} unmatched_csv=${unmatched.length} temporary_created=0 cleanup_remaining=0`);
  assert.equal(results.filter(x => x.status === 'CONFLICT' || x.status === 'ERROR').length, 0, 'One or more exact matches failed');
} finally {
  save();
  await context.close();
  await browser.close();
}
