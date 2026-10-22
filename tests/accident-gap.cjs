'use strict';

// Focused, dependency-free checks of the production calculations and SVG output.
// No browser, diary database, authentication or network access is used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),app);
let passed=0;
const check=(name,test)=>{test();passed++;console.log('PASS '+name);};
const equal=(actual,expected)=>assert.equal(JSON.stringify(actual),JSON.stringify(expected));
const event=(id,datetime,type='wee',location='inside',extra={})=>({id,datetime,type,location,deletedAt:null,...extra});
const accidents=[event('a','2026-10-01T10:00'),event('b','2026-10-02T15:00'),event('c','2026-10-04T10:00'),event('d','2026-10-07T10:00')];
const observations=events=>app.timingObservations(events)['wee-accident'];

check('two indoor wees make one 29-hour gap',()=>equal(observations(accidents.slice(0,2)).map(item=>item.minutes),[1740]));
check('three accidents make consecutive gaps',()=>equal(observations(accidents.slice(0,3)).map(item=>[item.startEvent.id,item.endEvent.id]),[['a','b'],['b','c']]));
check('outside wees and poo accidents neither contribute nor break gaps',()=>equal(observations([...accidents,event('outside','2026-10-03T12:00','wee','outside'),event('poo','2026-10-03T13:00','poo')]).map(item=>item.minutes),[1740,2580,4320]));
check('demo and tombstoned events are excluded',()=>equal(observations([...accidents,event('demo','2026-10-03T12:00','wee','inside',{demo:true}),event('deleted','2026-10-05T12:00','wee','inside',{deletedAt:'2026-10-06T12:00:00Z'})]).map(item=>item.minutes),[1740,2580,4320]));
check('unordered input is chronological and zero/negative gaps are never emitted',()=>equal(observations([accidents[1],accidents[0],{...accidents[0],id:'duplicate'}]).map(item=>item.minutes),[1740]));
check('observation retains both events, completion and accident state',()=>{const item=observations(accidents)[0];assert.equal(item.metric,'wee-accident');assert.equal(item.completedAt,Date.parse(accidents[1].datetime));assert.equal(item.accident,true);assert.equal(item.startEvent.id,'a');assert.equal(item.endEvent.id,'b');});
check('numeric median uses the shared accident observations',()=>assert.equal(app.statistics(accidents).weeAccidentGap,2580));
check('fewer than three observations gives no numeric median',()=>assert.equal(app.statistics(accidents.slice(0,3)).weeAccidentGap,null));
check('seven calendar days qualify a sparse accident trend',()=>equal(app.trailingMedianObservations(observations(accidents),7).map(item=>item.median),[null,null,2580]));
check('ordinary trend still uses the inclusive preceding 72 hours',()=>{const result=app.trailingMedianObservations([{completedAt:0,minutes:10},{completedAt:86400000,minutes:20},{completedAt:259200000,minutes:900},{completedAt:259200001,minutes:40}]);equal(result.map(item=>item.median),[null,null,20,40]);});
check('calendar window includes its first date and excludes the preceding date',()=>{const items=['2026-10-01T23:59','2026-10-02T00:00','2026-10-03T12:00','2026-10-08T23:00'].map((time,index)=>({completedAt:Date.parse(time),minutes:[900,20,30,40][index]}));assert.equal(app.trailingMedianObservations(items,7)[3].median,30);});
check('conflict copies are not part of the active event store',()=>{app.fixture=accidents;vm.runInContext('store.events=fixture.slice(0,2);store.syncConflicts=[{cloudEvent:fixture[2]}];',app);assert.equal(vm.runInContext("timingObservations(activeEvents())['wee-accident'].length",app),1);});

const elements={'timing-chart-plot':{clientWidth:900,innerHTML:''},'timing-point-detail':{textContent:''},stats:{innerHTML:''}};
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const filters=[...html.matchAll(/data-chart-filter="([^"]+)"/g)].map(match=>({dataset:{chartFilter:match[1]},setAttribute(){}}));
app.document={getElementById:id=>elements[id],querySelectorAll:selector=>selector==='[data-chart-filter]'?filters:[],querySelector:()=>({clientWidth:900})};
const ordinary=[...['12:00','13:00','14:00','15:00'].map((time,index)=>event('w'+index,'2026-10-07T'+time,'wee','outside')),...['10:00','12:00','14:00','16:00'].map((time,index)=>event('p'+index,'2026-10-07T'+time,'poo','outside')),...['11:00','13:00','15:00'].map((time,index)=>event('m'+index,'2026-10-07T'+time,'meal','outside'))];
const mixed=[...accidents,...ordinary];
function render(events,filter='all',view='over-time',width=900){elements['timing-chart-plot'].clientWidth=width;app.fixture=events;app.filter=filter;app.view=view;vm.runInContext('timingMetricFilter=filter;timingView=view;renderTimingChart(fixture);',app);return elements['timing-chart-plot'].innerHTML;}
function points(svg){return [...svg.matchAll(/<g class="chart-point ([^"]+)" transform="translate\(([^ ]+) ([^)]+)\)"[^>]*data-metric="([^"]+)"/g)].map(match=>({metric:match[4],x:Number(match[2]),y:Number(match[3])}));}
const leftMax=svg=>Number(svg.match(/data-left-max="([^"]+)"/)[1]);
const mixedSVG=render(mixed);
check('All renders four metrics including accident gap',()=>equal([...new Set(points(mixedSVG).map(item=>item.metric))],['wee','poo','meal-poo','wee-accident']));
check('mixed view has a labelled secondary axis',()=>assert.ok(mixedSVG.includes('class="chart-accident-axis" aria-label="Right axis: Accident gap"')));
check('rendered accident trend qualifies on seven days while ordinary trends remain separate',()=>assert.equal((mixedSVG.match(/class="chart-trend-point chart-series-wee-accident"/g)||[]).length,1));
check('accident point heights use their independent scale in mixed and single-series views',()=>{const expected=24+348*(1-1740/(4320*1.1));assert.ok(Math.abs(points(mixedSVG).find(item=>item.metric==='wee-accident').y-expected)<.001);assert.ok(Math.abs(points(render(mixed,'wee-accident'))[0].y-expected)<.001);});
check('long accident gaps do not inflate the ordinary left scale',()=>{assert.equal(leftMax(mixedSVG),leftMax(render(ordinary)));assert.equal(leftMax(render([...mixed,event('long','2026-09-01T10:00')])),leftMax(mixedSVG));});
check('all accident points fit within vertical plot bounds',()=>assert.ok(points(render([...mixed,event('long','2026-09-01T10:00')])).every(item=>item.y>=24&&item.y<=372)));
check('Accidents filter selects only the new series with a single left axis',()=>{const svg=render(mixed,'wee-accident');assert.ok(!svg.includes('class="chart-accident-axis"'));assert.equal(points(svg).length,3);assert.ok(points(svg).every(item=>item.metric==='wee-accident'));assert.ok(leftMax(svg)>4320);assert.ok(filters.some(button=>button.dataset.chartFilter==='wee-accident'));});
check('accident marker contains ! and does not add an ordinary accident badge',()=>{const svg=render(mixed,'wee-accident');assert.ok(svg.includes('class="chart-accident-symbol"'));assert.ok(!svg.includes('class="chart-accident-cue"'));});
check('ordinary accident badges survive alongside the new metric',()=>{const endedInside=[event('start','2026-10-07T09:00','wee','outside'),...mixed,event('extra-meal','2026-10-07T16:10','meal','outside'),event('poo-inside','2026-10-07T16:15','poo')];const svg=render(endedInside);assert.equal((svg.match(/class="chart-accident-cue"/g)||[]).length,3);assert.ok(svg.includes('Ended in inside accident'));});
check('accident details name both dated accidents',()=>{const text=app.chartPointLabel(observations(accidents)[0]);assert.ok(text.includes('Wee accident gap'));assert.ok(text.includes('Thu 1 Oct 10:00'));assert.ok(text.includes('Fri 2 Oct 15:00'));});
check('median duration label and accessible description use accident scale',()=>{const svg=render(mixed);assert.ok(svg.includes('Wee accident gap median: 1 day 19 hours'));assert.ok(svg.includes('>1d 19h</text>'));app.renderStats(mixed);assert.ok(elements.stats.innerHTML.includes('<span>Median wee accident gap</span><strong>1d 19h</strong>'));});
check('Ordered mixed view normalizes every series independently and keeps right axis',()=>{const svg=render(mixed,'all','ordered'),plotStart=76,plotEnd=900-76;assert.ok(svg.includes('class="chart-accident-axis"'));for(const metric of ['wee','poo','meal-poo','wee-accident']){const xs=points(svg).filter(item=>item.metric===metric).map(item=>item.x);assert.equal(Math.min(...xs),plotStart);assert.equal(Math.max(...xs),plotEnd);}});
check('Ordered accident-only view has one axis, reference and duration label',()=>{const svg=render(mixed,'wee-accident','ordered');assert.ok(!svg.includes('class="chart-accident-axis"'));assert.ok(svg.includes('class="chart-reference chart-series-wee-accident"'));assert.ok(svg.includes('class="chart-iqr-band"'));assert.ok(svg.includes('>1d 19h</text>'));});
check('one accident observation is at 50% with no statistical references',()=>{const svg=render(accidents.slice(0,2),'wee-accident','ordered');assert.equal(points(svg)[0].x,(76+900-22)/2);assert.ok(!svg.includes('chart-reference'));assert.ok(!svg.includes('chart-median-label'));assert.ok(!svg.includes('chart-iqr-band'));});
check('two accident observations span 0–100% without median decoration',()=>{const svg=render(accidents.slice(0,3),'wee-accident','ordered');equal(points(svg).map(item=>item.x),[76,878]);assert.ok(!svg.includes('chart-reference'));assert.ok(!svg.includes('chart-median-label'));});
check('narrow chart reduces tick density while retaining every point and both scales',()=>{for(const view of ['over-time','ordered']){const svg=render(mixed,'all',view,320);assert.equal(points(svg).length,12);assert.ok(svg.includes('viewBox="0 0 320 430"'));assert.ok(points(svg).every(item=>item.x>=54&&item.x<=258));assert.ok(svg.includes('translate(315 198) rotate(-90)'));}});
check('four near-bottom median labels remain separated and in bounds',()=>{app.labels=['wee','poo','meal-poo','wee-accident'].map(metric=>({metric,y:361}));const ys=[...vm.runInContext('resolveMedianLabelPositions(labels,34,362).values()',app)].map(item=>item.labelY);assert.ok(ys.every((value,index)=>value>=34&&value<=362&&(!index||value-ys[index-1]>=20)));});
check('ordinary observation durations and numeric medians remain unchanged',()=>{const before=app.timingObservations(ordinary),after=app.timingObservations(mixed);for(const metric of ['wee','poo','meal-poo'])equal(after[metric].map(item=>item.minutes),before[metric].map(item=>item.minutes));assert.equal(app.statistics(mixed).interval,60);assert.equal(app.statistics(mixed).pooInterval,120);assert.equal(app.statistics(mixed).mealPoo,60);});
console.log(`${passed} focused accident-gap checks passed.`);
