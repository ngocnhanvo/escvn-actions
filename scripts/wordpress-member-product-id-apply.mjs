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
const compact = value => Array.from(norm(value)).filter(ch => /[a-z0-9.]/.test(ch)).join('');
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
const byIdentifier = new Map(), byTitle = new Map(), byCompactTitle = new Map();
for (const product of products) {
  const a = norm(product.acf?.tld);
  const t = norm(htmlTitle(product.title?.rendered));
  if (a) { if (!byIdentifier.has(a)) byIdentifier.set(a, []); byIdentifier.get(a).push(product); }
  if (t) { if (!byTitle.has(t)) byTitle.set(t, []); byTitle.get(t).push(product); }
  const ct = compact(htmlTitle(product.title?.rendered));
  if (ct) { if (!byCompactTitle.has(ct)) byCompactTitle.set(ct, []); byCompactTitle.get(ct).push(product); }
}
const memberKeys = new Map(), memberCompactKeys = new Map();
for (const row of input) {
  assert.ok(validMember(row.product_id), 'Invalid CSV Member ID');
  const key = norm(row.product_name);
  memberKeys.set(key, (memberKeys.get(key) || 0) + 1);
  const ck = compact(row.product_name);
  memberCompactKeys.set(ck, (memberCompactKeys.get(ck) || 0) + 1);
}

const candidates = [], unmatched = [], skipped = [], conflicts = [];
const usedWpIds = new Set();
for (const row of input) {
  const label = tidy(row.product_name);
  const key = norm(label);
  const exact = byIdentifier.get(key) || byTitle.get(key);
  const ck = compact(label);
  const matches = exact || (memberCompactKeys.get(ck) === 1 ? byCompactTitle.get(ck) : undefined) || [];
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
      source: (byIdentifier.get(key) || []).some(x => x.id === p.id) ? 'IDENTIFIER' :
        (byTitle.get(key) || []).some(x => x.id === p.id) ? 'EXACT_TITLE' : 'COMPACT_TITLE'
    });
  }
}
// Reviewed ESC-specific legacy G Suite labels. The Member CSV contains these
// identifiers, while ESC.vn sells the corresponding Google Workspace products
// under renamed titles. Restrict this one-to-one mapping to verified WP IDs and
// exact current titles to prevent accidental assignment to Microsoft 365 plans.
// G Suite Enterprise -> Business Plus is ESC's legacy catalogue mapping, NOT
// the official Google licensing equivalence; confirm plan entitlement separately.
const reviewedGsuite = [
  { label: 'GSuitebasic', member_id: '131600', wp_id: 832, title: 'Google Workspace Business Starter' },
  { label: 'Gsuitebusiness', member_id: '131700', wp_id: 833, title: 'Google Google Workspace Business Standard' },
  { label: 'GsuiteEnterprise', member_id: '131800', wp_id: 834, title: 'Google Google Workspace Business Plus' }
];
for (const mapping of (process.env.ESC_MEMBER_REVIEW_ONLY === '1' ? [] : reviewedGsuite)) {
  const memberRows = input.filter(row => norm(row.product_name) === norm(mapping.label));
  assert.equal(memberRows.length, 1, `CSV member code not unique: ${mapping.label}`);
  assert.equal(String(memberRows[0].product_id), mapping.member_id, `Member ID changed: ${mapping.label}`);
  const wp = products.find(p => p.id === mapping.wp_id);
  assert.ok(wp, `ESC product missing: ${mapping.wp_id}`);
  assert.equal(norm(htmlTitle(wp.title?.rendered)), norm(mapping.title),
    `ESC product title changed: ${mapping.wp_id}`);
  assert.ok(!usedWpIds.has(wp.id), `Target already mapped: ${wp.id}`);
  const prior_identifier = tidy(wp.acf?.tld);
  const prior_member_id = tidy(wp.acf?.member_product_id);
  assert.ok(!prior_identifier || norm(prior_identifier) === norm(mapping.label),
    `Identifier conflict: ${wp.id}`);
  assert.ok(!prior_member_id || prior_member_id === mapping.member_id,
    `Member ID conflict: ${wp.id}`);
  usedWpIds.add(wp.id);
  const unmatchedIndex = unmatched.findIndex(item =>
    norm(item.label) === norm(mapping.label) && item.member_id === mapping.member_id);
  if (unmatchedIndex >= 0) unmatched.splice(unmatchedIndex, 1);
  candidates.push({
    id: wp.id, label: mapping.label, member_id: mapping.member_id,
    origin: String(wp.acf?.origin_product_id || wp.id), product_title: mapping.title,
    prior_identifier, prior_member_id, source: 'MANUAL_GSUITE'
  });
}
// Targeted execution only touches the three explicitly reviewed Google Workspace
// products, leaving unrelated catalog changes outside this request's write scope.
const GSUITE_ONLY = process.env.ESC_MEMBER_GSUITE_ONLY === '1';
const REVIEW_ONLY = process.env.ESC_MEMBER_REVIEW_ONLY === '1';
if (REVIEW_ONLY) {
  assert.ok(!GSUITE_ONLY, 'Overlapping import scopes');
  // Human-reviewed 2026-11-19 candidate list: 36 high confidence and 11
  // medium-confidence mappings with a single chosen plan. Two genuinely
  // ambiguous codes (GlobalSignSANsSSL and GlobalSignWildcardSSL) are
  // intentionally excluded rather than assigning a possibly wrong license.
  const mappings = [
    {"label": "DSVN1", "wp_id": 889, "title": "DSVN01"},
    {"label": "DSVN2", "wp_id": 890, "title": "DSVN02"},
    {"label": "DSVN3", "wp_id": 891, "title": "DSVN03"},
    {"label": "CVN1", "wp_id": 879, "title": "CVN01"},
    {"label": "CVN2", "wp_id": 880, "title": "CVN02"},
    {"label": "CVN3", "wp_id": 881, "title": "CVN03"},
    {"label": "CVN4", "wp_id": 882, "title": "CVN04"},
    {"label": "Plesk Unlimited Domains VPS", "wp_id": 995, "title": "Plesk Web Host Edition (Unlimited Domains) VPS"},
    {"label": "Plesk Unlimited Domains", "wp_id": 996, "title": "Plesk Web Host Edition (Unlimited Domains) Server"},
    {"label": "Plesk 30 Domains", "wp_id": 994, "title": "Plesk Web Pro Edition (30 Domains) Server"},
    {"label": "Plesk 10 Domains", "wp_id": 992, "title": "Plesk Web Admin Edition (10 Domains) Server"},
    {"label": "MP5", "wp_id": 820, "title": "MAIL PRO (MP5)"},
    {"label": "MP4", "wp_id": 819, "title": "MAIL PRO (MP4)"},
    {"label": "MP0", "wp_id": 815, "title": "MAIL PRO (MP0)"},
    {"label": "eCloud1", "wp_id": 868, "title": "ECLOUD VPS 1"},
    {"label": "eCloud2", "wp_id": 869, "title": "ECLOUD VPS 2"},
    {"label": "eCloud3", "wp_id": 870, "title": "ECLOUD VPS 3"},
    {"label": "eCloud4", "wp_id": 871, "title": "ECLOUD VPS 4"},
    {"label": "WPStandard", "wp_id": 813, "title": "WordPress Standard"},
    {"label": "WPPro", "wp_id": 814, "title": "WordPress Pro"},
    {"label": "PositiveSSL", "wp_id": 752, "title": "Sectigo PositiveSSL DV"},
    {"label": "KAV", "wp_id": 775, "title": "Kaspersky Anti-Virus"},
    {"label": "KIS", "wp_id": 776, "title": "Kaspersky Internet Security"},
    {"label": "KSOS5pc", "wp_id": 1350, "title": "Kaspersky Small Office Security (5PCs + 1 File Server)"},
    {"label": "KSOS10pc", "wp_id": 1351, "title": "Kaspersky Small Office Security (10PCs + 1 File Server)"},
    {"label": "eCloud5", "wp_id": 872, "title": "ECLOUD VPS 5"},
    {"label": "SectigoEVMultiDomainSSL", "wp_id": 955, "title": "Sectigo EV Multi-Domain SSL (3 domains)"},
    {"label": "eCloud10", "wp_id": 867, "title": "ECLOUD VPS 10"},
    {"label": "MS1", "wp_id": 827, "title": "MAIL SERVER (MS1)"},
    {"label": "MS2", "wp_id": 828, "title": "MAIL SERVER (MS2)"},
    {"label": "MS3", "wp_id": 829, "title": "MAIL SERVER (MS3)"},
    {"label": "MS4", "wp_id": 830, "title": "MAIL SERVER (MS4)"},
    {"label": "eCloud6", "wp_id": 873, "title": "ECLOUD VPS 6"},
    {"label": "eCloud7", "wp_id": 874, "title": "ECLOUD VPS 7"},
    {"label": "PositiveSSLWildcard", "wp_id": 944, "title": "Sectigo PositiveSSL Wildcard DV"},
    {"label": "MailBusinessStarter", "wp_id": 821, "title": "Business Starter"},
    {"label": "MailBusinessStandard", "wp_id": 822, "title": "Business Standard"},
    {"label": "MailBusinessPlus", "wp_id": 823, "title": "Business Plus"},
    {"label": "PositiveSSLMultiDomain", "wp_id": 945, "title": "Sectigo PositiveSSL Multi-Domain DV"},
    {"label": "GlobalSignAlphaSSLWildcard", "wp_id": 778, "title": "GlobalSign Alpha Wildcard SSL"},
    {"label": "SPACBasic", "wp_id": 931, "title": "SECTIGO PERSONAL AUTHENTICATION CERTIFICATES BASIC (DV)"},
    {"label": "SPACPro", "wp_id": 932, "title": "SECTIGO PERSONAL AUTHENTICATION CERTIFICATES PRO (OV)"},
    {"label": "SPACEnterprise", "wp_id": 933, "title": "SECTIGO PERSONAL AUTHENTICATION CERTIFICATES ENTERPRISEX (EV)"},
    {"label": "Ms365BusinessStandard", "wp_id": 1006, "title": "Microsoft 365 Business Standard"},
    {"label": "Ms365BusinessBasic", "wp_id": 1005, "title": "Microsoft 365 Business Basic"},
    {"label": "Ms365BusinessPremium", "wp_id": 1007, "title": "Microsoft 365 Business Premium"},
    {"label": "WPsPro", "wp_id": 1429, "title": "WPS PROFESSIONAL"}
  ];
  assert.equal(mappings.length, 47, 'Reviewed plan size changed');
  assert.equal(new Set(mappings.map(m => m.wp_id)).size, 47, 'Duplicate reviewed WordPress target');
  assert.equal(new Set(mappings.map(m => norm(m.label))).size, 47, 'Duplicate reviewed Member code');
  const targets = mappings.map(mapping => {
    const memberRows = input.filter(r => norm(r.product_name) === norm(mapping.label));
    assert.equal(memberRows.length, 1, `Member code not unique: ${mapping.label}`);
    const member_id = String(memberRows[0].product_id);
    assert.ok(validMember(member_id), `Invalid Member Product ID: ${mapping.label}`);
    const wp = products.find(p => p.id === mapping.wp_id);
    assert.ok(wp, `WordPress product missing: ${mapping.wp_id}`);
    assert.equal(norm(htmlTitle(wp.title?.rendered)), norm(mapping.title),
      `Product title changed: ${mapping.wp_id}`);
    const prior_identifier = tidy(wp.acf?.tld);
    const prior_member_id = tidy(wp.acf?.member_product_id);
    assert.ok(!prior_identifier || norm(prior_identifier) === norm(mapping.label),
      `Existing identifier conflicts: ${mapping.wp_id}`);
    assert.ok(!prior_member_id || prior_member_id === member_id,
      `Existing Member Product ID conflicts: ${mapping.wp_id}`);
    const otherOwners = products.filter(p => p.id !== wp.id &&
      (norm(p.acf?.tld) === norm(mapping.label) ||
        (tidy(p.acf?.member_product_id) && tidy(p.acf?.member_product_id) === member_id)));
    assert.equal(otherOwners.length, 0, `Existing duplicate owner of ${mapping.label}`);
    return {
      id: wp.id, label: mapping.label, member_id,
      origin: String(wp.acf?.origin_product_id || wp.id),
      product_title: mapping.title, prior_identifier, prior_member_id,
      source: 'REVIEW_MEMBER'
    };
  });
  candidates.splice(0, candidates.length, ...targets);
} else if (GSUITE_ONLY) {
  const targets = candidates.filter(c => c.source === 'MANUAL_GSUITE');
  assert.equal(targets.length, reviewedGsuite.length, 'Unexpected G Suite target count');
  assert.deepEqual(targets.map(c => c.id).sort((a, b) => a - b), [832, 833, 834]);
  candidates.splice(0, candidates.length, ...targets);
} else {
  // Full-catalog mode retains its original strict bulk-import boundaries.
  assert.ok(candidates.length >= 325 && candidates.length <= 380,
    `Unexpected exact mapping count ${candidates.length}; abort without changes`);
  assert.ok(candidates.some(c => c.id === 55601 && c.member_id === '225600' && norm(c.label) === '.ap.vn'), 'Missing supplied .ap.vn canary');
  assert.ok(candidates.some(c => c.id === 50536 && c.member_id === '40500' && norm(c.label) === '.bacninh.vn'), 'Missing blank identifier canary');
}
assert.equal(new Set(candidates.map(c => c.id)).size, candidates.length, 'Duplicate WordPress ID');

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/plan.json`, JSON.stringify({ csv_count: input.length, wp_count: products.length,
  candidates: candidates.length, pending: candidates.filter(c => !c.prior_identifier || !c.prior_member_id).length,
  already_complete: candidates.filter(c => c.prior_identifier && c.prior_member_id).length, unmatched, skipped, conflicts,
  records: candidates }, null, 2));
const results = [];
const save = () => writeFileSync(`${OUTPUT}/result.json`, JSON.stringify({
  updated: results.filter(x => x.status === 'UPDATED').length,
  unchanged: results.filter(x => x.status === 'UNCHANGED').length,
  conflict: results.filter(x => x.status === 'CONFLICT').length,
  error: results.filter(x => x.status === 'ERROR').length,
  results
}, null, 2));
if (!GSUITE_ONLY && !REVIEW_ONLY) assert.equal(conflicts.length, 0, 'Catalog ACF has conflicting mappings; stop before writing');

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
  const nameMatches = norm(currentTitle) === key ||
    (target.source === 'COMPACT_TITLE' && compact(currentTitle) === compact(target.label)) ||
    ((target.source === 'MANUAL_GSUITE' || target.source === 'REVIEW_MEMBER') && norm(currentTitle) === norm(target.product_title));
  if (!nameMatches && norm(currentIdentifier) !== key) {
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
  const canary = candidates.find(c => c.id === (REVIEW_ONLY ? 889 : (GSUITE_ONLY ? 832 : 50536)));
  await updateOne(canary, nonce);
  assert.ok(results.at(-1)?.status === 'UPDATED' || results.at(-1)?.status === 'UNCHANGED', 'Canary did not pass');
  // Avoid re-opening hundreds of already-complete products. The catalog
  // snapshot above was fetched directly from live WordPress in this run.
  const pending = candidates.filter(c => c.id !== canary.id && (!c.prior_identifier || !c.prior_member_id));
  for (const target of pending) {
    try { await updateOne(target, nonce); }
    catch (error) {
      results.push({ id: target.id, label: target.label, status: 'ERROR', reason: String(error?.message || error) });
      console.error(`ERROR id=${target.id} ${String(error?.message || error)}`);
      save();
    }
    await sleep(100); // avoid hammering admin REST
  }
  console.log(`DONE wp_count=${products.length} matched=${candidates.length} pending=${candidates.filter(c => !c.prior_identifier || !c.prior_member_id).length} updated=${results.filter(x => x.status === 'UPDATED').length} unchanged=${results.filter(x => x.status === 'UNCHANGED').length} conflicts=${results.filter(x => x.status === 'CONFLICT').length} errors=${results.filter(x => x.status === 'ERROR').length} unmatched_csv=${unmatched.length} temporary_created=0 cleanup_remaining=0`);
  assert.equal(results.filter(x => x.status === 'CONFLICT' || x.status === 'ERROR').length, 0, 'One or more exact matches failed');
} finally {
  save();
  await context.close();
  await browser.close();
}
