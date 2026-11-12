'use strict';

// Exercise the relocated UI against the same disposable IndexedDB app fixture.
async function domainChecks() {
  await reset();
  const frame=await start(), win=frame.contentWindow, doc=frame.contentDocument;
  const pages=['home','toileting','care','weight','data'];
  check(!doc.getElementById('home-page').hidden&&doc.getElementById('home-weight-summary').textContent.includes('No weights recorded'),'Q: empty Home starts with an honest weight empty state');
  const today=win.eval('localDate(new Date())'),yesterday=win.eval(`previousDate('${today}')`);
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
    check(pages.every(key=>doc.getElementById(`${key}-page`).hidden===(key!==page))&&doc.querySelectorAll('[data-page][aria-selected="true"]').length===1&&doc.getElementById(`${page}-page-tab`).tabIndex===0,`Q: ${page} navigation selects exactly one accessible destination`);
  }
  check(same(state(frame),before)&&doc.getElementById('care-page').textContent.includes('No care recorded yet'),'Q: navigation and empty Care view never create or mutate records');
  await click(frame,'#data-filters [data-filter="weight"]');
  check(doc.querySelectorAll('#data tbody tr').length===2,'Q: Data still exposes both weight events');
  await click(frame,'#toileting-page-tab');
  check(doc.querySelector('#filters [data-filter="all"]').getAttribute('aria-pressed')==='true'&&doc.querySelectorAll('#timeline .time-row').length===2&&!doc.querySelector('#toileting-page .weight-svg'),'Q: Toileting resets a weight-only filter and retains historical rows without weight analytics');
  await click(frame,'#filters [data-filter="wee"]');
  await click(frame,'#home-page-tab');
  check(doc.querySelectorAll('#today-timeline .event-mark').length===3,'Q: Home today view is independent of the historical filter');
  const tab=doc.getElementById('home-page-tab');tab.focus();
  for(const [key,expected] of [['ArrowLeft','data'],['Home','home'],['ArrowRight','toileting'],['End','data']]) {
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true}));
    check(doc.activeElement.id===`${expected}-page-tab`&&!doc.getElementById(`${expected}-page`).hidden,`Q: keyboard ${key} moves focus and destination together`);
  }
  await click(frame,'#home-page-tab');
  await click(frame,'#record-weight');
  check(doc.getElementById('editor').open&&doc.getElementById('event-form').elements.type.value==='weight'&&same(state(frame),before),'Q: Weight shortcut opens the shared editor without saving an incomplete record');
  doc.getElementById('event-form').elements.weightKg.value='12.5';
  await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events.length===before.events.length+1&&state(frame).events.at(-1).weightKg===12.5,'Q: Weight shortcut saves exactly one normal weight event');
  await click(frame,'#today-timeline [data-id="today-poo"]');
  doc.getElementById('event-form').elements.note.value='Edited from Home';
  await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events.find(event=>event.id==='today-poo').note==='Edited from Home'&&doc.querySelector('#timeline [data-id="today-poo"]')===null,'Q: Home edits use the shared store while respecting the historical wee filter');
  await click(frame,'#today-timeline [data-id="today-poo"]');await click(frame,'#delete-event');
  check(state(frame).events.find(event=>event.id==='today-poo').deletedAt!==null&&!doc.querySelector('#today-timeline [data-id="today-poo"]'),'Q: Home deletion preserves a tombstone and refreshes today');
  for(const width of [1200,768,390,320]) {
    frame.style.width=`${width}px`;
    for(const page of pages) {
      await click(frame,`#${page}-page-tab`);
      check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth,`Q: ${page} fits ${width}px without horizontal scrolling`);
    }
  }
  frame.remove();
}
