'use strict';

// Stage 5A uses real native IndexedDB, including upgrade rollback and binding CAS.
async function modelMigrationChecks() {
  const instant='2026-10-07T08:00:00.000Z';
  const old={version:2,demoCleared:true,events:known.events.map((event,i)=>({...event,createdAt:instant,updatedAt:instant,deletedAt:i===2?instant:null,mutationId:'old-'+i}))};
  await reset();await seedStage2(old,2);let frame=await start();const saved=state(frame), database=await databaseContents();
  check(database.version===4 && saved.version===4 && saved.householdId===null && saved.events.every(e=>e.serverVersion===null && e.syncBaseMutationId===null),'J: version 2 database atomically upgrades to version 4 with null sync baselines and server versions and binding');
  check(same(saved.events.map(({serverVersion,syncBaseMutationId,...event})=>event),old.events) && saved.demoCleared===old.demoCleared,'J: upgrade preserves legacy IDs, content, timestamps, mutations, tombstones and order');
  await reset();await seedStage2(old,2);const before=await databaseContents();
  frame=await start("const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value){const req=add.call(this,value);req.addEventListener('success',()=>this.transaction.abort(),{once:true});return req;};");
  check(blocked(frame) && same(await databaseContents(),before),'J: failed version 2 -> 4 migration rolls back database version and all data');
  await reload(frame);check(state(frame).events.every(e=>e.serverVersion===null && e.syncBaseMutationId===null),'J: rolled-back migration remains recoverable on reload');
}
async function modelChecks(frame) {
  const before=state(frame), household='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check(before.householdId===null && (await databaseContents()).meta.some(m=>m.key==='householdId' && m.value===null),'J: fresh local cache starts unbound');
  await click(frame,'[data-add="wee"]');let event=state(frame).events.at(-1);
  check(uuid.test(event.id) && event.serverVersion===null,'J: new local events have UUIDs and null serverVersion');
  const win=frame.contentWindow, original=win.crypto.randomUUID;
  Object.defineProperty(win.crypto,'randomUUID',{value:undefined,configurable:true});
  try {check(uuid.test(win.eval('uniqueId()')),'J: cryptographic fallback produces RFC 4122 version 4 UUIDs');}
  finally {Object.defineProperty(win.crypto,'randomUUID',{value:original,configurable:true});}
  await importBackup(frame,{version:2,demoCleared:true,events:[{...event,serverVersion:7,syncBaseMutationId:event.mutationId}]});
  await click(frame,`#timeline [data-id="${event.id}"]`);frame.contentDocument.getElementById('event-form').elements.note.value='preserve server version';
  await click(frame,'#event-form button[type="submit"]');
  check(state(frame).events[0].serverVersion===7 && state(frame).events[0].syncBaseMutationId===event.mutationId && state(frame).events[0].mutationId!==event.mutationId,'J: local edit preserves accepted serverVersion and baseline while generating a new mutation');
  await click(frame,`#timeline [data-id="${event.id}"]`);await click(frame,'#delete-event');await reload(frame);
  check(state(frame).events[0].serverVersion===7 && state(frame).events[0].deletedAt!==null && state(frame).events[0].syncBaseMutationId===event.mutationId,'J: tombstone and reload preserve serverVersion and baseline');
  const oldBackup={version:2,demoCleared:true,events:before.events.map(({serverVersion,...record})=>record)};
  await importBackup(frame,oldBackup);
  check(state(frame).events.every(e=>e.serverVersion===null && e.syncBaseMutationId===null),'J: older version 2 JSON without serverVersion restores as null');
  let invalid=false;try{win.validateEvents([{...event,serverVersion:1.5}]);}catch{invalid=true;}
  check(invalid,'J: serverVersion rejects invalid non-integer versions');
  // Test the repository binding guard independently from background sync.
  let authFrame=await start(cloudFixture,true);
  await waitFor(()=>authFrame.contentDocument.getElementById('cloud-status').textContent==='Cloud access: Ready','binding discovery');
  const records=(await databaseContents()).events;
  await authFrame.contentWindow.eval(`diaryRepository.bindHousehold('${household}')`);await authFrame.contentWindow.refreshStore();await authFrame.contentWindow.eval('mutationQueue');
  check(state(authFrame).householdId===household && same((await databaseContents()).events,records),'J: binding null -> household UUID changes metadata only');
  const boundDB=await databaseContents();
  await authFrame.contentWindow.eval(`diaryRepository.bindHousehold('${household}')`);
  check(same(await databaseContents(),boundDB),'J: binding the same household is idempotent');
  let refused=false;try{await authFrame.contentWindow.eval(`diaryRepository.bindHousehold('${other}')`);}catch{refused=true;}
  check(refused && same(await databaseContents(),boundDB),'J: a different household binding is refused without erasing or rebinding data');
  const fixture=authFrame.contentWindow.authFixture;fixture.online=false;authFrame.contentWindow.dispatchEvent(new authFrame.contentWindow.Event('offline'));
  await click(authFrame,'[data-add="wee"]');
  check(state(authFrame).householdId===household,'J: offline local recording retains the household binding');
  fixture.online=true;authFrame.contentWindow.dispatchEvent(new authFrame.contentWindow.Event('online'));
  await click(authFrame,'#auth-action');await waitFor(()=>!authFrame.contentWindow.bellaAuth.getUser(),'signed-out binding');
  await click(authFrame,'[data-add="meal"]');
  check(state(authFrame).householdId===household && (await databaseContents()).meta.some(m=>m.key==='householdId'&&m.value===household),'J: signed-out local use keeps the binding');
  authFrame.remove();
  const otherFixture=cloudFixture+`cloudFixture.householdId='${other}';`;
  authFrame=await start(otherFixture,true);await waitFor(()=>authFrame.contentDocument.getElementById('cloud-status').textContent==='Cloud access: Ready','mismatch discovery');
  check(authFrame.contentDocument.getElementById('binding-status').textContent.includes('Household mismatch') && !authFrame.contentDocument.getElementById('bind-household') && state(authFrame).householdId===household,'J: authenticated different-household user sees mismatch, with no switching or rebinding');authFrame.remove();
  // Restore test events via a stale pre-binding window: binding must survive saves/imports.
  await importBackup(frame,{version:2,demoCleared:before.demoCleared,events:before.events});
  check(state(frame).householdId===household && same(state(frame).events,before.events),'J: stale-window JSON restore preserves the authoritative household binding');
  authFrame=await start(cloudFixture,true);await waitFor(()=>authFrame.contentDocument.getElementById('cloud-status').textContent==='Cloud access: Ready','local mutation network check');
  const calls=authFrame.contentWindow.cloudFixture.calls.length;
  await click(authFrame,'[data-add="wee"]');
  check(authFrame.contentWindow.cloudFixture.calls.length===calls && authFrame.contentWindow.authFixture.creates===1,'J: local recording adds no automatic cloud calls or extra clients');
  authFrame.remove();await importBackup(frame,{version:2,demoCleared:before.demoCleared,events:before.events});
}
