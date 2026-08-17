/* Regression test for the iOS keyboard case: with the page pinned to the visual
 * viewport, iOS has no reason to scroll the focused notes box into view, so it
 * ends up behind the keyboard and you cannot see what you are typing.
 *
 * A 390x500 viewport stands in for an iPhone with the keyboard up.
 *
 *   python3 tools/make-fixture.py /tmp/trip/trip_report.docx
 *   python3 -m http.server 8777 &
 *   WORK=/tmp/trip node tools/keyboard-test.js
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const WORK = process.env.WORK || path.join(os.tmpdir(), 'trip');
const DOCX = path.join(WORK, 'trip_report.docx');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';
if (!fs.existsSync(DOCX)) {
  console.error('Missing fixture: ' + DOCX + '\n  python3 tools/make-fixture.py ' + DOCX);
  process.exit(2);
}
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  :: ' + x)); if (!c) fail++; };

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  // iPhone 13 with the keyboard up is roughly 390x500 of usable height
  const c = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 500 } });
  const p = await c.newPage();
  await p.goto(BASE + '/index.html');
  await p.setInputFiles('#pick', DOCX);
  await p.waitForSelector('#scWho.show');
  await p.click('#whoList .btn:nth-child(1)');
  await p.waitForSelector('#scDay.show');

  const before = await p.evaluate(() => {
    const ta = document.getElementById('ta').getBoundingClientRect();
    const m = document.querySelector('main').getBoundingClientRect();
    return { taTop: ta.top, taBottom: ta.bottom, mTop: m.top, mBottom: m.bottom };
  });
  console.log('  before focus:', JSON.stringify(before));
  ok('repro: notes box starts below the visible area', before.taBottom > before.mBottom,
     'box already fully visible, test is not exercising the bug');

  await p.click('#ta');
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => {
    const ta = document.getElementById('ta').getBoundingClientRect();
    const m = document.querySelector('main').getBoundingClientRect();
    const bar = document.getElementById('bar').getBoundingClientRect();
    return { taTop: ta.top, mTop: m.top, mBottom: m.bottom, barTop: bar.top, barBottom: bar.bottom, ih: window.innerHeight };
  });
  console.log('  after focus: ', JSON.stringify(after));
  ok('focusing scrolls the notes box into view', after.taTop >= after.mTop - 1 && after.taTop < after.mTop + 30,
     'taTop=' + after.taTop + ' mTop=' + after.mTop);
  ok('typing area is visible above the save bar', after.taTop < after.barTop - 80,
     'taTop=' + after.taTop + ' barTop=' + after.barTop);
  ok('save bar still on screen', after.barBottom <= after.ih + 1, JSON.stringify(after));

  await p.keyboard.type('Typing where I can see it.');
  const caretVisible = await p.evaluate(() => {
    const ta = document.getElementById('ta').getBoundingClientRect();
    const m = document.querySelector('main').getBoundingClientRect();
    return ta.top >= m.top - 1 && ta.top <= m.bottom;
  });
  ok('box stays in view while typing', caretVisible);
  ok('text landed', (await p.inputValue('#ta')).includes('Typing where I can see it'));

  await b.close();
  console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall green');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
