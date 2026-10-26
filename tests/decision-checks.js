'use strict';

async function decisionSupportChecks() {
  await reset();
  const fixedClock = `window.__testNow=Date.parse('2026-10-14T12:15:00');const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(window.__testNow)}static now(){return window.__testNow}static parse(...args){return NativeDate.parse(...args)}static UTC(...args){return NativeDate.UTC(...args)}};window.__minuteTick=null;const nativeInterval=window.setInterval;window.setInterval=(callback,delay,...args)=>delay===60000?(window.__minuteTick=()=>callback(...args),0):nativeInterval(callback,delay,...args);window.__saveEvents=0;window.addEventListener('bella-local-save',()=>window.__saveEvents++);`;
  const frame = await start(fixedClock);
  const win = frame.contentWindow;
  const adaptiveBins=win.eval(`(()=>{activeWindow='all';hasBinSizePreference=false;const results=[];for(const days of [5,6,8,9]){const events=Array.from({length:days},(_,index)=>({type:'wee',datetime:'2026-10-'+String(14-index).padStart(2,'0')+'T08:00'}));renderAggregate(events,new Date('2026-10-14T12:15'));results.push([days,activeBinSize,document.querySelectorAll('#aggregate .hour-bucket').length]);}return results;})()`);
  check(JSON.stringify(adaptiveBins)==='[[5,120,48],[6,90,64],[8,90,64],[9,60,96]]'&&localStorage.getItem('bellaDiary.aggregateBinSize')===null,'P: automatic bucket defaults adapt to tracked days in the selected window without saving an automatic choice');
  const accidentFixture = [
    ['wee','2026-10-12T18:10','inside'],['poo','2026-10-12T18:45','inside'],['wee','2026-10-12T19:30','inside'],
    ['poo','2026-10-13T19:10','inside'],['wee','2026-10-14T20:30','inside'],['poo','2026-10-14T20:45','inside'],
    ['wee','2026-10-11T18:20','outside'],['poo','2026-10-11T19:00','outside'],['wee','2026-10-01T18:30','inside'],
    ['wee','2026-10-14T18:00','inside','2026-10-14T18:01:00.000Z'],['meal','2026-10-13T18:15','']
  ].map(([type,datetime,location,deletedAt],index)=>({id:`aggregate-${index}`,type,datetime,location,deletedAt:deletedAt||null}));
  const accidentResults=win.eval(`(()=>{store.events=${JSON.stringify(accidentFixture)};const active=activeEvents();const dayCount=new Set(active.map(dateOf)).size;const accidents=bucketDistribution(active,'accidents',dayCount,120,{distinctDays:true});const wees=bucketDistribution(active,'wee',dayCount,120);return {accident:accidents[9],later:accidents[10],wee:wees[9],days:dayCount};})()`);
  check(accidentResults.days===5&&accidentResults.accident.count===5&&accidentResults.accident.days===3&&accidentResults.accident.total===7&&accidentResults.accident.strength===1&&accidentResults.later.count===2&&accidentResults.later.days===1&&Math.abs(accidentResults.later.strength-1/3)<1e-9,'P: accident bins count distinct active inside-event days for shading while retaining raw counts; outside events, tombstones and meals do not contribute');
  check(accidentResults.wee.count===4&&accidentResults.wee.strength===1,'P: ordinary wee bucket count and shading remain raw-event based');
  const accidentRows=win.eval(`(()=>{const active=activeEvents();const result=[];for(const size of [30,60,90,120]){activeBinSize=size;hasBinSizePreference=true;activeWindow='7';renderAggregate(active,new Date('2026-10-14T12:15'));const row=document.querySelector('#aggregate .accident-buckets');const index=Math.floor(18*60/size);result.push([size,document.querySelectorAll('#aggregate .aggregate-row').length,row.querySelectorAll('.hour-bucket').length,row.querySelectorAll('.aggregate-now').length,row.querySelectorAll('.hour-bucket')[index].getAttribute('aria-label')]);}return result;})()`);
  check(accidentRows.length===4&&accidentRows.every(([size,rows,buckets,now,label])=>rows===4&&buckets===1440/size&&now===1&&label.startsWith('Accidents, ')&&label.includes('of 4 diary days')&&label.includes('recorded accident'))&&accidentRows.find(([size])=>size===120)[4].includes('Seen on 2 of 4 diary days; 4 recorded accidents'),'P: Accidents row uses every supported bin size, accessible raw-count/day detail, and the shared Now marker');
  const dayWindowLabel=win.eval(`(()=>{activeWindow='7';activeBinSize=120;renderAggregate(activeEvents(),new Date('2026-10-14T12:15'));return document.querySelectorAll('#aggregate .accident-buckets .hour-bucket')[9].getAttribute('aria-label');})()`);
  check(dayWindowLabel.includes('the last 7 days')&&dayWindowLabel.includes('2 of 4 diary days')&&dayWindowLabel.includes('4 recorded accidents'),'P: accident aggregation and diary-day denominator respect the selected window');
  win.eval(`activeWindow='14';hasBinSizePreference=false;renderAggregate([],new Date('2026-10-14T12:15'));`);
  const fixture = [
    ['wee','08:00'],['wee','09:00'],['wee','11:00'],['wee','12:00'],
    ['poo','06:00'],['poo','08:00'],['poo','10:30'],['poo','12:00'],
    ['meal','07:00'],['meal','09:30'],['meal','11:00']
  ].map(([type,time],index)=>({id:`decision-${index}`,type,datetime:`2026-10-14T${time}`,deletedAt:null,location:'outside'}));
  const stats=win.eval(`statistics(${JSON.stringify(fixture)})`);
  check(stats.interval===60 && stats.pooInterval===120 && stats.mealPoo===60,'P: wee median, meal-to-poo median and poo interval use unchanged rules and three qualifying examples');
  const rateEvents=fixture.map((event,index)=>({...event,location:[0,4,5,8].includes(index)?'inside':'outside'}));
  win.eval(`renderStats(${JSON.stringify(rateEvents)},new Date('2026-10-14T12:15'));`);
  const frequencyText=frame.contentDocument.querySelector('#stats>div').textContent;
  check(frequencyText.includes('Wee accidents (7 days)25%')&&frequencyText.includes('Poo accidents (7 days)50%')&&win.eval(`statistics(${JSON.stringify(fixture)},new Date('2026-10-14T12:15')).accidentPercent('wee')==='0%'&&statistics([]).accidentPercent('poo')==='—'&&statistics([${JSON.stringify(rateEvents[0])}],new Date('2026-10-14T12:15')).accidentPercent('wee')==='100%'`),'P: Frequency shows per-type 7-day accident percentages, excludes meals from denominators, and handles zero, all and missing accidents');
  const rollingRates=[['wee','inside','2026-10-07T12:15'],['wee','outside','2026-10-08T12:15'],['wee','outside','2026-10-07T12:14'],['wee','inside','2026-10-14T12:16'],['poo','inside','2026-10-01T12:15']].map(([type,location,datetime])=>({type,location,datetime,deletedAt:null}));
  check(win.eval(`(()=>{const s=statistics(${JSON.stringify(rollingRates)},new Date('2026-10-14T12:15'));return s.accidentPercent('wee')==='50%'&&s.accidentPercent('poo')==='—';})()`),'P: accident percentages include the rolling 7-day boundary and exclude older and future events');
  check(win.eval(`compactDuration(8)==='8m'&&compactDuration(47)==='47m'&&compactDuration(65)==='1h 05m'&&compactDuration(222)==='3h 42m'&&compactDuration(1560)==='1d 2h'&&compactDuration(null)==='—'`),'P: compact elapsed formatter covers minutes, hours, days and missing values');
  const tombstone={...fixture.find(event=>event.type==='wee'&&event.datetime.endsWith('11:00')),id:'deleted-latest',datetime:'2026-10-14T12:10',deletedAt:'2026-10-14T12:11:00.000Z'};
  const demo={...fixture.find(event=>event.type==='meal'),id:'diagnostic-demo',datetime:'2026-10-14T13:00',demo:true};
  const observations=win.eval(`timingObservations(${JSON.stringify([...fixture,tombstone,demo])})`);
  check(observations.wee.length===3&&observations.poo.length===3&&observations['meal-poo'].length===3&&![...observations.wee,...observations.poo,...observations['meal-poo']].some(item=>item.startEvent.id==='deleted-latest'||item.endEvent.id==='diagnostic-demo'),'P: shared chart observations use qualified active events and exclude tombstones/demo rows');
  const weeEvent=(id,datetime,location='outside')=>({id,type:'wee',datetime,location,deletedAt:null});
  const weeSequence=items=>win.eval(`timingObservations(${JSON.stringify(items)})`).wee;
  const outdoorPair=weeSequence([weeEvent('out-a','2026-10-01T08:00'),weeEvent('out-b','2026-10-01T09:00')]);
  const outdoorAccident=weeSequence([weeEvent('out-start','2026-10-01T08:00'),weeEvent('acc-end','2026-10-01T09:00','inside')]);
  const accidentOutdoor=weeSequence([weeEvent('acc-start','2026-10-01T08:00','inside'),weeEvent('out-end','2026-10-01T09:00')]);
  const accidentPair=weeSequence([weeEvent('acc-a','2026-10-01T08:00','inside'),weeEvent('acc-b','2026-10-01T09:00','inside')]);
  const noBridge=weeSequence([weeEvent('bridge-start','2026-10-01T08:00'),weeEvent('bridge-accident','2026-10-01T09:00','inside'),weeEvent('bridge-end','2026-10-01T10:30')]);
  check(outdoorPair.length===1&&outdoorPair[0].minutes===60&&outdoorPair[0].accident===false&&outdoorAccident.length===1&&outdoorAccident[0].minutes===60&&outdoorAccident[0].accident===true&&accidentOutdoor.length===0&&accidentPair.length===0&&noBridge.length===1&&noBridge[0].startEvent.id==='bridge-start'&&noBridge[0].endEvent.id==='bridge-accident'&&noBridge[0].accident===true,'P: wee interval accident state follows the end event; accidents can end but never start or bridge an interval');
  const weeMetricEvents=[
    weeEvent('day-a','2026-10-01T08:00'),weeEvent('day-a-end','2026-10-01T09:00','inside'),
    weeEvent('day-b','2026-10-03T08:00','inside'),weeEvent('day-b-end','2026-10-03T09:00'),
    weeEvent('day-c','2026-10-05T07:00'),weeEvent('day-c-end','2026-10-05T08:00','inside'),
    weeEvent('day-d','2026-10-07T08:00'),weeEvent('day-d-end','2026-10-07T10:30'),
    weeEvent('night-a','2026-10-09T22:30'),weeEvent('night-a-end','2026-10-10T05:00','inside'),
    weeEvent('night-b','2026-10-12T23:00','inside'),weeEvent('night-b-end','2026-10-13T04:00'),
    weeEvent('night-c','2026-10-15T22:00'),weeEvent('night-c-end','2026-10-16T06:00'),
    weeEvent('night-d','2026-10-18T22:00'),weeEvent('night-d-end','2026-10-19T05:00')
  ];
  const weeStats=win.eval(`statistics(${JSON.stringify(weeMetricEvents)})`),weeMetricObs=weeSequence(weeMetricEvents);
  check(weeMetricObs.length===6&&weeStats.interval===270&&weeStats.daytime===150&&weeStats.overnight===480,'P: median and longest daytime/overnight gaps use the same valid outdoor-start wee observations');
  const pooEvent=(id,datetime)=>({id,type:'poo',datetime,location:'outside',deletedAt:null});
  const mealEvent=(id,datetime)=>({id,type:'meal',datetime,deletedAt:null});
  const mealPooObs=items=>win.eval(`timingObservations(${JSON.stringify(items)})`);
  const firstPooOnly=mealPooObs([mealEvent('meal-a','2026-10-01T08:00'),pooEvent('poo-first','2026-10-01T10:00'),pooEvent('poo-later','2026-10-01T12:00')]);
  const mostRecentMeal=mealPooObs([mealEvent('meal-old','2026-10-01T08:00'),mealEvent('meal-new','2026-10-01T12:00'),pooEvent('poo-new','2026-10-01T13:00')]);
  const beyondWindow=mealPooObs([mealEvent('meal-expired','2026-10-01T08:00'),pooEvent('poo-expired','2026-10-01T21:00')]);
  const twoPairs=mealPooObs([mealEvent('meal-one','2026-10-01T08:00'),pooEvent('poo-one','2026-10-01T09:00'),mealEvent('meal-two','2026-10-01T12:00'),pooEvent('poo-two','2026-10-01T13:30')]);
  check(firstPooOnly['meal-poo'].length===1&&firstPooOnly['meal-poo'][0].endEvent.id==='poo-first'&&mostRecentMeal['meal-poo'].length===1&&mostRecentMeal['meal-poo'][0].startEvent.id==='meal-new'&&beyondWindow['meal-poo'].length===0&&twoPairs['meal-poo'].length===2&&twoPairs['meal-poo'].map(item=>item.minutes).join(',')==='60,90','P: meal-to-poo pairs once with the first poo for the most recent unpaired meal, within 12 hours');
  check(firstPooOnly.poo.length===1&&firstPooOnly.poo[0].minutes===120,'P: consecutive poo-gap observations remain unchanged');
  const sharedRuleEvents=[
    weeEvent('shared-w1','2026-10-01T08:00'),weeEvent('shared-wa1','2026-10-01T09:00','inside'),weeEvent('shared-w2','2026-10-01T10:30'),
    weeEvent('shared-wa2','2026-10-03T08:00','inside'),weeEvent('shared-w3','2026-10-03T09:00'),
    weeEvent('shared-w4','2026-10-05T08:00'),weeEvent('shared-w5','2026-10-05T09:00'),
    weeEvent('shared-w6','2026-10-07T08:00'),weeEvent('shared-w7','2026-10-07T11:00'),
    mealEvent('shared-m1','2026-10-01T07:00'),pooEvent('shared-p1','2026-10-01T08:00'),pooEvent('shared-p1-later','2026-10-01T12:00'),
    mealEvent('shared-m2a','2026-10-03T08:00'),mealEvent('shared-m2b','2026-10-03T12:00'),pooEvent('shared-p2','2026-10-03T13:00'),
    mealEvent('shared-m3','2026-10-05T07:00'),pooEvent('shared-p3','2026-10-05T10:00'),
    mealEvent('shared-m4','2026-10-07T07:00'),pooEvent('shared-p4','2026-10-07T10:00')
  ];
  const sharedRuleObs=mealPooObs(sharedRuleEvents),sharedRuleStats=win.eval(`statistics(${JSON.stringify(sharedRuleEvents)})`);
  const chart=frame.contentDocument.getElementById('timing-chart-plot');
  win.eval(`timingMetrics=new Set(Object.keys(CHART_SERIES));timingView='over-time';renderTimingChart(${JSON.stringify(sharedRuleEvents)},new Date('2026-10-07T16:00:00'));`);
  check(sharedRuleStats.interval===win.eval(`median(${JSON.stringify(sharedRuleObs.wee.map(item=>item.minutes))})`)&&sharedRuleStats.mealPoo===win.eval(`median(${JSON.stringify(sharedRuleObs['meal-poo'].map(item=>item.minutes))})`)&&chart.querySelectorAll('.chart-point[data-metric="wee"]').length===sharedRuleObs.wee.length&&chart.querySelectorAll('.chart-point[data-metric="meal-poo"]').length===sharedRuleObs['meal-poo'].length,'P: chart observations and Stats medians consume the same revised shared datasets');
  win.eval(`timingMetrics=new Set(Object.keys(CHART_SERIES));timingView='over-time';renderTimingChart(${JSON.stringify([...fixture,tombstone,demo])},new Date('2026-10-15T09:18:00'));`);
  const weeXs=[...chart.querySelectorAll('.chart-point[data-metric="wee"]')].map(point=>Number(point.transform.baseVal.consolidate().matrix.e)),pooPoints=[...chart.querySelectorAll('.chart-point[data-metric="poo"]')],pooXs=pooPoints.map(point=>Number(point.transform.baseVal.consolidate().matrix.e)),plotAxis=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2'));
  check(chart.querySelectorAll('.chart-point:not([data-metric="accident-rate"])').length===9&&chart.querySelectorAll('.chart-accident-rate-hit').length>=2&&!chart.querySelector('.chart-point[data-metric="accident-rate"]')&&chart.querySelectorAll('.chart-trend-point').length===3&&weeXs.every((x,index)=>!index||x>weeXs[index-1])&&pooXs.every((x,index)=>!index||x>pooXs[index-1])&&pooPoints.every(point=>win.getComputedStyle(point).transform==='none'&&Number(point.transform.baseVal.consolidate().matrix.e)>=Number(plotAxis.getAttribute('x1'))&&Number(point.transform.baseVal.consolidate().matrix.e)<=Number(plotAxis.getAttribute('x2'))),'P: observation points overlay chronologically, rolling accident-rate renders as a marker-free line, and duration trends/medians remain unchanged');
  const medianLabels=[...chart.querySelectorAll('.chart-median-label')],labelY=medianLabels.map(label=>Number(label.dataset.labelY)).sort((a,b)=>a-b);
  const medianValues=win.eval(`Object.fromEntries(Object.entries(timingObservations(${JSON.stringify([...fixture,tombstone,demo])})).map(([metric,items])=>[metric,median(items.map(item=>item.minutes))]))`);
  const medianBounds=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('x1')===line.getAttribute('x2'));
  const collisionPositions=[...win.eval(`resolveMedianLabelPositions([{metric:'wee',y:100},{metric:'poo',y:100},{metric:'meal-poo',y:100}],20,120).values()`)].map(item=>item.labelY);
  check(medianLabels.length===3&&medianLabels.every(label=>label.textContent===win.eval(`compactDuration(${medianValues[label.dataset.metric]})`)&&label.getAttribute('aria-label').includes('median:')&&label.dataset.labelY>=Number(medianBounds.getAttribute('y1'))+10&&label.dataset.labelY<=Number(medianBounds.getAttribute('y2'))-10&&Math.abs(Number(label.dataset.medianY)-(24+348*(1-medianValues[label.dataset.metric]/165)))<.1)&&labelY.every((value,index)=>!index||value-labelY[index-1]>=19.9)&&JSON.stringify(collisionPositions)==='[80,100,120]','P: overall median labels show only compact durations, expose full accessible descriptions, follow true median heights, and resolve collisions deterministically within chart bounds');
  const accidentChartEvents=[
    {id:'wee-a',type:'wee',datetime:'2026-10-15T07:00',location:'outside',deletedAt:null},
    {id:'wee-b',type:'wee',datetime:'2026-10-15T08:00',location:'outside',deletedAt:null},
    {id:'wee-c',type:'wee',datetime:'2026-10-15T09:18',location:'inside',deletedAt:null},
    {id:'poo-a',type:'poo',datetime:'2026-10-15T07:05',location:'outside',deletedAt:null},
    {id:'poo-b',type:'poo',datetime:'2026-10-15T08:05',location:'outside',deletedAt:null},
    {id:'meal-a',type:'meal',datetime:'2026-10-15T08:15',location:'outside',deletedAt:null},
    {id:'poo-c',type:'poo',datetime:'2026-10-15T09:35',location:'inside',deletedAt:null}
  ];
  const accidentObservations=win.eval(`timingObservations(${JSON.stringify(accidentChartEvents)})`);
  check(accidentObservations.wee.map(item=>item.accident).join(',')==='false,true'&&accidentObservations.poo.map(item=>item.accident).join(',')==='false,true'&&accidentObservations['meal-poo'].length===1&&accidentObservations['meal-poo'][0].accident===true,'P: Wee, Poo and Meal → poo accident flags use the existing accident helper on each observation end event');
  win.eval(`timingMetrics=new Set(Object.keys(CHART_SERIES));timingView='over-time';renderTimingChart(${JSON.stringify(accidentChartEvents)},new Date('2026-10-15T09:18:00'));`);
  const allChartPoints=[...chart.querySelectorAll('.chart-point')],accidentPoints=allChartPoints.filter(point=>point.dataset.metric!=='accident-rate'),highlightedPoints=accidentPoints.filter(point=>point.dataset.accident==='true');
  check(accidentPoints.length===5&&chart.querySelectorAll('.chart-accident-rate-hit').length>=2&&!chart.querySelector('.chart-point[data-metric="accident-rate"]')&&highlightedPoints.length===3&&highlightedPoints.every(point=>point.querySelector('.chart-accident-cue')&&point.getAttribute('aria-label').includes('Ended in inside accident')&&point.dataset.pointDetail.includes('Ended in inside accident'))&&accidentPoints.filter(point=>point.dataset.accident==='false').every(point=>!point.querySelector('.chart-accident-cue')),'P: Over time points retain metric markers and accident badges, while the rolling rate is an accessible marker-free line');
  const accidentMinutes=Object.fromEntries(Object.entries(accidentObservations).map(([metric,items])=>[metric,items.map(item=>item.minutes)]));
  win.eval(`timingView='ordered';renderTimingChart(${JSON.stringify(accidentChartEvents)},new Date('2026-10-15T09:18:00'));`);
  const orderedAccidentPoints=[...chart.querySelectorAll('.chart-point[data-accident="true"]')];
  check(orderedAccidentPoints.length===3&&orderedAccidentPoints.every(point=>point.querySelector('.chart-accident-cue')&&point.getAttribute('aria-label').includes('Ended in inside accident'))&&JSON.stringify(win.eval(`Object.fromEntries(Object.entries(timingObservations(${JSON.stringify(accidentChartEvents)})).map(([metric,items])=>[metric,items.map(item=>item.minutes)]))`))===JSON.stringify(accidentMinutes),'P: Ordered points keep each observation accident cue while preserving duration inputs used by trends, medians and percentile positions');
  win.eval(`timingMetrics=new Set(['wee']);renderTimingChart(${JSON.stringify(accidentChartEvents)},new Date('2026-10-15T09:18:00'));`);
  check(chart.querySelectorAll('.chart-point').length===2&&chart.querySelectorAll('.chart-accident-cue').length===1&&chart.querySelector('.chart-point[data-accident="true"]').dataset.metric==='wee','P: metric filtering retains accident cues only on the selected series');
  win.eval(`store.events=${JSON.stringify(fixture)}`);
  frame.contentDocument.querySelector('[data-chart-filter="poo"]').click();
  check(chart.querySelectorAll('.chart-point').length===6&&chart.querySelectorAll('.chart-median-label').length===2&&frame.contentDocument.querySelector('[data-chart-filter="wee"]').checked&&frame.contentDocument.querySelector('[data-chart-filter="poo"]').checked,'P: independent chart checkboxes show Wee and Poo together with both median labels');
  frame.contentDocument.querySelector('[data-chart-filter="wee"]').click();
  check(chart.querySelectorAll('.chart-point').length===3&&[...chart.querySelectorAll('.chart-point')].every(point=>point.dataset.metric==='poo')&&chart.querySelectorAll('.chart-median-label').length===1&&chart.querySelector('.chart-median-label').dataset.metric==='poo'&&frame.contentDocument.querySelector('[data-chart-filter="poo"]').checked,'P: unchecking Wee leaves Poo selected with its median label');
  const trendWindow=win.eval(`trailingMedianObservations([{completedAt:0,minutes:10},{completedAt:86400000,minutes:20},{completedAt:259200000,minutes:900},{completedAt:259200001,minutes:40}])`);
  check(trendWindow[2].median===20&&trendWindow[3].median===40&&win.eval(`median([10,20,30,40,50])===30`),'P: trailing medians use the inclusive 72-hour window, exclude points older than 72 hours, and retain three qualifying values');
  const beforeChart=JSON.stringify(state(frame));
  frame.contentDocument.querySelectorAll('[data-chart-filter]').forEach(input=>{if(!input.checked)input.click();});frame.contentDocument.querySelector('[data-chart-view="ordered"]').click();
  const svg=chart.querySelector('svg'),axis=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2')),startX=Number(axis.getAttribute('x1')),endX=Number(axis.getAttribute('x2'));
  const orderedSpans=['wee','poo','meal-poo'].every(metric=>{const xs=[...chart.querySelectorAll(`.chart-point[data-metric="${metric}"]`)].map(point=>Number(point.transform.baseVal.consolidate().matrix.e));return xs.length===3&&Math.min(...xs)===startX&&Math.max(...xs)===endX;});
  const band=chart.querySelector('.chart-iqr-band'),iqrAxisRange=Math.abs(Number(band.getAttribute('x'))-(startX+(endX-startX)*.25))<.1&&Math.abs(Number(band.getAttribute('width'))-(endX-startX)*.5)<.1&&Math.abs(Number(band.getAttribute('y'))-24)<.1&&Number(band.getAttribute('height'))>0;
  const orderedLines=[...chart.querySelectorAll('.chart-ordered')];
  const orderedButton=frame.contentDocument.querySelector('[data-chart-view="ordered"]'),orderedSelected=orderedButton.getAttribute('aria-pressed')==='true'&&win.getComputedStyle(orderedButton).boxShadow!=='none';
  check(orderedSpans&&orderedLines.length===3&&orderedLines.every(line=>(line.getAttribute('d').match(/L/g)||[]).length===2)&&iqrAxisRange&&orderedSelected&&chart.querySelectorAll('.chart-iqr-band').length===1&&chart.querySelectorAll('.chart-reference').length===3&&chart.querySelectorAll('.chart-median-label').length===3&&[...chart.querySelectorAll('.chart-median-label')].every(label=>/^(\d+h \d{2}m|\d+m)$/.test(label.textContent)&&label.getAttribute('aria-hidden')==='true'),'P: Ordered mode marks medians, labels them compactly beside the 50% references, and joins qualified series');
  frame.contentDocument.querySelectorAll('[data-chart-filter]').forEach(input=>{if(input.checked!==(input.dataset.chartFilter==='wee'))input.click();});const oneGap=[{id:'one-a',type:'wee',datetime:'2026-10-14T08:00',deletedAt:null},{id:'one-b',type:'wee',datetime:'2026-10-14T09:00',deletedAt:null}];
  win.eval(`timingView='ordered';renderTimingChart(${JSON.stringify(oneGap)});`);
  const onePoint=chart.querySelector('.chart-point'),axisLine=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2')),pointX=Number(onePoint.transform.baseVal.consolidate().matrix.e),axisMid=(Number(axisLine.getAttribute('x1'))+Number(axisLine.getAttribute('x2')))/2;
  check(chart.querySelectorAll('.chart-point').length===1&&Math.abs(pointX-axisMid)<.01&&chart.querySelectorAll('.chart-reference').length===0&&chart.querySelectorAll('.chart-iqr-band').length===0&&!chart.querySelector('[aria-label*="median"]'),'P: one Ordered observation stays at 50% with no unsupported median or distribution decoration');
  const twoGaps=[{id:'two-a',type:'wee',datetime:'2026-10-14T08:00',deletedAt:null},{id:'two-b',type:'wee',datetime:'2026-10-14T09:00',deletedAt:null},{id:'two-c',type:'wee',datetime:'2026-10-14T10:00',deletedAt:null}];
  win.eval(`timingView='ordered';renderTimingChart(${JSON.stringify(twoGaps)});`);
  const twoPoints=[...chart.querySelectorAll('.chart-point')],twoXs=twoPoints.map(point=>Number(point.transform.baseVal.consolidate().matrix.e)),twoAxis=[...chart.querySelectorAll('.chart-axis')].find(line=>line.getAttribute('y1')===line.getAttribute('y2'));
  check(twoPoints.length===2&&Math.min(...twoXs)===Number(twoAxis.getAttribute('x1'))&&Math.max(...twoXs)===Number(twoAxis.getAttribute('x2'))&&chart.querySelectorAll('.chart-reference').length===0&&chart.querySelectorAll('.chart-iqr-band').length===0&&chart.querySelectorAll('.chart-ordered').length===1&&win.eval('percentileRank(0,1)===50&&percentileRank(0,4)===0&&percentileRank(3,4)===100')&&JSON.stringify(state(frame))===beforeChart,'P: two Ordered observations span 0–100% without statistical references and leave diary data unchanged');
  const crossDay=[...fixture,{...fixture[0],id:'yesterday',datetime:'2026-10-13T08:00'}];
  check(win.eval(`currentTimePercent(new Date('2026-10-14T00:00'))===0&&currentTimePercent(new Date('2026-10-14T12:00'))===50&&Math.abs(currentTimePercent(new Date('2026-10-14T23:00'))-95.8333333333)<.001`),'P: Now marker uses the same 24-hour geometry at midnight, noon and late evening');
  win.eval(`renderTimeline(${JSON.stringify(crossDay)},${JSON.stringify(crossDay)},new Date('2026-10-14T12:00'));`);
  check(frame.contentDocument.querySelectorAll('#timeline .timeline-now').length===2&&[...frame.contentDocument.querySelectorAll('#timeline .timeline-now')].every(line=>line.parentElement.classList.contains('plot'))&&frame.contentDocument.getElementById('timeline').getAttribute('aria-label').includes('12:00'),'P: Now segments align in every visible plot only, with one accessible current-time label');
  win.eval(`renderAggregate(${JSON.stringify(crossDay)},new Date('2026-10-14T12:00'));`);
  const aggregateNow=[...frame.contentDocument.querySelectorAll('#aggregate .aggregate-now')],aggregateAxisNow=frame.contentDocument.querySelector('#aggregate [data-now-axis-label]');
  check(aggregateNow.length===4&&aggregateNow.every(line=>line.parentElement.classList.contains('bucket-strip')&&line.style.left==='50%')&&aggregateAxisNow?.style.left==='50%'&&aggregateNow.every(line=>!line.parentElement.parentElement.querySelector('.date-label').contains(line)),'P: Timing Summary Now markers align with the Diary axis and stay inside all four plotting rows');
  win.eval(`store.events=${JSON.stringify([...fixture,tombstone])};renderHeader(activeEvents(),new Date('2026-10-14T12:15:00'));`);
  const header=frame.contentDocument.getElementById('summary'), decision=header.querySelectorAll('.metric');
  check(decision.length===6 && !header.textContent.includes("Today's wees") && !header.textContent.includes("Today's poos") && !header.textContent.includes("Today's meals") && decision[1].querySelector('strong').textContent==='15m','P: header contains desktop and mobile metric variants, uses latest active wee and ignores tombstones');
  check(decision[2].querySelector('strong').textContent==='1h 15m' && decision[3].querySelector('strong').textContent==='15m' && decision[1].getAttribute('aria-label').includes('15 minutes') && decision[3].textContent.includes('Median 2h 00m'),'P: desktop meal and poo values, shared medians and accessible descriptions render correctly');
  const freeEvents=[{...fixture[0],datetime:'2026-10-12T08:00',location:'inside'},{...fixture[4],datetime:'2026-10-13T10:00',location:'inside'},{...fixture[0],datetime:'2026-10-14T11:00'}];
  win.eval(`renderHeader(${JSON.stringify(freeEvents)},new Date('2026-10-14T12:15'));renderStats(${JSON.stringify(freeEvents)},new Date('2026-10-14T12:15'));`);
  const freeMetric=header.querySelector('.metric:last-child');
  check(freeMetric.querySelector('strong').textContent==='1d 2h'&&freeMetric.getAttribute('aria-label')==='1 day 2 hours accident-free'&&frame.contentDocument.getElementById('stats').textContent.includes('Accident-free streak1d 2h')&&win.eval(`accidentFreeTime([{...${JSON.stringify(fixture[0])},location:'inside'}],new Date('2026-10-14T13:30')).value==='5h'&&accidentFreeTime([${JSON.stringify(fixture[0])}],new Date('2026-10-14T09:00')).value==='1h'&&accidentFreeTime([]).value==='—'`),'P: header and Stats show completed accident-free days and hours, omitting zero days, since the latest accident or first entry');
  const headerAccidents=fixture.map(event=>({...event,location:event.datetime.endsWith('12:00')||event.type==='meal'?'inside':'outside'}));
  win.eval(`renderHeader(${JSON.stringify(headerAccidents)},new Date('2026-10-14T12:15:00'));`);
  const accidentMetrics=header.querySelectorAll('.metric');
  check(header.querySelectorAll('.header-accident').length===2&&[1,3].every(index=>accidentMetrics[index].querySelector('.header-accident')&&accidentMetrics[index].getAttribute('aria-label').includes('Latest event was an inside accident')&&win.getComputedStyle(accidentMetrics[index].querySelector('.header-accident')).position==='absolute')&&!accidentMetrics[4].querySelector('.header-accident'),'P: latest inside wee and poo get accessible accident badges outside normal flow without flagging meals or the accident headline');
  const outdoorLatest=[...headerAccidents,{...fixture[0],id:'latest-out-wee',datetime:'2026-10-14T12:05'},{...fixture[4],id:'latest-out-poo',datetime:'2026-10-14T12:10'}];
  win.eval(`renderHeader(${JSON.stringify(outdoorLatest)},new Date('2026-10-14T12:15:00'));`);
  check(!header.querySelector('.header-accident')&&!header.querySelector('[aria-label*="Latest event was an inside accident"]'),'P: a later outdoor wee or poo clears the corresponding header accident cue');
  win.eval(`renderHeader(${JSON.stringify([...fixture,{...fixture[0],id:'future',datetime:'2026-10-14T13:00'}])},new Date('2026-10-14T12:15:00'));`);
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='—','P: future-dated latest event displays a safe placeholder');
  win.eval(`renderHeader([],new Date('2026-10-14T12:15:00'));renderStats([]);`);
  check([...frame.contentDocument.querySelectorAll('#summary .decision-metric')].filter(metric=>metric.querySelector('.metric-description')?.textContent!=='Since last accident').every(metric=>metric.querySelector('strong').textContent==='—'&&metric.textContent.toLowerCase().includes('median —'))&&frame.contentDocument.querySelector('#summary .metric.mobile-only-metric .metric-median').textContent==='0.0 / 24h'&&frame.contentDocument.getElementById('stats').textContent.includes('Median poo interval—'),'P: missing event elapsed and median values show dashes while rolling accident rate correctly shows zero');
  const instant='2026-10-14T11:00:00.000Z', event={id:'timer-wee',type:'wee',datetime:'2026-10-14T11:00',location:'outside',note:'',createdAt:instant,updatedAt:instant,deletedAt:null,mutationId:'timer-mutation',serverVersion:null,syncBaseMutationId:null};
  await importBackup(frame,{version:2,demoCleared:true,events:[event]});
  const before=await databaseContents(), beforeWrites=win.__saveEvents;
  const initialNow=frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left;
  win.__testNow=Date.parse('2026-10-14T12:00:00');win.__minuteTick();
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='1h 00m'&&frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left==='50%'&&[...frame.contentDocument.querySelectorAll('#aggregate .aggregate-now')].every(line=>line.style.left==='50%'),'P: existing minute timer refreshes elapsed metrics and moves both Now markers');
  win.__testNow=Date.parse('2026-10-14T13:00:00');win.__minuteTick();
  const timedMarkers=[...frame.contentDocument.querySelectorAll('#aggregate .aggregate-now, #timeline .timeline-now')];
  check(initialNow!=='50%'&&frame.contentDocument.querySelector('#timeline .timeline-now')?.style.left.startsWith('54.16')&&timedMarkers.length===5&&timedMarkers.every(line=>line.style.left.startsWith('54.16'))&&frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='2h 00m'&&same(await databaseContents(),before)&&win.__saveEvents===beforeWrites,'P: minute refresh moves both markers across rows and updates UI only, without storage writes or sync triggers');
  frame.remove();
}
