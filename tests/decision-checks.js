'use strict';

async function decisionSupportChecks() {
  await reset();
  const fixedClock = `window.__testNow=Date.parse('2026-10-14T12:15:00');const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(window.__testNow)}static now(){return window.__testNow}static parse(...args){return NativeDate.parse(...args)}static UTC(...args){return NativeDate.UTC(...args)}};window.__minuteTick=null;const nativeInterval=window.setInterval;window.setInterval=(callback,delay,...args)=>delay===60000?(window.__minuteTick=()=>callback(...args),0):nativeInterval(callback,delay,...args);window.__saveEvents=0;window.addEventListener('bella-local-save',()=>window.__saveEvents++);`;
  const frame = await start(fixedClock);
  const win = frame.contentWindow;
  const fixture = [
    ['wee','08:00'],['wee','09:00'],['wee','11:00'],['wee','12:00'],
    ['poo','06:00'],['poo','08:00'],['poo','10:30'],['poo','12:00'],
    ['meal','07:00'],['meal','09:30'],['meal','11:00']
  ].map(([type,time],index)=>({id:`decision-${index}`,type,datetime:`2026-10-14T${time}`,deletedAt:null,location:'outside'}));
  const stats=win.eval(`statistics(${JSON.stringify(fixture)})`);
  check(stats.interval===90 && stats.pooInterval===120 && stats.mealPoo===60,'P: wee median, meal-to-poo median and poo interval use unchanged rules and three qualifying examples');
  check(win.eval(`compactDuration(8)==='8m'&&compactDuration(47)==='47m'&&compactDuration(65)==='1h 05m'&&compactDuration(222)==='3h 42m'&&compactDuration(1560)==='1d 2h'&&compactDuration(null)==='—'`),'P: compact elapsed formatter covers minutes, hours, days and missing values');
  const tombstone={...fixture.find(event=>event.type==='wee'&&event.datetime.endsWith('11:00')),id:'deleted-latest',datetime:'2026-10-14T12:10',deletedAt:'2026-10-14T12:11:00.000Z'};
  const demo={...fixture.find(event=>event.type==='meal'),id:'diagnostic-demo',datetime:'2026-10-14T13:00',demo:true};
  const observations=win.eval(`timingObservations(${JSON.stringify([...fixture,tombstone,demo])})`);
  check(observations.wee.length===3&&observations.poo.length===3&&observations['meal-poo'].length===3&&![...observations.wee,...observations.poo,...observations['meal-poo']].some(item=>item.startEvent.id==='deleted-latest'||item.endEvent.id==='diagnostic-demo'),'P: shared chart observations use qualified active events and exclude tombstones/demo rows');
  win.eval(`timingMetricFilter='all';timingView='over-time';renderTimingChart(${JSON.stringify([...fixture,tombstone,demo])});`);
  const chart=frame.contentDocument.getElementById('timing-chart-plot');
  const weeXs=[...chart.querySelectorAll('.chart-point[data-metric="wee"]')].map(point=>Number(point.transform.baseVal.consolidate().matrix.e)),pooPoints=[...chart.querySelectorAll('.chart-point[data-metric="poo"]')],pooXs=pooPoints.map(point=>Number(point.transform.baseVal.consolidate().matrix.e)),plotAxis=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2'));
  check(chart.querySelectorAll('.chart-point').length===9&&chart.querySelectorAll('.chart-trend-point').length===3&&weeXs.every((x,index)=>!index||x>weeXs[index-1])&&pooXs.every((x,index)=>!index||x>pooXs[index-1])&&pooPoints.every(point=>win.getComputedStyle(point).transform==='none'&&Number(point.transform.baseVal.consolidate().matrix.e)>=Number(plotAxis.getAttribute('x1'))&&Number(point.transform.baseVal.consolidate().matrix.e)<=Number(plotAxis.getAttribute('x2'))),'P: all series overlay at chronological positions, poo markers stay within the plot, and qualified 3-day median marks render');
  frame.contentDocument.querySelector('[data-chart-filter="poo"]').click();
  check(chart.querySelectorAll('.chart-point').length===3&&[...chart.querySelectorAll('.chart-point')].every(point=>point.dataset.metric==='poo')&&frame.contentDocument.querySelector('[data-chart-filter="poo"]').getAttribute('aria-pressed')==='true','P: chart filters independently select the requested series');
  const trendWindow=win.eval(`trailingMedianObservations([{completedAt:0,minutes:10},{completedAt:86400000,minutes:20},{completedAt:259200000,minutes:900},{completedAt:259200001,minutes:40}])`);
  check(trendWindow[2].median===20&&trendWindow[3].median===null&&win.eval(`median([10,20,30,40,50])===30`),'P: trailing medians use the inclusive 72-hour window, require three points, and calculate the series median');
  const beforeChart=JSON.stringify(state(frame));
  frame.contentDocument.querySelector('[data-chart-filter="all"]').click();frame.contentDocument.querySelector('[data-chart-view="ordered"]').click();
  const svg=chart.querySelector('svg'),axis=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2')),startX=Number(axis.getAttribute('x1')),endX=Number(axis.getAttribute('x2'));
  const orderedSpans=['wee','poo','meal-poo'].every(metric=>{const xs=[...chart.querySelectorAll(`.chart-point[data-metric="${metric}"]`)].map(point=>Number(point.transform.baseVal.consolidate().matrix.e));return xs.length===3&&Math.min(...xs)===startX&&Math.max(...xs)===endX;});
  const band=chart.querySelector('.chart-iqr-band'),iqrAxisRange=Math.abs(Number(band.getAttribute('x'))-(startX+(endX-startX)*.25))<.1&&Math.abs(Number(band.getAttribute('width'))-(endX-startX)*.5)<.1&&Math.abs(Number(band.getAttribute('y'))-24)<.1&&Number(band.getAttribute('height'))>0;
  const orderedLines=[...chart.querySelectorAll('.chart-ordered')];
  const orderedButton=frame.contentDocument.querySelector('[data-chart-view="ordered"]'),orderedSelected=orderedButton.getAttribute('aria-pressed')==='true'&&win.getComputedStyle(orderedButton).boxShadow!=='none';
  frame.contentDocument.querySelector('[data-chart-filter="wee"]').click();const oneGap=[{id:'one-a',type:'wee',datetime:'2026-10-14T08:00',deletedAt:null},{id:'one-b',type:'wee',datetime:'2026-10-14T09:00',deletedAt:null}];
  win.eval(`timingView='ordered';renderTimingChart(${JSON.stringify(oneGap)});`);
  const onePoint=chart.querySelector('.chart-point'),axisLine=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2')),pointX=Number(onePoint.transform.baseVal.consolidate().matrix.e),axisMid=(Number(axisLine.getAttribute('x1'))+Number(axisLine.getAttribute('x2')))/2;
  check(orderedSpans&&orderedLines.length===3&&orderedLines.every(line=>(line.getAttribute('d').match(/L/g)||[]).length===2)&&iqrAxisRange&&orderedSelected&&chart.querySelectorAll('.chart-iqr-band').length===1&&chart.querySelectorAll('.chart-ordered').length===0&&Math.abs(pointX-axisMid)<.01&&win.eval('percentileRank(0,1)===50&&percentileRank(0,4)===0&&percentileRank(3,4)===100')&&JSON.stringify(state(frame))===beforeChart,'P: Ordered view joins series, selects its mode, spans 0–100%, shades the 25–75% x range and leaves data unchanged');
  const crossDay=[...fixture,{...fixture[0],id:'yesterday',datetime:'2026-10-13T08:00'}];
  check(win.eval(`currentTimePercent(new Date('2026-10-14T00:00'))===0&&currentTimePercent(new Date('2026-10-14T12:00'))===50&&Math.abs(currentTimePercent(new Date('2026-10-14T23:00'))-95.8333333333)<.001`),'P: Now marker uses the same 24-hour geometry at midnight, noon and late evening');
  win.eval(`renderTimeline(${JSON.stringify(crossDay)},${JSON.stringify(crossDay)},new Date('2026-10-14T12:00'));`);
  check(frame.contentDocument.querySelectorAll('#timeline .timeline-now').length===2&&[...frame.contentDocument.querySelectorAll('#timeline .timeline-now')].every(line=>line.parentElement.classList.contains('plot'))&&frame.contentDocument.getElementById('timeline').getAttribute('aria-label').includes('12:00'),'P: Now segments align in every visible plot only, with one accessible current-time label');
  win.eval(`store.events=${JSON.stringify([...fixture,tombstone])};renderHeader(activeEvents(),new Date('2026-10-14T12:15:00'));`);
  const header=frame.contentDocument.getElementById('summary'), decision=header.querySelectorAll('.metric');
  check(decision.length===5 && !header.textContent.includes("Today's wees") && !header.textContent.includes("Today's poos") && !header.textContent.includes("Today's meals") && decision[1].querySelector('strong').textContent==='15m','P: header has the five requested metrics, uses latest active wee and ignores tombstones');
  check(decision[2].querySelector('strong').textContent==='1h 15m' && decision[3].querySelector('strong').textContent==='15m' && decision[1].getAttribute('aria-label').includes('15 minutes') && decision[3].textContent.includes('Median 2h 00m'),'P: latest meal/poo values, median details and accessible descriptions render correctly');
  win.eval(`renderHeader(${JSON.stringify([...fixture,{...fixture[0],id:'future',datetime:'2026-10-14T13:00'}])},new Date('2026-10-14T12:15:00'));`);
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='—','P: future-dated latest event displays a safe placeholder');
  win.eval(`renderHeader([],new Date('2026-10-14T12:15:00'));renderStats([]);`);
  check([...frame.contentDocument.querySelectorAll('#summary .decision-metric')].every(metric=>metric.querySelector('strong').textContent==='—'&&metric.textContent.toLowerCase().includes('median —')) && frame.contentDocument.getElementById('stats').textContent.includes('Median poo interval—'),'P: missing events and insufficient samples show dashes in the header and Stats timing section');
  const instant='2026-10-14T11:00:00.000Z', event={id:'timer-wee',type:'wee',datetime:'2026-10-14T11:00',location:'outside',note:'',createdAt:instant,updatedAt:instant,deletedAt:null,mutationId:'timer-mutation',serverVersion:null,syncBaseMutationId:null};
  await importBackup(frame,{version:2,demoCleared:true,events:[event]});
  const before=await databaseContents(), beforeWrites=win.__saveEvents;
  const initialNow=frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left;
  win.__testNow=Date.parse('2026-10-14T12:00:00');win.__minuteTick();
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='1h 00m'&&frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left==='50%','P: existing minute timer refreshes elapsed metrics and moves the Now line');
  win.__testNow=Date.parse('2026-10-14T13:00:00');win.__minuteTick();
  check(initialNow!=='50%'&&frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left.startsWith('54.16')&&frame.contentDocument.querySelectorAll('#timeline .timeline-now').length===1&&frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='2h 00m'&&same(await databaseContents(),before)&&win.__saveEvents===beforeWrites,'P: minute refresh moves the marker across rows and updates UI only, without storage writes or sync triggers');
  frame.remove();
}
