/* Either upload button takes either kind of file: a .docx report, or a mission .json
 * saved here. Whatever is already written under each day has to land in the boxes.
 *
 *   WORK=/tmp/trip node tools/either-file-test.js
 */
const { chromium, devices } = require('playwright');
const path=require('path'), os=require('os'), fs=require('fs');
const WORK=process.env.WORK||path.join(os.tmpdir(),'trip');
const BASE=process.env.BASE||'http://127.0.0.1:8777';
const REAL=path.join(WORK,'trip_report.docx');   // the generated fixture
let fail=0; const ok=(n,c,x)=>{console.log((c?'PASS  ':'FAIL  ')+n+(c?'':'  :: '+x)); if(!c)fail++;};
(async()=>{
const b=await chromium.launch(process.env.CHROME?{executablePath:process.env.CHROME}:{});
const errs=[];
async function fresh(){const c=await b.newContext({...devices['iPhone 13'],acceptDownloads:true});
  const p=await c.newPage(); p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(BASE+'/index.html'); await p.waitForSelector('#scHome.show'); return p;}

// --- a real report through Upload Mission ---
let p=await fresh();
await p.setInputFiles('#restorePick', REAL);
await p.waitForSelector('#scWho.show',{timeout:10000});
ok('Upload Mission accepts a .docx report', await p.isVisible('#scWho.show'));
await p.click('#whoList .btn:nth-child(1)');
await p.waitForSelector('#scDay.show');
ok('existing first-day notes land in the box',
   (await p.inputValue('#ta')).includes('motor pool'), await p.inputValue('#ta'));
const n = await p.$$eval('#strip .day', e=>e.length);
await p.click('#strip .day:nth-child(2)');
ok('existing notes on a later day land in the box',
   (await p.inputValue('#ta')).includes('routers'), await p.inputValue('#ta'));
const cls = await p.$$eval('#strip .day', e=>e.map(x=>x.className.replace('day ','').replace(' cur','').trim()));
ok('untouched days marked as pre-existing, not as mine',
   cls[0].includes('pre') && !cls[0].includes('mine'), JSON.stringify(cls));

// --- a mission .json through Upload Template ---
await p.fill('#ta','Edited on the last day.');
await p.waitForFunction(()=>document.getElementById('savedAt').textContent==='kept');
const [bk]=await Promise.all([p.waitForEvent('download',{timeout:15000}), p.click('#backupBtn')]);
const j=path.join(WORK,'either.json'); await bk.saveAs(j);
const p2=await fresh();
await p2.setInputFiles('#pick', j);
await p2.waitForSelector('#tplMsg .msg.good, #scDay.show',{timeout:10000});
const msg=await p2.textContent('#tplMsg');
ok('Upload Template accepts a mission .json', /Notes loaded/.test(msg)||await p2.isVisible('#scDay.show'), msg);

// --- created mission .json still opens straight up ---
const p3=await fresh();
await p3.click('#newMissionBtn'); await p3.waitForSelector('#scNew.show');
ok('Create Mission screen has no lede', (await p3.$$('#scNew .lede')).length===0);
ok('mission location has no placeholder', (await p3.getAttribute('#fMissionLoc','placeholder'))===null,
   String(await p3.getAttribute('#fMissionLoc','placeholder')));
await p3.fill('#fName','Test Person'); await p3.selectOption('#fRole','Network SME');
await p3.fill('#fMissionLoc','Somewhere'); await p3.fill('#fStart','2026-05-01'); await p3.fill('#fEnd','2026-05-03');
await p3.click('#newSubmit'); await p3.waitForSelector('#scDay.show');
const [bk2]=await Promise.all([p3.waitForEvent('download',{timeout:15000}), p3.click('#backupBtn')]);
const j2=path.join(WORK,'created.json'); await bk2.saveAs(j2);
const p4=await fresh();
await p4.setInputFiles('#restorePick', j2);
await p4.waitForSelector('#scDay.show',{timeout:10000});
ok('created mission .json reopens with no .docx', (await p4.textContent('#ctxName'))==='Test Person');

// --- junk file ---
const junk=path.join(WORK,'junk.txt'); fs.writeFileSync(junk,'not a report at all');
const p5=await fresh();
await p5.setInputFiles('#restorePick', junk);
await p5.waitForSelector('#tplMsg .msg.bad',{timeout:10000});
ok('junk file is refused, not swallowed', (await p5.textContent('#tplMsg')).includes('Could not read'));

ok('no page errors', errs.length===0, errs.join(' | '));
await b.close();
console.log(fail?'\n'+fail+' FAILURE(S)':'\nall green');
process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
