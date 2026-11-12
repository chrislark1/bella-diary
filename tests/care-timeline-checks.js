'use strict';
async function careTimelineChecks() {
  await reset();
  const frame=await start(),w=frame.contentWindow,d=frame.contentDocument;
  const now=new Date(),today=w.eval('localDate(new Date())');
  const date=offset=>{const t=new Date(today+'T12:00');t.setDate(t.getDate()+offset);return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;};
  const categories=['worming','flea','vaccination','vet','medication','other'];
  const rows=categories.map((careCategory,i)=>({id:'care-timeline-'+i,type:'care',careCategory,datetime:date(-5)+'T08:00',careProduct:'Test',nextDue:date([-2,-1,0,5,14,20][i]),note:''}));
  await importBackup(frame,{version:1,demoCleared:true,events:rows});
  const before=state(frame);
  check(d.querySelectorAll('#home-care-items button').length===5,'Care timeline: Home keeps all overdue plus only three upcoming');
  const states=w.eval(`[-1,0,14,15].map(n=>{const date=new Date('${today}T12:00');date.setDate(date.getDate()+n);return careDueState(localDate(date),new Date('${today}T12:00')).state;})`);
  check(same(states,['overdue','due-soon','due-soon','future']),'Care timeline: due boundaries use local calendar days');
  await click(frame,'#care-page-tab');
  check(d.querySelectorAll('.care-month').length===6&&d.querySelectorAll('.current-month').length===1&&d.querySelectorAll('.care-today').length===1,'Care timeline: bounded month window and one current-day marker');
  check(d.querySelectorAll('.care-mark.actual').length===6&&d.querySelectorAll('.care-mark.projected').length===6,'Care timeline: actual and projected markers are distinct');
  check([...d.querySelectorAll('.care-mark')].every(mark=>/completed|projected due/.test(mark.getAttribute('aria-label'))),'Care timeline: all markers identify actual/projected date accessibly');
  check(new Set([...d.querySelectorAll('.care-mark.actual')].map(mark=>mark.style.top)).size===6,'Care timeline: same-day events have distinct deterministic lanes');
  check(w.eval("careDayPosition('2026-11-01')===.5/30*100&&careDayPosition('2026-11-30')===29.5/30*100"),'Care timeline: first and last days use the same month scale');
  await click(frame,'#home-page-tab');await click(frame,'#home-care-items button');
  check(!d.getElementById('care-page').hidden&&!d.getElementById('care-detail').hidden&&d.activeElement.id==='care-detail','Care timeline: Home opens and focuses projected details');
  await click(frame,'#adjust-care-due');d.getElementById('event-form').elements.nextDue.value=date(30);await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events.length===before.events.length&&state(frame).events[0].nextDue===date(30)&&state(frame).events[0].mutationId!==before.events[0].mutationId,'Care timeline: override edits the source actual with normal mutation metadata');
  await click(frame,'#complete-care');await click(frame,'#event-form button[type="submit"]');
  const saved=state(frame),latest=saved.events.at(-1);
  check(saved.events.length===7&&latest.type==='care'&&latest.careCategory==='worming'&&latest.nextDue===null&&w.eval('careProjections(activeEvents())').find(i=>i.category==='worming').sourceId===latest.id,'Care timeline: completion records a new actual and replaces the effective projection');
  check((await databaseContents()).events.length===7&&d.querySelectorAll('#data tbody tr').length===7,'Care timeline: no projected database or Data rows');
  await click(frame,'.care-mark.actual');
  check(d.getElementById('editor').open&&d.getElementById('editor-title').textContent==='Edit entry','Care timeline: solid markers use the existing editor');await click(frame,'#cancel-editor');
  for(const width of [1200,768,390,320]) {
    frame.style.width=width+'px';w.eval('render()');
    check(d.documentElement.scrollWidth<=d.documentElement.clientWidth,`Care timeline: no horizontal overflow at ${width}px`);
  }
  frame.remove();
}
