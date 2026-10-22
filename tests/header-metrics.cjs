'use strict';

// Focused checks for the responsive headline metrics; no browser or diary DB.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const summary={innerHTML:''},statsElement={innerHTML:''};
const app=vm.createContext({});
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8');
vm.runInContext(source,app);
app.document={getElementById:id=>id==='summary'?summary:statsElement};
let passed=0;
const check=(name,test)=>{test();passed++;console.log('PASS '+name);};
const event=(id,type,datetime,location='outside')=>({id,type,datetime,location,deletedAt:null});
const events=[
  event('w1','wee','2026-10-01T08:00','inside'),event('w2','wee','2026-10-03T08:00','inside'),
  event('w3','wee','2026-10-05T08:00','inside'),event('w4','wee','2026-10-07T08:00','inside'),
  event('p1','poo','2026-10-01T09:00'),event('p2','poo','2026-10-01T13:00'),
  event('p3','poo','2026-10-01T17:00'),event('p4','poo','2026-10-01T21:00'),
  event('latest-poo-accident','poo','2026-10-14T11:30','inside'),
  event('meal','meal','2026-10-14T07:00')
];
const render=now=>{app.fixture=events;app.clock=now;vm.runInContext('renderHeader(fixture,clock)',app);return summary.innerHTML;};
const metric=(html,description)=>{
  const element=[...html.matchAll(/<div class="metric([^\"]*)" aria-label="([^\"]*)">([\s\S]*?)<\/div>/g)].find(match=>match[3].includes(`<span class="metric-description">${description}</span>`));
  if (!element) return null;
  return [element[2],element[3].match(/<strong>([\s\S]*?)<\/strong>/)[1],element[3].match(/<span class="metric-median">([^<]*)<\/span>/)[1]];
};

check('mobile metric order and desktop meal metric are present',()=>{
  const html=render(new Date('2026-10-14T12:15:00'));
  const metrics=[...html.matchAll(/<div class="metric([^\"]*)" aria-label="[^"]*">([\s\S]*?)<\/div>/g)].map(match=>({className:match[1],description:match[2].match(/class="metric-description">([^<]+)/)?.[1]}));
  const mobile=metrics.filter(metric=>!metric.className.includes('desktop-only-metric')).map(metric=>metric.description).filter(Boolean);
  const desktop=metrics.filter(metric=>!metric.className.includes('mobile-only-metric')).map(metric=>metric.description).filter(Boolean);
  assert.deepEqual(mobile,['Since last wee','Since last poo','Since last accident']);
  assert.deepEqual(desktop,['Since last wee','Since last meal','Since last poo']);
  assert.match(css,/@media\(max-width:640px\)\{\.desktop-only-metric\{display:none\}\.mobile-only-metric\{display:block\}\}/);
});
check('latest active accident spans wee and poo accident events',()=>{
  let html=render(new Date('2026-10-14T12:15:00'));
  assert.equal(metric(html,'Since last accident')[2],'Wee median 2d 0h');
  events.push(event('latest-wee-accident','wee','2026-10-14T11:45','inside'));
  html=render(new Date('2026-10-14T12:15:00'));
  assert.equal(metric(html,'Since last accident')[2],'Wee median 2d 0h');
  assert.equal(metric(html,'Since last accident')[0].match(/Time since last accident: ([^.]+)/)[1],'30 minutes');
});
check('wee, poo and accident median copy uses the shared Stats statistics',()=>{
  const html=render(new Date('2026-10-14T12:15:00'));
  vm.runInContext('renderStats(fixture,new Date("2026-10-14T12:15:00"))',app);
  const shared=vm.runInContext('statistics(fixture,new Date("2026-10-14T12:15:00"))',app);
  assert.equal(metric(html,'Since last wee')[2],`Median ${vm.runInContext(`compactDuration(${shared.interval})`,app)}`);
  assert.equal(metric(html,'Since last poo')[2],`Median ${vm.runInContext(`compactDuration(${shared.pooInterval})`,app)}`);
  assert.equal(metric(html,'Since last accident')[2],`Wee median ${vm.runInContext(`compactDuration(${shared.weeAccidentGap})`,app)}`);
  assert.match(statsElement.innerHTML,/Median wee accident gap<\/span><strong>2d 0h/);
});
check('insufficient shared accident samples render a dash',()=>{
  app.fixture=events.slice(0,3);
  vm.runInContext('renderHeader(fixture,new Date("2026-10-14T12:15:00"))',app);
  assert.equal(metric(summary.innerHTML,'Since last accident')[2],'Wee median —');
});
check('existing minute refresh still calls the header once per minute and only redraws UI',()=>{
  assert.match(source,/setInterval\(\(\) => \{const now = new Date\(\), date = localDate\(now\); if \(date !== lastDate\) \{lastDate = date; render\(\);\} else \{renderHeader\(activeEvents\(\),now\);updateNowMarker\(now\);\}\},60000\)/);
  const before=JSON.stringify(events),first=render(new Date('2026-10-14T12:15:00'));
  const elapsed1=metric(first,'Since last accident')[1];
  const second=render(new Date('2026-10-14T12:16:00'));
  assert.equal(elapsed1,'30m');assert.equal(metric(second,'Since last accident')[1],'31m');
  assert.equal(JSON.stringify(events),before);
});

console.log(`${passed} focused header-metric checks passed.`);
