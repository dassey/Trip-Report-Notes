/* The WebMCP surface: that the tools register, and that calling them actually drives
 * the app. No browser here implements document.modelContext, so the test installs a
 * shim that captures registrations and lets the tools be invoked the way an agent would.
 *
 *   python3 -m http.server 8777 &
 *   WORK=/tmp/trip node tools/webmcp-test.js
 */
const { chromium, devices } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const WORK = process.env.WORK || path.join(os.tmpdir(), 'trip');
const BASE = process.env.BASE || 'http://127.0.0.1:8777';
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (c ? '' : '  :: ' + x)); if (!c) fail++; };

const SHIM = () => {
  const tools = new Map();
  const host = {
    registerTool(t) { tools.set(t.name, t); return Promise.resolve(); },
    unregisterTool(n) { tools.delete(n); },
  };
  Object.defineProperty(document, 'modelContext', { value: host, configurable: true });
  window.__tools = tools;
  window.__call = async (name, args) => {
    const t = tools.get(name);
    if (!t) throw new Error('no such tool: ' + name);
    const r = await t.execute(args || {});
    return { text: r.content.map(c => c.text).join('\n'), isError: !!r.isError };
  };
};

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const c = await b.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
  await c.addInitScript(SHIM);
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.goto(BASE + '/index.html');
  await p.waitForSelector('#scHome.show');

  const names = await p.evaluate(() => [...window.__tools.keys()]);
  ok('tools register on document.modelContext', names.length >= 15, names.length + ' tools');
  for (const n of ['get-status', 'create-mission', 'list-days', 'read-day', 'write-day',
                   'set-soldiers-trained', 'list-people', 'choose-person', 'build-report',
                   'get-status-board', 'set-status-board-header', 'add-status-board-system',
                   'remove-status-board-system', 'clear-status-board', 'build-status-board',
                   'show-screen', 'list-roles'])
    ok('exposes ' + n, names.includes(n), names.join(','));

  const shapes = await p.evaluate(() => [...window.__tools.values()].map(t => ({
    n: t.name, d: typeof t.description === 'string' && t.description.length > 20,
    s: !!(t.inputSchema && t.inputSchema.type === 'object'), e: typeof t.execute === 'function' })));
  ok('every tool has a description, an object schema and an execute',
     shapes.every(s => s.d && s.s && s.e), JSON.stringify(shapes.filter(s => !(s.d && s.s && s.e))));

  // ---- drive a whole mission through the tools ----
  let r = await p.evaluate(() => window.__call('get-status'));
  ok('get-status reports nothing loaded', JSON.parse(r.text).source === 'nothing loaded', r.text);

  r = await p.evaluate(() => window.__call('create-mission', {
    name: 'Jane Doe', role: 'Network SME', missionLocation: 'Gaylord MI',
    startDate: '2026-07-08', endDate: '2026-07-12', startLocation: 'HOR', nextLocation: 'HOR' }));
  ok('create-mission builds the mission', /5 days/.test(r.text), r.text);
  await p.waitForSelector('#scDay.show');
  ok('create-mission lands the UI on the notes screen', await p.isVisible('#scDay.show'));
  ok('the created mission shows the right person', (await p.textContent('#ctxName')) === 'Jane Doe');

  r = await p.evaluate(() => window.__call('list-days'));
  const days = JSON.parse(r.text);
  ok('list-days returns 5 days', days.length === 5, r.text.slice(0, 80));
  ok('day 1 carries the outbound travel from the file, not typed',
     days[0].fromTheFile === true && /Travel from HOR to Gaylord MI/.test(days[0].text), JSON.stringify(days[0]));

  r = await p.evaluate(() => window.__call('write-day', { day: 2, text: 'Configured the routers.' }));
  ok('write-day writes', /Configured the routers/.test(r.text), r.text);
  r = await p.evaluate(() => window.__call('write-day', { day: 2, text: 'Ran cable to the TOC.', append: true }));
  ok('write-day appends on a new line', /routers\.\nRan cable/.test(r.text), JSON.stringify(r.text));
  r = await p.evaluate(() => window.__call('read-day', { day: 2 }));
  ok('read-day reads it back', /Ran cable to the TOC/.test(r.text), r.text);
  await p.click('#strip .day:nth-child(2)');
  ok('the box on screen shows what the tool wrote',
     (await p.inputValue('#ta')).includes('Ran cable to the TOC'), await p.inputValue('#ta'));

  r = await p.evaluate(() => window.__call('read-day', { day: 99 }));
  ok('read-day refuses a day that does not exist', r.isError && /no day 99/.test(r.text), r.text);

  r = await p.evaluate(() => window.__call('set-soldiers-trained', { count: 42 }));
  ok('set-soldiers-trained sets it', /42/.test(r.text), r.text);
  ok('and the field on screen agrees', (await p.inputValue('#sol')) === '42');

  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }),
                                  p.evaluate(() => window.__call('build-report'))]);
  ok('build-report produces the .docx, named for the mission',
     dl.suggestedFilename() === 'NNNNN_TR_MCAT_8_JUL_2026.docx', dl.suggestedFilename());
  await dl.saveAs(path.join(WORK, 'mcp-report.docx'));

  // ---- and the status board ----
  await p.evaluate(() => window.__call('clear-status-board'));
  await p.evaluate(() => window.__call('set-status-board-header',
    { unit: 'UNIT A', nodeNo: 'N1', overall: 'PMC' }));
  await p.evaluate(() => window.__call('add-status-board-system',
    { system: 'Colorless Core', id: 'JNN # 1', status: 'FMC' }));
  r = await p.evaluate(() => window.__call('add-status-board-system',
    { system: 'Firewall', id: 'JNN # 1', status: 'PMC', discrepancy: 'Allowing all traffic' }));
  ok('add-status-board-system adds', /2 systems/.test(r.text), r.text);
  r = await p.evaluate(() => window.__call('add-status-board-system',
    { system: 'STT', id: 'TRANSPORT', status: 'BROKEN' }));
  ok('a bad status is refused', r.isError && /FMC, PMC, NMC/.test(r.text), r.text);
  r = await p.evaluate(() => window.__call('get-status-board'));
  const bd = JSON.parse(r.text);
  ok('get-status-board reflects it', bd.unit === 'UNIT A' && bd.systems.length === 2, r.text.slice(0, 120));

  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }),
                                   p.evaluate(() => window.__call('build-status-board'))]);
  ok('build-status-board produces the .pptx', /\.pptx$/.test(dl2.suggestedFilename()), dl2.suggestedFilename());
  await dl2.saveAs(path.join(WORK, 'mcp-board.pptx'));

  r = await p.evaluate(() => window.__call('show-screen', { screen: 'status-board' }));
  await p.waitForSelector('#scBoard.show');
  ok('show-screen moves the app', await p.isVisible('#scBoard.show'), r.text);
  ok('the board screen shows the systems the tools added',
     (await p.$$('#bRows .brow')).length === 2);
  r = await p.evaluate(() => window.__call('show-screen', { screen: 'nowhere' }));
  ok('show-screen refuses an unknown screen', r.isError, r.text);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  console.log(fail ? '\n' + fail + ' FAILURE(S)' : '\nall green');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
