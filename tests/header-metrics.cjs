'use strict';

// Focused checks for the responsive headline metrics; no browser or diary DB.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const summary={innerHTML:''},statsElement={innerHTML:''},weightPlot={innerHTML:'',clientWidth:640},weightDetail={textContent:''};
const timingPanel={hidden:false},weightPanel={hidden:true},chartTabs=[{dataset:{statsChart:'timing'},attrs:{},setAttribute(key,value){this.attrs[key]=value;}},{dataset:{statsChart:'weight'},attrs:{},setAttribute(key,value){this.attrs[key]=value;}}];
const app=vm.createContext({});
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
vm.runInContext(source,app);
app.document={getElementById:id=>({summary,stats:statsElement,'weight-chart-plot':weightPlot,'weight-point-detail':weightDetail,'timing-chart-panel':timingPanel,'weight-chart-panel':weightPanel})[id]||{innerHTML:'',textContent:''},querySelectorAll:()=>chartTabs};
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
const render=(now,items=events)=>{app.fixture=items;app.clock=now;vm.runInContext('renderHeader(fixture,clock)',app);return summary.innerHTML;};
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
  assert.equal(metric(html,'Since last accident')[2],'0.3 / 24h');
  events.push(event('latest-wee-accident','wee','2026-10-14T11:45','inside'));
  html=render(new Date('2026-10-14T12:15:00'));
  assert.equal(metric(html,'Since last accident')[2],'0.7 / 24h');
  assert.equal(metric(html,'Since last accident')[0].match(/Time since last accident: ([^.]+)/)[1],'30 minutes');
});
check('shared rolling accident rate feeds headline and Stats while median gap remains in Stats only',()=>{
  const html=render(new Date('2026-10-14T12:15:00'));
  vm.runInContext('renderStats(fixture,new Date("2026-10-14T12:15:00"))',app);
  const shared=vm.runInContext('statistics(fixture,new Date("2026-10-14T12:15:00"))',app);
  assert.equal(metric(html,'Since last wee')[2],`Median ${vm.runInContext(`compactDuration(${shared.interval})`,app)}`);
  assert.equal(metric(html,'Since last poo')[2],`Median ${vm.runInContext(`compactDuration(${shared.pooInterval})`,app)}`);
  assert.equal(metric(html,'Since last accident')[2],`${shared.accidentRate72h.toFixed(1)} / 24h`);
  assert.match(metric(html,'Since last accident')[0],/Recent accident rate: 0\.7 accidents per 24 hours over the last 72 hours/);
  assert.doesNotMatch(metric(html,'Since last accident')[2],/median/i);
  assert.match(statsElement.innerHTML,/Accidents \/ 24h \(last 72h\)<\/span><strong>0\.7/);
  assert.match(statsElement.innerHTML,/Accidents \/ 24h \(last 7d\)<\/span><strong>0\.3/);
  assert.match(statsElement.innerHTML,/Median wee accident gap<\/span><strong>2d 0h/);
});
check('rolling accident rate uses the full window, inclusive boundary and active real accidents only',()=>{
  const now=new Date('2026-10-14T12:15:00'),at=(id,type,offsetHours,location='inside',extra={})=>{const time=vm.runInContext(`localDatetime(new Date(${now.getTime()-offsetHours*3600000}))`,app);return {...event(id,type,time,location),...extra};};
  const rate=items=>vm.runInContext(`accidentRate(${JSON.stringify(items)},new Date("2026-10-14T12:15:00"),72)`,app);
  const asDaily=value=>Number(value.toFixed(1));
  assert.equal(asDaily(rate([])),0.0);
  assert.equal(asDaily(rate([at('one','wee',1)])),0.3);
  assert.equal(asDaily(rate([at('two-a','wee',1),at('two-b','poo',2)])),0.7);
  assert.equal(asDaily(rate([at('three-a','wee',1),at('three-b','poo',2),at('three-c','wee',3)])),1.0);
  assert.equal(asDaily(rate([at('inside-boundary','poo',72)])),0.3);
  assert.equal(asDaily(rate([at('too-old','wee',72.01)])),0.0);
  assert.equal(asDaily(rate([at('future','poo',-1)])),0.0);
  assert.equal(asDaily(rate([at('outside','wee',1,'outside')])),0.0);
  assert.equal(asDaily(rate([at('deleted','poo',1,'inside',{deletedAt:'2026-10-14T12:10:00.000Z'})])),0.0);
  assert.equal(asDaily(rate([at('demo','wee',1,'inside',{demo:true})])),0.0);
  assert.equal(asDaily(rate([at('recent','poo',1)])),0.3,'a short diary history still uses the full 72-hour denominator');
  const weekly=vm.runInContext(`statistics(${JSON.stringify([at('weekly-1','wee',1),at('weekly-2','poo',72)] )},new Date("2026-10-14T12:15:00")).accidentRate7d`,app);
  assert.equal(asDaily(weekly),0.3);
});
check('After a meal is removed and Weight stats show latest value and date-adjusted growth rate',()=>{
  app.fixture=events.filter(event=>event.type!=='weight').concat([
    {id:'weight-previous',type:'weight',datetime:'2026-10-12T09:30',weightKg:7.2,deletedAt:null},
    {id:'weight-latest',type:'weight',datetime:'2026-10-14T09:30',weightKg:7.45,deletedAt:null}
  ]);
  vm.runInContext('renderStats(fixture,new Date("2026-10-14T12:15:00"))',app);
  assert.match(statsElement.innerHTML,/<h3>Weight<\/h3>/);
  assert.match(statsElement.innerHTML,/Latest weight<\/span><strong>7\.45 kg/);
  assert.match(statsElement.innerHTML,/Average growth rate<\/span><strong>\+0\.88 kg\/week/);
  assert.doesNotMatch(statsElement.innerHTML,/After a meal|Median time to wee|Median time to poo/);
  assert.doesNotMatch(statsElement.innerHTML,/Previous weight|Last weighed/);
});
check('weight chart uses whole-kilogram y-axis labels',()=>{
  vm.runInContext('renderWeightChart([{id:"a",datetime:"2026-10-14T09:30",weightKg:5.78},{id:"b",datetime:"2026-10-19T09:30",weightKg:6.98},{id:"c",datetime:"2026-10-25T09:30",weightKg:8.02}])',app);
  const labels=[...weightPlot.innerHTML.matchAll(/class="weight-axis-label"[^>]*>([^<]+)</g)].map(match=>match[1]);
  assert.deepEqual(labels,['5','7','9','14 Oct','19 Oct','25 Oct']);
  assert.ok(labels.slice(0,3).every(label=>Number.isInteger(Number(label))));
});
check('Weight is an accessible alternate chart tab beside Timing observations',()=>{
  assert.match(html,/<div id="stats-chart-tabs"[^>]*role="tablist"[^>]*aria-label="Statistics chart"/);
  assert.match(html,/<button id="weight-chart-tab"[^>]*role="tab"[^>]*aria-controls="weight-chart-panel"/);
  assert.match(html,/<div id="weight-chart-panel"[^>]*role="tabpanel"[^>]*aria-labelledby="weight-chart-tab"[^>]*hidden/);
  vm.runInContext('statsChartMode="weight";renderStatsChartMode()',app);
  assert.equal(timingPanel.hidden,true);assert.equal(weightPanel.hidden,false);
  assert.equal(chartTabs[0].attrs['aria-selected'],'false');assert.equal(chartTabs[1].attrs['aria-selected'],'true');
  vm.runInContext('statsChartMode="timing";renderStatsChartMode()',app);
  assert.equal(timingPanel.hidden,false);assert.equal(weightPanel.hidden,true);
});
check('no recent accidents show zero and the mobile metric no longer displays an accident-gap median',()=>{
  app.fixture=events.slice(0,3);
  vm.runInContext('renderHeader(fixture,new Date("2026-10-14T12:15:00"))',app);
  assert.equal(metric(summary.innerHTML,'Since last accident')[2],'0.0 / 24h');
  assert.doesNotMatch(metric(summary.innerHTML,'Since last accident')[2],/median/i);
});
check('existing minute refresh updates elapsed time and rolling rate without changing events',()=>{
  assert.match(source,/setInterval\(\(\) => \{const now = new Date\(\), date = localDate\(now\); if \(date !== lastDate\) \{lastDate = date; render\(now\);\} else \{const events=activeEvents\(\);renderHeader\(events,now\);if\(activePage==='stats'\)\{renderStats\(events,now\);renderTimingChart\(events,now\);\}updateNowMarker\(now\);\}\},60000\)/);
  const boundary=event('ages-out','wee','2026-10-11T12:15','inside'),before=JSON.stringify([boundary]);
  const first=render(new Date('2026-10-14T12:15:00'),[boundary]);
  const elapsed1=metric(first,'Since last accident')[1];
  const second=render(new Date('2026-10-14T12:16:00'),[boundary]);
  assert.equal(elapsed1,'3d 0h');assert.equal(metric(first,'Since last accident')[2],'0.3 / 24h');
  assert.equal(metric(second,'Since last accident')[2],'0.0 / 24h');
  assert.equal(JSON.stringify([boundary]),before);
});

console.log(`${passed} focused header-metric checks passed.`);
