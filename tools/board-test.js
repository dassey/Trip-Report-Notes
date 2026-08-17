/* The status board tab: the form, the grouping, and the .pptx that comes out.
 *
 *   python3 -m http.server 8777 &
 *   WORK=/tmp/trip node tools/board-test.js
 *   python3 tools/check-pptx.py /tmp/trip/board.pptx      # structural check
 */
const { chromium, devices } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const WORK = process.env.WORK || path.join(os.tmpdir(), 'trip');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  :: ' + x)); if (!c) fail++; };

async function setRow(page, i, system, id, status, note) {
  const el = (await page.$$('#bRows .brow'))[i];
  await el.$eval('.f-system', (n, v) => { n.value = v; n.dispatchEvent(new Event('input')); }, system);
  await el.$eval('.f-id', (n, v) => { n.value = v; n.dispatchEvent(new Event('input')); }, id);
  await el.$eval('.f-status', (n, v) => { n.value = v; n.dispatchEvent(new Event('change')); }, status);
  await el.$eval('.f-note', (n, v) => { n.value = v; n.dispatchEvent(new Event('input')); }, note || '');
}

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const c = await b.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await p.goto(BASE + '/index.html');
  await p.waitForSelector('#scHome.show');
  ok('home offers the status board', await p.isVisible('#boardBtn'));

  await p.click('#boardBtn');
  await p.waitForSelector('#scBoard.show');
  const st = await p.$$eval('#bOverall option', o => o.map(x => x.value));
  ok('overall status offers FMC/PMC/NMC/N-A', JSON.stringify(st) === '["FMC","PMC","NMC","N/A"]', JSON.stringify(st));
  ok('starts with one empty system', (await p.$$('#bRows .brow')).length === 1);

  // nothing typed yet
  await p.click('#bMake');
  ok('refuses an empty board', (await p.textContent('#boardMsg')).includes('Nothing to put on the board'));

  await p.fill('#bUnit', 'UNIT A');
  await p.fill('#bNode', 'UKN');
  await p.selectOption('#bOverall', 'PMC');

  const rows = [
    ['Colorless Core', 'JNN', 'FMC', ''],
    ['Firewall', 'JNN', 'PMC', 'Allowing all traffic'],
    ['Voice', 'JNN', 'NMC', 'CUCM 10, not fully functioning'],
    ['Colorless Core', 'JNN x2', 'N/A', 'Only 1 JNN present'],
    ['STT', 'TRANSPORT', 'NMC', ''],
  ];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) await p.click('#bAdd');
    await setRow(p, i, ...rows[i]);
  }
  ok('rows add up', (await p.$$('#bRows .brow')).length === 5);
  ok('adding a row carries the last ID forward',
     (await (await p.$$('#bRows .brow'))[4].$eval('.f-id', n => n.value)) === 'TRANSPORT');

  // survives a reload
  await p.reload();
  await p.waitForSelector('#scHome.show');
  await p.click('#boardBtn');
  await p.waitForSelector('#scBoard.show');
  ok('board survives a reload', (await p.$$('#bRows .brow')).length === 5);
  ok('reload keeps the unit', (await p.inputValue('#bUnit')) === 'UNIT A');

  // remove a row
  await p.click('#bRows .brow:nth-child(5) .del');
  ok('a row can be removed', (await p.$$('#bRows .brow')).length === 4);
  await p.click('#bAdd');
  await setRow(p, 4, 'STT', 'TRANSPORT', 'NMC', 'Unit says it is broken');

  await p.evaluate(() => { navigator.canShare = undefined; });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#bMake')]);
  const out = path.join(WORK, 'board.pptx');
  await dl.saveAs(out);
  ok('produces a .pptx', fs.existsSync(out) && fs.statSync(out).size > 2000, 'size ' + fs.statSync(out).size);
  ok('named from the node number', dl.suggestedFilename() === 'Node_Status_Board_UKN.pptx', dl.suggestedFilename());
  const head = fs.readFileSync(out).subarray(0, 2).toString('latin1');
  ok('is a real zip container', head === 'PK', head);
  const msg = await p.textContent('#boardMsg');
  ok('reports 3 cards and 5 systems', /3 cards, 5 systems/.test(msg), msg.replace(/\n/g, ' | '));
  ok('reports the discrepancy count', /4 on the discrepancy slide/.test(msg), msg.replace(/\n/g, ' | '));

  // 3 IDs already, and 8 cards is what fits — push it to 9
  for (let k = 0; k < 6; k++) {
    await p.click('#bAdd');
    await setRow(p, 5 + k, 'Extra ' + k, 'NODE ' + k, 'FMC', '');
  }
  await p.click('#bMake');
  await p.waitForSelector('#boardMsg .msg.bad', { timeout: 10000 });
  ok('refuses more IDs than fit on a slide', (await p.textContent('#boardMsg')).includes('Too many IDs'));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall green');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
