'use strict';

// Only the SDK transport is stubbed; the app and transactional IndexedDB are real.
const syncFixture = cloudFixture + `
authFixture.user=null;
Object.assign(cloudFixture,{active:0,maxActive:0,pageSize:500});
window.cloudFrom=table=>{
  const f=cloudFixture,q={table,op:'select',filters:[]};
  const b={select(fields,options){q.fields=fields;q.options=options;return this;},eq(k,v){q.filters.push([k,v]);return this;},
    order(k){q.order=k;return this;},range(a,z){q.range=[a,z];return this;},limit(n){q.limit=n;return this;},single(){q.single=true;return this;},
    insert(row){q.op='insert';q.payload=structuredClone(row);return this;},update(row){q.op='update';q.payload=structuredClone(row);return this;},
    delete(){q.op='delete';return this;},abortSignal(signal){q.signal=signal;return this;},
    then(resolve,reject){f.calls.push(q);authFixture.cloudCalls++;return (async()=>{
      const normal=table==='diary_events' && (q.range || q.payload?.demo===false || q.filters.some(([k,v])=>k==='demo'&&v===false));
      if(normal){f.active++;f.maxActive=Math.max(f.maxActive,f.active);}
      try {
        if(q.range && f.pause){await new Promise(r=>{f.release=r;q.signal.addEventListener('abort',r,{once:true});});if(q.signal.aborted)return {error:{code:'aborted'}};}
        if(q.range && f.fail)return {error:{code:'outage',message:'private failure'}};
        if(table==='household_members')return {data:Array.from({length:f.households},()=>({household_id:f.householdId||'00000000-0000-4000-8000-000000000001'}))};
        if(table==='households')return {data:[{id:f.householdId||'00000000-0000-4000-8000-000000000001',name:'Bella'}]};
        const match=row=>q.filters.every(([k,v])=>row[k]===v);
        if(q.op==='insert'){
          if(f.duplicate){f.rows.set(q.payload.id,{...q.payload,server_version:1});f.duplicate=false;}
          if(f.rows.has(q.payload.id))return {error:{code:'23505'}};
          const row={...q.payload,server_version:1};f.rows.set(row.id,row);return {data:structuredClone(row)};
        }
        if(q.op==='update'){
          const id=q.filters.find(([k])=>k==='id')[1],row=f.rows.get(id);
          if(f.race){f.race=false;f.rows.set(id,{...row,note:'other device won',mutation_id:'other-race',server_version:row.server_version+1});}
          const current=f.rows.get(id);if(!current || !match(current))return {data:[]};
          const next={...current,...q.payload,server_version:current.server_version+1};f.rows.set(id,next);return {data:[structuredClone(next)]};
        }
        let rows=Array.from(f.rows.values()).filter(match).sort((a,b)=>a.id.localeCompare(b.id));const count=rows.length;
        if(q.range)rows=rows.slice(q.range[0],Math.min(q.range[1]+1,q.range[0]+f.pageSize));else if(q.limit)rows=rows.slice(0,q.limit);
        return {data:structuredClone(rows),count};
      } finally {if(normal)f.active--;}
    })().then(resolve,reject);}
  };return b;
};
`;
async function syncChecks() {
  await automaticBindingChecks();
  await activeReturnChecks();
  const household='00000000-0000-4000-8000-000000000001', id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const instant='2026-10-07T08:00:00.000Z';
  const event=(n,extra={})=>({id:id(n),type:'wee',datetime:'2026-10-07T08:00',note:'record '+n,location:'outside',createdAt:instant,updatedAt:instant,deletedAt:null,mutationId:'local-'+n,serverVersion:null,syncBaseMutationId:null,...extra});
  const row=(e,version=1)=>({id:e.id,household_id:household,type:e.type,datetime:e.datetime,note:e.note,location:e.location??null,poo_consistency:e.pooConsistency??null,meal_food:e.mealFood??null,meal_amount:e.mealAmount??null,demo:e.demo===true,client_created_at:e.createdAt,client_updated_at:e.updatedAt,deleted_at:e.deletedAt,mutation_id:e.mutationId,server_version:version});
  await reset();await seedStage2({version:4,householdId:household,demoCleared:true,syncConflicts:[],events:[event(10),event(11,{demo:true}),event(12,{id:'legacy-id'})]},4);
  let frame=await start(syncFixture,true,'https://auth-fixture.invalid',true),win=frame.contentWindow,f=win.cloudFixture,a=win.authFixture;
  const text=()=>frame.contentDocument.getElementById('sync-status').textContent;
  const native=async()=>await win.eval('diaryRepository.load(upgradeStore)');
  const settle=async()=>{await waitFor(()=>!frame.contentDocument.getElementById('sync-now').disabled,'sync finishes');await delay(30);await win.eval('mutationQueue');};
  const run=async()=>{await click(frame,'#sync-now');await settle();};
  const replace=async events=>{await win.eval('diaryRepository.transact(saved=>({...saved,events:'+JSON.stringify(events)+',syncConflicts:[]}))');await win.refreshStore();await win.eval('mutationQueue');};
  const signIn=()=>a.emit('SIGNED_IN',{id:'fixture-user',email:'sync@example.invalid'});
  check(f.calls.length===0 && text()==='Sign in to sync','K: signed-out startup never syncs');
  a.online=false;win.dispatchEvent(new win.Event('offline'));signIn();await delay(80);
  check(f.calls.length===0 && text().startsWith('Offline'),'K: offline sign-in leaves cloud untouched and local diary available');
  a.online=true;f.householdId=id(2);win.dispatchEvent(new win.Event('online'));await settle();
  check(text().includes('mismatch') && !f.calls.some(c=>c.range||c.payload),'K: household mismatch stops sync before snapshot or writes');
  f.householdId=household;await run();let local=await native();
  check(f.rows.has(id(10)) && !f.rows.has(id(11)) && !f.rows.has('legacy-id') && text().includes('non-UUID'),'K: valid unsynced event inserts; local demos/non-UUIDs stay local with a warning');
  check(local.events[0].serverVersion===1 && local.events[0].syncBaseMutationId==='local-10' && local.events[0].mutationId==='local-10','K: insert accepts version and mutation baseline without changing mutation');
  check(local.events[0].createdAt===instant && local.events[0].updatedAt===instant,'K: syncing does not alter client timestamps or content');
  check(f.calls.filter(c=>c.payload).every(c=>!('server_version' in c.payload)&&!('server_updated_at' in c.payload)) && a.creates===1,'K: single Auth client reused; normal payloads omit server-generated values');
  f.rows.set(id(20),row(event(20)));f.rows.set(id(21),row(event(21,{deletedAt:instant})));f.rows.set(id(22),row(event(22,{demo:true})));await run();local=await native();
  check(local.events.find(e=>e.id===id(20))?.syncBaseMutationId==='local-20' && !local.events.some(e=>e.id===id(22)),'K: cloud-only event downloads clean; diagnostic demo is excluded');
  check(local.events.find(e=>e.id===id(21))?.deletedAt===instant && !frame.contentDocument.querySelector('[data-id="'+id(21)+'"]'),'K: cloud tombstone downloads and remains hidden');
  await click(frame,'#timeline [data-id="'+id(10)+'"]');frame.contentDocument.getElementById('event-form').elements.note.value='edited locally';await click(frame,'#event-form button[type="submit"]');await settle();local=await native();
  const edited=local.events.find(e=>e.id===id(10)),update=f.calls.find(c=>c.op==='update');
  check(edited.note==='edited locally' && edited.serverVersion===2 && edited.syncBaseMutationId===edited.mutationId,'K: local edit pushes and becomes clean at incremented version');
  check(update.filters.some(([k,v])=>k==='server_version'&&v===1)&&update.filters.some(([k,v])=>k==='household_id'&&v===household)&&update.filters.some(([k,v])=>k==='id'&&v===id(10)),'K: optimistic update is constrained by ID, household and expected server version');
  await click(frame,'#timeline [data-id="'+id(10)+'"]');await click(frame,'#delete-event');await settle();local=await native();
  check(local.events.find(e=>e.id===id(10)).serverVersion===3 && f.rows.get(id(10)).deleted_at!==null && !f.calls.some(c=>c.op==='delete'),'K: local tombstone propagates through UPDATE only');
  const clean20=local.events.find(e=>e.id===id(20));f.rows.set(id(20),row({...clean20,note:'cloud edit',mutationId:'cloud-20'},2));await run();
  check((await native()).events.find(e=>e.id===id(20)).note==='cloud edit','K: clean local event accepts advanced cloud content and baseline');
  f.rows.set(id(20),row({...clean20,deletedAt:instant,mutationId:'cloud-delete'},3));await run();
  check((await native()).events.find(e=>e.id===id(20)).deletedAt===instant,'K: cloud tombstone refreshes a clean local event without resurrection');
  // Unknown imported baselines may become clean only through exact equivalence.
  await replace([event(30,{serverVersion:1}),event(31,{serverVersion:1,note:'unknown local edit'})]);f.rows.clear();f.rows.set(id(30),row(event(30)));f.rows.set(id(31),row(event(31,{note:'cloud different'})));await run();local=await native();
  check(local.events[0].syncBaseMutationId==='local-30' && local.syncConflicts.some(c=>c.id===id(31)) && local.events[1].note==='unknown local edit','K: missing imported baseline proves equivalence or conservatively retains a conflict');
  // A stale CAS must preserve both copies, even though the snapshot matched.
  await replace([event(40,{serverVersion:1,syncBaseMutationId:'base-40',mutationId:'edited-40',note:'my edit'})]);f.rows.clear();f.rows.set(id(40),row(event(40,{mutationId:'base-40'})));f.race=true;await run();local=await native();
  check(local.syncConflicts.length===1 && local.events[0].note==='my edit' && local.syncConflicts[0].cloud.note==='other device won','K: zero-row conditional update stores conflict and preserves both versions');
  const originalClick=win.HTMLAnchorElement.prototype.click;let backup;
  win.HTMLAnchorElement.prototype.click=function(){backup=win.fetch(this.href).then(r=>r.json());};await click(frame,'#export-json');win.HTMLAnchorElement.prototype.click=originalClick;const exported=await backup;
  check(exported.events[0].note==='my edit' && exported.syncConflicts[0].cloud.note==='other device won','K: JSON backup contains the local edit and retained cloud conflict copy');
  await importBackup(frame,exported);await settle();check((await native()).syncConflicts.length===1,'K: JSON restore retains conflict protection');
  const writes=f.calls.filter(c=>c.op==='update').length;await run();
  check(f.calls.filter(c=>c.op==='update').length===writes && f.rows.get(id(40)).note==='other device won' && text().includes('needs attention'),'K: conflicted event stops automatic updates; newer cloud copy is not overwritten');
  await replace([event(41,{serverVersion:1,syncBaseMutationId:'base-41',mutationId:'edited-41',note:'offline edit'})]);f.rows.clear();f.rows.set(id(41),row(event(41,{mutationId:'cloud-41',note:'online edit'}),2));await run();
  check((await native()).events[0].note==='offline edit' && (await native()).syncConflicts.length===1,'K: advanced cloud version conflicts with dirty local payload; mutation ordering is irrelevant');
  // Ambiguous inserts recover by equivalence, never by blind overwrite.
  await replace([event(50)]);f.rows.clear();f.duplicate=true;await run();
  check((await native()).events[0].serverVersion===1 && !(await native()).syncConflicts.length,'K: duplicate insert race can establish an equivalent accepted baseline');
  await replace([event(51)]);f.rows.set(id(51),row(event(51,{note:'existing cloud'})));await run();
  check((await native()).events[0].note==='record 51' && (await native()).syncConflicts.length===1,'K: same-ID unsynced collision preserves local and cloud payloads');
  // Failed fetch leaves the user's committed mutation intact; reconnect retries.
  await replace([]);f.rows.clear();f.fail=true;await click(frame,'[data-add="wee"]');await settle();const failed=await native();
  check(failed.events.length===1 && failed.events[0].serverVersion===null && text().startsWith('Sync issue') && a.user,'K: outage keeps local save and identity intact');
  const beforeFailure=await databaseContents();await run();check(same(await databaseContents(),beforeFailure),'K: failed reconciliation has no partial IndexedDB merge');
  f.fail=false;a.online=false;win.dispatchEvent(new win.Event('offline'));a.online=true;win.dispatchEvent(new win.Event('online'));await settle();
  check((await native()).events[0].serverVersion===1 && text()==='Synced','K: reconnect retries a committed offline/failed edit successfully');
  // Real local save while a request is stalled; merge latest IDB, not stale UI.
  f.pause=true;win.bellaSync.request();await waitFor(()=>f.release,'paused snapshot');await click(frame,'[data-add="poo"]');
  const during=await native();check(during.events.length===2 && during.events[1].serverVersion===null,'K: quick record commits locally while cloud request is pending');
  win.bellaSync.request();win.bellaSync.request();f.pause=false;f.release();await settle();
  check((await native()).events.length===2 && (await native()).events.every(e=>e.serverVersion===1) && f.maxActive===1,'K: overlapping triggers serialize and queued cycle preserves in-flight new entry');
  // An edit after snapshot capture but before accepted INSERT advances the old
  // base without replacing the new mutation; queued cycle then pushes it.
  await replace([event(60)]);f.rows.clear();f.release=null;f.pause=true;win.bellaSync.request();await waitFor(()=>f.release,'paused insert snapshot');
  await win.eval("diaryRepository.transact(saved=>({...saved,events:saved.events.map(e=>({...e,note:'later local edit',mutationId:'later-60'}))}))");win.bellaSync.request();f.pause=false;f.release();await settle();
  check((await native()).events[0].note==='later local edit' && (await native()).events[0].serverVersion===2 && f.rows.get(id(60)).note==='later local edit','K: accepted earlier mutation cannot overwrite an edit committed during network I/O');
  // Rollback the entire cloud merge on a native write failure.
  await replace([]);f.rows.clear();f.rows.set(id(70),row(event(70)));const beforeRollback=await databaseContents();
  win.eval("window.savedAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value){const req=savedAdd.call(this,value);req.addEventListener('success',()=>this.transaction.abort(),{once:true});return req;};");await run();
  check(same(await databaseContents(),beforeRollback) && text().startsWith('Sync issue'),'K: failed cloud merge rolls back all event and metadata changes');win.eval('IDBObjectStore.prototype.add=savedAdd');await run();
  check((await native()).events[0].id===id(70),'K: rolled-back cloud pull recovers on manual Sync now');
  f.rows.clear();for(let n=80;n<85;n++)f.rows.set(id(n),row(event(n)));f.pageSize=2;await run();
  check((await native()).events.filter(e=>Number(e.id.slice(-12))>=80).length===5 && f.calls.filter(c=>c.range).some(c=>c.range[0]===4),'K: full snapshot pagination handles a server row cap below requested page size');
  // Account changes cancel the old cycle without losing the new sign-in trigger.
  f.pause=true;f.release=null;win.bellaSync.request();await waitFor(()=>f.release,'account-change snapshot');
  const beforeAccount=f.calls.filter(c=>c.range).length;a.emit('SIGNED_OUT',null);f.pause=false;signIn();await settle();
  check(!text().startsWith('Sync issue') && f.calls.filter(c=>c.range).length>beforeAccount && a.creates===1,'K: account change aborts old work and drains the newly signed-in trigger with the same client');
  for(const count of [0,2]){f.households=count;const requests=f.calls.filter(c=>c.range||c.payload).length;await run();check(f.calls.filter(c=>c.range||c.payload).length===requests,'K: zero/multiple membership blocks normal snapshot and writes');}f.households=1;
  // Native versionchange migration conservatively adds the sole baseline field.
  frame.remove();await reset();const legacy=event(90,{serverVersion:7});delete legacy.syncBaseMutationId;await seedStage2({version:3,householdId:household,demoCleared:true,events:[legacy]},3);frame=await start();
  check(state(frame).version===4 && state(frame).householdId===household && state(frame).events[0].serverVersion===7 && state(frame).events[0].syncBaseMutationId===null,'K: version 3 upgrade retains binding/content and gives previously versioned records an unknown baseline');
  frame.remove();
}

async function automaticBindingChecks() {
  const household='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000099',instant='2026-10-07T08:00:00.000Z';
  const event={id,type:'wee',datetime:'2026-10-07T08:00',location:'outside',note:'automatic binding',createdAt:instant,updatedAt:instant,deletedAt:null,mutationId:'first-sign-in',serverVersion:null,syncBaseMutationId:null};
  await reset();await seedStage2({version:4,householdId:null,demoCleared:true,syncConflicts:[],events:[event]},4);
  let frame=await start(syncFixture,true,'https://auth-fixture.invalid',true),win=frame.contentWindow,f=win.cloudFixture,a=win.authFixture;
  const saved=()=>win.eval('diaryRepository.load(upgradeStore)');
  const finished=async()=>{await waitFor(()=>!frame.contentDocument.getElementById('sync-now').disabled,'automatic binding cycle');await delay(30);await win.eval('mutationQueue');};
  check(!blocked(frame) && state(frame).events[0].note===event.note && (await saved()).householdId===null,'L: unbound signed-out startup loads local diary without binding or network');
  let refused=false;try{await win.eval(`diaryRepository.bindHousehold('${household}',()=>false)`);}catch{refused=true;}
  check(refused && (await saved()).householdId===null && same((await saved()).events,[event]),'L: expired auth/online context refuses first binding without changing local data');
  for(const count of [0,2]) {
    f.households=count;a.emit('SIGNED_IN',{id:'fixture-user'});win.bellaSync.request();await finished();
    check((await saved()).householdId===null && f.rows.size===0,'L: '+count+' households never bind or sync an unbound diary');
  }
  a.online=false;win.dispatchEvent(new win.Event('offline'));f.households=1;win.bellaSync.request();await delay(30);
  check((await saved()).householdId===null && same((await saved()).events,[event]),'L: offline unbound diary keeps its data and remains unbound');
  a.emit('SIGNED_OUT',null);a.online=true;a.emit('SIGNED_IN',{id:'fixture-user'});await finished();let local=await saved();
  check(local.householdId===household && f.rows.get(id)?.note===event.note && local.events[0].serverVersion===1 && a.creates===1,'L: first successful single-household sign-in automatically binds and immediately syncs using the existing client');
  check(!frame.contentDocument.getElementById('bind-household') && local.events[0].syncBaseMutationId===event.mutationId,'L: redundant manual Link control is removed; first sync accepts the mutation baseline');
  frame.remove();
  frame=await start(syncFixture+"authFixture.user={id:'fixture-user'};",true,'https://auth-fixture.invalid',true);win=frame.contentWindow;
  await waitFor(()=>frame.contentDocument.getElementById('sync-status').textContent.includes('attention'),'already-bound startup reconciliation');
  check((await win.eval('diaryRepository.load(upgradeStore)')).householdId===household && win.cloudFixture.calls.some(c=>c.range) && win.authFixture.creates===1,'L: already-bound authenticated startup reconciles in the background without user action');
  frame.remove();
}

async function activeReturnChecks() {
  const household='00000000-0000-4000-8000-000000000001',instant='2026-10-08T08:00:00.000Z';
  await reset();await seedStage2({version:4,householdId:household,demoCleared:true,syncConflicts:[],events:[]},4);
  const frame=await start(syncFixture+"Object.defineProperty(document,'visibilityState',{get:()=>cloudFixture.visibility||'visible'});",true,'https://auth-fixture.invalid',true);
  const win=frame.contentWindow,f=win.cloudFixture,a=win.authFixture;
  const snapshotCount=()=>f.calls.filter(c=>c.range).length;
  const settled=async()=>{await waitFor(()=>!frame.contentDocument.getElementById('sync-now').disabled,'active-return sync finishes');await delay(30);await win.eval('mutationQueue');};
  const visible=()=>frame.contentDocument.dispatchEvent(new win.Event('visibilitychange'));
  const focus=()=>win.dispatchEvent(new win.Event('focus'));
  const row=n=>({id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),household_id:household,type:'wee',datetime:'2026-10-08T08:00',location:'outside',note:'other device '+n,poo_consistency:null,meal_food:null,meal_amount:null,demo:false,client_created_at:instant,client_updated_at:instant,deleted_at:null,mutation_id:'remote-'+n,server_version:1});
  a.emit('SIGNED_IN',{id:'fixture-user'});await settled();let count=snapshotCount();
  f.visibility='hidden';visible();await delay(30);
  check(snapshotCount()===count,'M: hiding the tab does not trigger sync');
  const first=row(101);f.rows.set(first.id,first);f.visibility='visible';visible();await settled();
  check(snapshotCount()===count+1 && state(frame).events.some(e=>e.id===first.id),'M: returning to a visible tab syncs and displays another device entry');
  count=snapshotCount();const second=row(102);f.rows.set(second.id,second);focus();await settled();
  check(snapshotCount()===count+1 && state(frame).events.some(e=>e.id===second.id),'M: window focus syncs and displays another device entry');
  count=snapshotCount();f.pause=true;f.release=null;focus();visible();focus();
  await waitFor(()=>f.release,'paused active-return sync');visible();focus();f.pause=false;f.release();await settled();
  check(snapshotCount()===count+1 && f.maxActive===1,'M: paired/repeated focus and visibility events share one scheduled/in-flight cycle');
  a.online=false;win.dispatchEvent(new win.Event('offline'));const offlineCalls=f.calls.length;focus();visible();await delay(30);
  check(f.calls.length===offlineCalls && state(frame).events.length===2,'M: offline activation makes no cloud calls and keeps the local diary');
  a.emit('SIGNED_OUT',null);a.online=true;const signedOutCalls=f.calls.length;focus();visible();await delay(30);
  check(f.calls.length===signedOutCalls && state(frame).events.length===2,'M: signed-out activation makes no cloud calls and keeps the local diary');
  f.householdId='00000000-0000-4000-8000-000000000002';a.emit('SIGNED_IN',{id:'fixture-user'});await settled();count=snapshotCount();
  focus();visible();await settled();
  check(snapshotCount()===count && state(frame).householdId===household && frame.contentDocument.getElementById('sync-status').textContent.includes('mismatch'),'M: activation on household mismatch never pulls, writes or rebinds');
  check(a.creates===1,'M: active-return triggers reuse the sole existing Auth client');
  frame.remove();
}
