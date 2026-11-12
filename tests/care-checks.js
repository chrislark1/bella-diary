'use strict';
async function careChecks() {
  await reset();
  const frame=await start(),w=frame.contentWindow,d=frame.contentDocument;
  const calc=w.eval(`(()=>{const e=(category,date,nextDue=null)=>({id:date,type:'care',careCategory:category,datetime:date+'T12:00',nextDue,deletedAt:null});const now=new Date('2027-03-01T12:00');return [addCareMonths('2027-01-31',1),addCareMonths('2027-11-30',3),addCareMonths('2028-01-31',1),careProjections([e('worming','2026-11-12')],now)[0].due,careProjections([e('flea','2026-11-12','2027-01-20')],now)[0].due,careProjections([e('vet','2026-11-12')],now).length,careProjections([e('flea','2026-11-12'),e('flea','2027-02-20')],now)[0].due];})()`);
  check(same(calc,['2027-02-28','2028-02-29','2028-02-29','2026-12-12','2027-01-20',0,'2027-05-20']),'Care: calendar clamping, defaults, override, nonrecurring and late completion');
  await click(frame,'#care-page-tab');
  for(const category of ['worming','flea','vaccination','vet','medication','other']) {
    await click(frame,'#record-care');const f=d.getElementById('event-form');
    f.elements.careCategory.value=category;f.elements.date.value='2026-01-31';f.elements.careProduct.value='Treatment';f.elements.nextDue.value='2026-06-20';
    await click(frame,'#event-form button[type="submit"]');
    const event=state(frame).events.at(-1);
    check(event.type==='care'&&event.careCategory===category&&event.nextDue==='2026-06-20',`Care: ${category} persists through shared editor`);
    await click(frame,`#care-history [data-id="${event.id}"]`);f.elements.note.value='Edited';await click(frame,'#event-form button[type="submit"]');
    check(state(frame).events.at(-1).note==='Edited',`Care: ${category} edit persists`);
  }
  const saved=state(frame);await reload(frame);
  check(same(state(frame),saved)&&d!==frame.contentDocument,'Care: actual records survive reload');
  await click(frame,'#data-page-tab');
  check(frame.contentDocument.querySelectorAll('#data tbody tr').length===6&&(await databaseContents()).events.length===6,'Care: projections never appear as Data or database rows');
  await importBackup(frame,{version:2,demoCleared:true,events:saved.events});
  check(same(state(frame).events,saved.events),'Care: JSON v2 round trip preserves actuals and overrides');
  await click(frame,`#data [data-id="${saved.events[0].id}"]`);await click(frame,'#delete-event');
  check(state(frame).events[0].deletedAt!==null,'Care: shared delete retains tombstone');
  frame.remove();
}
