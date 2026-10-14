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
  win.__testNow=Date.parse('2026-10-14T12:00:00');win.__minuteTick();
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='1h 00m','P: existing minute timer refreshes elapsed header metrics');
  win.__testNow=Date.parse('2026-10-14T13:00:00');win.__minuteTick();
  check(frame.contentDocument.querySelectorAll('#summary .metric')[1].querySelector('strong').textContent==='2h 00m' && same(await databaseContents(),before) && win.__saveEvents===beforeWrites,'P: repeated timer refresh changes UI only, without storage writes or sync-trigger events');
  frame.remove();
}
