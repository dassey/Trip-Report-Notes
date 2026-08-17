/* End-to-end smoke test, driven through an iPhone-sized Chromium.
 *
 *   python3 tools/make-fixture.py /tmp/trip/trip_report.docx
 *   python3 -m http.server 8777 &
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/smoke-test.js
 *
 * It is not Safari, so it cannot prove Safari-specific behaviour on its own — but it
 * does check the things that actually break on iOS: that navigator.share() is called
 * while the tap is still active, that the template survives a reload without being
 * stuffed into localStorage, that the offline shell serves, and that the .docx that
 * comes out is the right one.
 *
 * Env: BASE (default http://127.0.0.1:8777), WORK (scratch dir), CHROME (browser path).
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXE = process.env.CHROME || undefined;
const WORK = process.env.WORK || fs.mkdtempSync(path.join(os.tmpdir(), 'tripnotes-'));
const DOCX = path.join(WORK, 'trip_report.docx');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';

if (!fs.existsSync(DOCX)) {
  console.error('Missing fixture: ' + DOCX + '\n  python3 tools/make-fixture.py ' + DOCX);
  process.exit(2);
}

let failures = 0;
function ok(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra && !cond ? '  :: ' + extra : ''));
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch(EXE ? { executablePath: EXE } : {});
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    acceptDownloads: true,
    userAgent: devices['iPhone 13'].userAgent,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ---- share shim: record calls, and prove they happen inside a user gesture ----
  await ctx.addInitScript(() => {
    window.__shared = [];
    window.__shareMode = 'ok';
    navigator.canShare = (d) => !!(d && d.files && d.files.length);
    navigator.share = async (d) => {
      const rec = { name: d.files[0].name, size: d.files[0].size, activation: navigator.userActivation ? navigator.userActivation.isActive : null };
      window.__shared.push(rec);
      if (window.__shareMode === 'notallowed') { const e = new Error('gesture'); e.name = 'NotAllowedError'; throw e; }
      if (window.__shareMode === 'abort') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; }
      return undefined;
    };
  });

  await page.goto(BASE + '/index.html');
  await page.waitForSelector('#scHome.show');
  ok('boots to the home screen', await page.isVisible('#scHome.show'));
  ok('storage pill says saving', (await page.textContent('#stor')) === 'saving', await page.textContent('#stor'));

  // ---- load template ----
  await page.setInputFiles('#pick', DOCX);
  await page.waitForSelector('#scWho.show', { timeout: 10000 });
  const people = await page.$$eval('#whoList .btn', els => els.map(e => e.textContent));
  ok('finds both SMEs', people.length === 2 && /David Massey/.test(people[0]), JSON.stringify(people));

  // ---- pick a person ----
  await page.click('#whoList .btn:nth-child(1)');
  await page.waitForSelector('#scDay.show');
  ok('locks in the person', (await page.textContent('#ctxName')) === 'David Massey');
  ok('reads soldiers trained', (await page.inputValue('#sol')) === '42', await page.inputValue('#sol'));
  const days = await page.$$eval('#strip .day', els => els.map(e => e.textContent));
  ok('lists three days', days.join(',') === '1,2,3', days.join(','));
  ok('seeds existing text', (await page.inputValue('#ta')).includes('motor pool'));

  // ---- type notes ----
  await page.fill('#ta', 'Rebuilt the network from scratch.\nSecond line of the day.');
  await page.waitForFunction(() => document.getElementById('savedAt').textContent === 'kept');
  await page.click('#strip .day:nth-child(2)');
  await page.fill('#ta', 'Day two rewritten.');
  await page.waitForFunction(() => document.getElementById('savedAt').textContent === 'kept');
  await page.fill('#sol', '57');

  // ---- persistence across reload (template must come back from IndexedDB) ----
  const b64len = await page.evaluate(() => (JSON.parse(localStorage.getItem('tripnotes.v2')).b64 || '').length);
  ok('template is NOT duplicated into localStorage', b64len === 0, 'b64 length ' + b64len);
  const idbSize = await page.evaluate(() => new Promise(res => {
    const rq = indexedDB.open('tripnotes', 1);
    rq.onsuccess = () => {
      const g = rq.result.transaction('files', 'readonly').objectStore('files').get('template');
      g.onsuccess = () => res(g.result ? g.result.byteLength : 0);
      g.onerror = () => res(-1);
    };
    rq.onerror = () => res(-1);
  }));
  ok('template is in IndexedDB', idbSize > 500, 'bytes ' + idbSize);

  await page.reload();
  await page.waitForSelector('#scDay.show', { timeout: 10000 });
  ok('reload goes straight back to the day screen', await page.isVisible('#scDay.show'));
  ok('reload keeps the person', (await page.textContent('#ctxName')) === 'David Massey');
  ok('reload keeps soldiers', (await page.inputValue('#sol')) === '57', await page.inputValue('#sol'));
  await page.click('#strip .day:nth-child(1)');
  ok('reload keeps day 1 notes', (await page.inputValue('#ta')).includes('Rebuilt the network'));

  // ---- save & share, prebuilt path: must run inside the gesture ----
  await page.waitForTimeout(1500); // let the prebuild debounce fire
  await page.click('#save');
  await page.waitForFunction(() => window.__shared.length > 0, null, { timeout: 15000 });
  const shared = await page.evaluate(() => window.__shared[0]);
  ok('shares a .docx', /\.docx$/.test(shared.name), shared.name);
  ok('filename carries the surname', /_Massey\.docx$/.test(shared.name), shared.name);
  ok('shares a non-empty file', shared.size > 500, 'size ' + shared.size);
  ok('share happens while the tap is still active (iOS requirement)', shared.activation === true,
     'userActivation.isActive=' + shared.activation);
  await page.waitForSelector('#dayMsg .msg.good');
  ok('reports success', (await page.textContent('#dayMsg')).includes('Shared'));

  // ---- NotAllowedError fallback: offer an explicit tap ----
  await page.evaluate(() => { window.__shareMode = 'notallowed'; window.__shared = []; });
  await page.fill('#ta', 'Changed again so the prebuild is stale.');
  await page.waitForTimeout(600);
  await page.click('#save');
  await page.waitForSelector('#doShare', { timeout: 15000 });
  ok('offers a manual share button when Safari refuses', await page.isVisible('#doShare'));
  await page.evaluate(() => { window.__shareMode = 'ok'; });
  await page.click('#doShare');
  await page.waitForSelector('#dayMsg .msg.good', { timeout: 10000 });
  const second = await page.evaluate(() => window.__shared[window.__shared.length - 1]);
  ok('manual tap shares with a fresh gesture', second.activation === true, String(second.activation));

  // ---- no Web Share at all -> download ----
  await page.evaluate(() => { navigator.canShare = undefined; });
  await page.fill('#ta', 'Download path.');
  await page.waitForTimeout(600);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#save')]);
  const dlPath = path.join(WORK, 'out.docx');
  await dl.saveAs(dlPath);
  ok('falls back to a download', fs.existsSync(dlPath) && fs.statSync(dlPath).size > 500,
     'size ' + (fs.existsSync(dlPath) ? fs.statSync(dlPath).size : 0));
  ok('download is named right', /_Massey\.docx$/.test(dl.suggestedFilename()), dl.suggestedFilename());

  // ---- backup json ----
  const [bk] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#backupBtn')]);
  const bkPath = path.join(WORK, 'backup.json');
  await bk.saveAs(bkPath);
  const backup = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  ok('backup carries the notes', backup.person === 'David Massey' && Object.keys(backup.notes).length >= 2,
     JSON.stringify(Object.keys(backup.notes)));

  // ---- viewport: bottom bar stays on screen ----
  const vp = await page.evaluate(() => {
    const bar = document.getElementById('bar').getBoundingClientRect();
    return { barBottom: bar.bottom, inner: window.innerHeight, docH: document.documentElement.clientHeight };
  });
  ok('save bar sits inside the viewport', vp.barBottom <= vp.inner + 1, JSON.stringify(vp));

  // ---- service worker + offline ----
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready,
    null, { timeout: 10000 }).catch(() => {});
  const swState = await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r ? (r.active ? 'active' : 'pending') : 'none'));
  ok('service worker registers', swState === 'active' || swState === 'pending', swState);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#scDay.show, #scHome.show', { timeout: 15000 });
  ok('opens with no signal', await page.isVisible('#scDay.show'));
  await ctx.setOffline(false);

  // ---- restore from backup on a clean phone ----
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('ctx2: ' + String(e)));
  await p2.goto(BASE + '/index.html');
  await p2.waitForSelector('#scHome.show');
  await p2.setInputFiles('#restorePick', bkPath);
  await p2.waitForSelector('#tplMsg .msg.good', { timeout: 10000 });
  ok('restores a template-based backup', (await p2.textContent('#tplMsg')).includes('Notes loaded'));
  await p2.setInputFiles('#pick', DOCX);
  await p2.waitForSelector('#scDay.show', { timeout: 10000 });
  await p2.click('#strip .day:nth-child(2)');
  ok('backup + template lands back on the notes', (await p2.inputValue('#ta')).includes('Day two rewritten'),
     await p2.inputValue('#ta'));

  ok('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nall green');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
