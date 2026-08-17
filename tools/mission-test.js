const { chromium, devices } = require('playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WORK = process.env.WORK || path.join(os.tmpdir(), 'trip');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  :: ' + x)); if (!c) fail++; };

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const c = await b.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const errors = [];
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await p.goto(BASE + '/index.html');
  await p.waitForSelector('#scHome.show');
  const btns = await p.$$eval('#scHome .btn', els => els.map(e => e.textContent.split('\n')[0].trim()));
  ok('home shows the three buttons', btns.length === 3, JSON.stringify(btns));
  ok('button order: Create, Upload Mission, Upload Template',
     /^Create Mission/.test(btns[0]) && /^Upload Mission/.test(btns[1]) && /^Upload Template/.test(btns[2]),
     JSON.stringify(btns));

  // ---- create mission ----
  await p.click('#newMissionBtn');
  await p.waitForSelector('#scNew.show');
  ok('start location prefilled HOR', (await p.inputValue('#fStartLoc')) === 'HOR');
  ok('next location prefilled HOR', (await p.inputValue('#fNextLoc')) === 'HOR');
  const roles = await p.$$eval('#fRole option', o => o.map(x => x.value));
  ok('role dropdown carries the MCAT roles',
     ['Intel SME','AIR Systems SME','Network SME','Maneuver Systems SME','MCAT Lead']
       .every(r => roles.includes(r)), JSON.stringify(roles));
  ok('"Other" field hidden until chosen', await p.isHidden('#rowOther'));
  await p.selectOption('#fRole', 'Other…');
  ok('"Other" reveals a text field', await p.isVisible('#rowOther'));
  await p.selectOption('#fRole', 'Network SME');

  // validation
  await p.click('#newSubmit');
  ok('rejects an empty form', (await p.textContent('#newMsg')).includes('first and last name'));
  await p.fill('#fName', 'Jane Doe');
  await p.fill('#fMissionLoc', 'Fort Bliss, TX');
  await p.fill('#fStart', '2026-03-03');
  await p.fill('#fEnd', '2026-03-01');
  await p.click('#newSubmit');
  ok('rejects end before start', (await p.textContent('#newMsg')).includes('before the start date'));
  await p.fill('#fEnd', '2026-03-07');

  await p.click('#newSubmit');
  await p.waitForSelector('#scDay.show');
  ok('lands on the notes screen', await p.isVisible('#scDay.show'));
  ok('name carried over', (await p.textContent('#ctxName')) === 'Jane Doe');
  ok('role carried over', (await p.textContent('#ctxRole')) === 'Network SME');
  const days = await p.$$eval('#strip .day', e => e.map(x => x.textContent));
  ok('5 days from 3–7 March', days.join(',') === '1,2,3,4,5', days.join(','));
  ok('day 1 titled', (await p.textContent('#dTitle')) === 'Day One', await p.textContent('#dTitle'));
  ok('day 1 dated in house format', (await p.textContent('#dDate')) === '03 Mar 2026', await p.textContent('#dDate'));
  await p.click('#strip .day:nth-child(5)');
  ok('day 5 dated in house format', (await p.textContent('#dDate')) === '07 Mar 2026', await p.textContent('#dDate'));

  // ---- write notes, save ----
  await p.click('#strip .day:nth-child(1)');
  ok('day 1 pre-seeded with the outbound travel',
     (await p.inputValue('#ta')) === 'Travel from HOR to Fort Bliss, TX', await p.inputValue('#ta'));
  await p.click('#strip .day:nth-child(5)');
  ok('last day pre-seeded with the return travel',
     (await p.inputValue('#ta')) === 'Travel from Fort Bliss, TX to HOR', await p.inputValue('#ta'));
  await p.click('#strip .day:nth-child(1)');
  await p.fill('#ta', 'Travel from HOR to Fort Bliss, TX\nSet up the network.');
  await p.waitForFunction(() => document.getElementById('savedAt').textContent === 'kept');
  await p.click('#strip .day:nth-child(3)');
  await p.fill('#ta', 'Day three work.');
  await p.waitForFunction(() => document.getElementById('savedAt').textContent === 'kept');
  await p.fill('#sol', '42');

  // reload — a created mission needs no template to come back
  await p.reload();
  await p.waitForSelector('#scDay.show', { timeout: 10000 });
  ok('reload returns to the mission with no template', (await p.textContent('#ctxName')) === 'Jane Doe');
  ok('reload keeps soldiers', (await p.inputValue('#sol')) === '42');

  await p.evaluate(() => { navigator.canShare = undefined; });
  await p.waitForTimeout(1200);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#save')]);
  const out = path.join(WORK, 'mission.docx');
  await dl.saveAs(out);
  ok('produces a .docx', fs.existsSync(out) && fs.statSync(out).size > 500, 'size ' + fs.statSync(out).size);
  ok('named from the mission', /^Trip_Report_Fort_Bliss_TX_Doe\.docx$/.test(dl.suggestedFilename()),
     dl.suggestedFilename());

  // ---- mission file round-trip on a clean phone ----
  const [bk] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#backupBtn')]);
  const bkPath = path.join(WORK, 'mission.json');
  await bk.saveAs(bkPath);
  const c2 = await b.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => errors.push('ctx2: ' + String(e)));
  await p2.goto(BASE + '/index.html');
  await p2.waitForSelector('#scHome.show');
  await p2.setInputFiles('#restorePick', bkPath);
  await p2.waitForSelector('#scDay.show', { timeout: 10000 });
  ok('Upload Mission goes straight to the notes, no template needed',
     (await p2.textContent('#ctxName')) === 'Jane Doe');
  await p2.click('#strip .day:nth-child(3)');
  ok('uploaded mission keeps the notes', (await p2.inputValue('#ta')).includes('Day three work'));

  // ---- the generated .docx re-imports as a template ----
  const c3 = await b.newContext({ ...devices['iPhone 13'] });
  const p3 = await c3.newPage();
  p3.on('pageerror', e => errors.push('ctx3: ' + String(e)));
  await p3.goto(BASE + '/index.html');
  await p3.setInputFiles('#pick', out);
  await p3.waitForSelector('#scWho.show', { timeout: 10000 });
  const who = await p3.$$eval('#whoList .btn', e => e.map(x => x.textContent));
  ok('generated file parses back as a template', who.length === 1 && /Jane Doe/.test(who[0]),
     JSON.stringify(who));
  await p3.click('#whoList .btn:nth-child(1)');
  await p3.waitForSelector('#scDay.show');
  ok('round-trip keeps soldiers', (await p3.inputValue('#sol')) === '42', await p3.inputValue('#sol'));
  const d3 = await p3.$$eval('#strip .day', e => e.map(x => x.textContent));
  ok('round-trip keeps all 5 days', d3.join(',') === '1,2,3,4,5', d3.join(','));
  ok('round-trip keeps the notes', (await p3.inputValue('#ta')).includes('Set up the network'),
     await p3.inputValue('#ta'));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall green');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
