'use strict';

// Exercise the relocated UI against the same disposable IndexedDB app fixture.
async function domainChecks() {
  await reset();
  const frame=await start(), win=frame.contentWindow, doc=frame.contentDocument;
  const pages=['toileting','care','weight','data'];
  check(doc.getElementById('home-page').hidden&&!doc.getElementById('toileting-page').hidden&&doc.querySelectorAll('[data-page]').length===4&&doc.getElementById('home-weight-summary').textContent.includes('No weights recorded'),'Q: Toileting is the default visible destination and Home starts with an honest weight empty state');
  const today=win.eval('localDate(new Date())'),yesterday=win.eval(`previousDate('${today}')`),dayAtOffset=offset=>win.eval(`(()=>{const day=new Date('${today}T12:00');day.setDate(day.getDate()+${offset});return localDate(day);})()`);
  const events=[
    {id:'today-wee',type:'wee',datetime:`${today}T08:00`,location:'outside',note:''},
    {id:'today-poo',type:'poo',datetime:`${today}T09:00`,location:'inside',pooConsistency:'Normal',note:''},
    {id:'today-meal',type:'meal',datetime:`${today}T07:00`,mealFood:'Kibble',mealAmount:'100 g',note:''},
    {id:'yesterday-wee',type:'wee',datetime:`${yesterday}T08:00`,location:'outside',note:''},
    {id:'first-weight',type:'weight',datetime:`${yesterday}T10:00`,weightKg:12.1,note:''},
    {id:'latest-weight',type:'weight',datetime:`${today}T10:00`,weightKg:12.4,note:''}
  ];
  await importBackup(frame,{version:1,demoCleared:true,events});
  check(doc.querySelectorAll('#today-timeline .time-row').length===1&&doc.querySelectorAll('#today-timeline .event-mark').length===3&&!doc.querySelector('#today-timeline [data-id="yesterday-wee"]'),'Q: Home timeline contains only today’s toilet and meal events');
  check(doc.getElementById('home-weight-summary').textContent.includes('12.4 kg')&&doc.querySelector('#home-weight-summary time').dateTime===`${today}T10:00`&&!doc.querySelector('#home-page svg')&&!doc.querySelector('#home-page #aggregate'),'Q: Home shows the latest weight/date without either full analytics view');
  const ids=[...doc.querySelectorAll('[id]')].map(node=>node.id);
  check(ids.length===new Set(ids).size,'Q: relocated render targets have no duplicate IDs');
  const before=state(frame);
  for(const page of pages) {
    await click(frame,`#${page}-page-tab`);
    check(pages.every(key=>doc.getElementById(`${key}-page`).hidden===(key!==page))&&doc.getElementById('home-page').hidden&&doc.querySelectorAll('[data-page][aria-selected="true"]').length===1&&doc.getElementById(`${page}-page-tab`).tabIndex===0,`Q: ${page} navigation selects exactly one accessible destination while Home stays hidden`);
  }
  check(same(state(frame),before)&&doc.getElementById('care-page').textContent.includes('No care recorded yet'),'Q: navigation and empty Care view never create or mutate records');
  await click(frame,'#data-filters [data-filter="weight"]');
  check(doc.querySelectorAll('#data tbody tr').length===2,'Q: Data still exposes both weight events');
  await click(frame,'#toileting-page-tab');
  check(!doc.querySelector('#toileting-page [data-event-filters]')&&doc.querySelectorAll('#timeline .time-row').length===2&&!doc.querySelector('#toileting-page .weight-svg'),'Q: Toileting keeps unfiltered historical rows without weight analytics');
  win.eval("selectPage('home')");
  check(!doc.getElementById('home-page').hidden&&doc.getElementById('home-weight-summary').textContent.includes('12.4 kg'),'Q: Home implementation remains available for its shared timeline and weight summary');
  win.eval("selectPage('toileting')");
  await click(frame,'#toileting-page-tab');
  check(doc.querySelectorAll('#today-timeline .event-mark').length===3,'Q: Home today view shows today’s events independently of Data filters');
  const tab=doc.getElementById('toileting-page-tab');tab.focus();
  for(const [key,expected] of [['ArrowLeft','data'],['Home','toileting'],['ArrowRight','care'],['End','data']]) {
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true}));
    check(doc.activeElement.id===`${expected}-page-tab`&&!doc.getElementById(`${expected}-page`).hidden,`Q: keyboard ${key} moves focus and destination together`);
  }
  await click(frame,'#toileting-page-tab');
  await click(frame,'#record-weight');
  check(doc.getElementById('editor').open&&doc.getElementById('event-form').elements.type.value==='weight'&&same(state(frame),before),'Q: Weight shortcut opens the shared editor without saving an incomplete record');
  doc.getElementById('event-form').elements.weightKg.value='12.5';
  await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events.length===before.events.length+1&&state(frame).events.at(-1).weightKg===12.5,'Q: Weight shortcut saves exactly one normal weight event');
  win.eval("selectPage('home')");
  await click(frame,'#today-timeline [data-id="today-poo"]');
  doc.getElementById('event-form').elements.note.value='Edited from Home';
  await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events.find(event=>event.id==='today-poo').note==='Edited from Home'&&doc.querySelector('#timeline [data-id="today-poo"]')!==null,'Q: Home edits use the shared store and keep the active poo event visible in history');
  await click(frame,'#today-timeline [data-id="today-poo"]');await click(frame,'#delete-event');
  check(state(frame).events.find(event=>event.id==='today-poo').deletedAt!==null&&!doc.querySelector('#today-timeline [data-id="today-poo"]'),'Q: Home deletion preserves a tombstone and refreshes today');
  for(const width of [1200,768,390,320]) {
    frame.style.width=`${width}px`;
    for(const page of pages) {
      await click(frame,`#${page}-page-tab`);
      check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth&&doc.getElementById('home-page').hidden,`Q: ${page} fits ${width}px without horizontal scrolling and Home stays hidden`);
    }
  }
  const trendEvents=[];
  for(let offset=-12;offset<0;offset++) {
    const day=dayAtOffset(offset);
    for(const [type,time,location='outside'] of [['wee','01:20'],['poo','07:15'],['wee','09:00'],['wee','22:40']])trendEvents.push({id:`trend-${offset}-${type}-${time}`,type,datetime:`${day}T${time}`,location,deletedAt:null,...(type==='poo'?{pooConsistency:'Normal'}:{})});
    if(offset>=-9)trendEvents.push({id:`trend-accident-${offset}`,type:'wee',datetime:`${day}T12:00`,location:'inside',deletedAt:null});
  }
  await importBackup(frame,{version:1,demoCleared:true,events:trendEvents});
  const trendLabels=[...doc.querySelectorAll('#trend-tabs [data-trend]')].map(button=>button.textContent.trim());
  check(same(trendLabels,['Frequency','Gaps','Morning','Accidents','Ordered']),'Q: Toileting carousel has exactly the five requested views');
  for(const width of [1200,320]) {
    frame.style.width=`${width}px`;await new Promise(resolve=>setTimeout(resolve,20));
    await click(frame,'#toileting-page-tab');await click(frame,'#trend-gaps');
    const gaps=doc.querySelector('#trend-plot svg.trend-svg'),gapWidth=gaps.viewBox.baseVal.width,gapRight=Number(gaps.dataset.plotRight),gapBoxes=[...gaps.querySelectorAll('.trend-endpoint rect')].map(box=>({x:Number(box.getAttribute('x')),right:Number(box.getAttribute('x'))+Number(box.getAttribute('width'))}));
    check(gaps.querySelectorAll('.trend-endpoint[data-series="Wee"]').length===1&&gaps.querySelectorAll('.trend-endpoint[data-series="Poo"]').length===1&&gaps.querySelectorAll('.trend-endpoint[data-series="Overnight"]').length===1&&gapBoxes.every(box=>box.x>=gapRight&&box.right<=gapWidth)&&doc.documentElement.scrollWidth<=doc.documentElement.clientWidth,`Q: Gaps keeps three latest labels in its gutter at ${width}px`);
    await click(frame,'#trend-morning');
    check(doc.querySelectorAll('#trend-plot .trend-endpoint').length===1&&doc.querySelector('#trend-plot .trend-legend').textContent.includes('First toilet')&&doc.querySelector('#trend-plot svg.trend-svg').getAttribute('aria-label').includes('Wee or Poo'),`Q: Morning plots one combined Wee/Poo series at ${width}px`);
    await click(frame,'#trend-accidents');
    const accidents=doc.querySelector('#trend-plot svg.trend-svg'),accidentWidth=accidents.viewBox.baseVal.width,accidentRight=Number(accidents.dataset.plotRight),accidentBoxes=[...accidents.querySelectorAll('.trend-endpoint rect')].map(box=>({x:Number(box.getAttribute('x')),right:Number(box.getAttribute('x'))+Number(box.getAttribute('width'))})),rateTicks=[...accidents.querySelectorAll('.chart-axis-label')].filter(label=>Number(label.getAttribute('x'))>accidentRight).map(label=>label.getBBox()),labelBoxes=[...accidents.querySelectorAll('.trend-endpoint rect')].map(label=>label.getBBox()),overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    check(accidents.querySelector('.trend-endpoint[data-series="Wee accident gap"]')&&accidents.querySelector('.trend-endpoint[data-series="Accidents / 24h"]')&&accidents.querySelector('.trend-open-accident')&&accidentBoxes.every(box=>box.x>=accidentRight+34&&box.right<=accidentWidth)&&labelBoxes.every(box=>rateTicks.every(tick=>!overlaps(box,tick)))&&doc.documentElement.scrollWidth<=doc.documentElement.clientWidth,`Q: Accidents keeps its secondary axis, open marker and labels clear at ${width}px`);
  }
  frame.remove();
}
