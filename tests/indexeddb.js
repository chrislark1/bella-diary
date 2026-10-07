'use strict';

// Run the production app against real browser IndexedDB on an isolated origin.
const results = document.getElementById('results'), frames = document.getElementById('frames');
const KEY = 'bellaDiary.store';
const known = {version:1, demoCleared:true, events:[
  {id:'z-wee', type:'wee', datetime:'2026-10-05T08:01', note:'Keep me', location:'outside'},
  {id:'a-meal', type:'meal', datetime:'2026-10-06T07:30', note:'Breakfast', mealFood:'Kibble', mealAmount:'80 g'},
  {id:'m-poo', type:'poo', datetime:'2026-10-06T08:01', note:'Accident', location:'inside', pooConsistency:'Normal'}
]};
let passed = 0, onlineFrame;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function check(condition, label) {
  if (!condition) throw new Error(label);
  results.textContent += `\nPASS ${++passed}: ${label}`;
}
async function waitFor(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {if (await predicate()) return; await delay(25);}
  throw new Error(`Timed out: ${label}`);
}
function requestValue(request) {
  return new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Test database blocked'));});
}
async function databaseContents() {
  const db = await requestValue(indexedDB.open('bellaDiary'));
  try {
    const transaction = db.transaction(['events','meta']);
    const done = new Promise((resolve,reject) => {transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);});
    const [events,meta] = await Promise.all([requestValue(transaction.objectStore('events').getAll()),requestValue(transaction.objectStore('meta').getAll()),done]);
    return {version:db.version,events,meta};
  } finally {db.close();}
}
function originalFields(event) {
  const {createdAt,updatedAt,deletedAt,mutationId,serverVersion,syncBaseMutationId,...fields} = event; return fields;
}
function upgradedKnown(saved) {
  return saved.version===4 && saved.demoCleared===known.demoCleared && same(saved.events.map(originalFields),known.events);
}
function validMetadata(event) {
  return ['createdAt','updatedAt'].every(key=>typeof event[key]==='string' && new Date(event[key]).toISOString()===event[key]) && event.updatedAt>=event.createdAt && (event.deletedAt===null || (new Date(event.deletedAt).toISOString()===event.deletedAt && event.deletedAt<=event.updatedAt)) && /^[a-z0-9-]{1,200}$/.test(event.mutationId);
}
async function seedStage2(saved, databaseVersion = 1) {
  const request=indexedDB.open('bellaDiary',databaseVersion);
  request.onupgradeneeded=()=>{request.result.createObjectStore('events',{keyPath:'id'});request.result.createObjectStore('meta',{keyPath:'key'});};
  const db=await requestValue(request);
  try {
    const tx=db.transaction(['events','meta'],'readwrite');
    const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    saved.events.forEach(event=>tx.objectStore('events').add(event));
    for (const [key,value] of Object.entries({schemaVersion:databaseVersion,demoCleared:saved.demoCleared,eventOrder:saved.events.map(e=>e.id),initialized:true,...(databaseVersion>=3?{householdId:saved.householdId}:{}),...(databaseVersion>=4?{syncConflicts:saved.syncConflicts}: {})})) tx.objectStore('meta').put({key,value});
    await done;
  } finally {db.close();}
}
async function importBackup(frame, data) {
  const win=frame.contentWindow, input=frame.contentDocument.getElementById('import-file'), transfer=new win.DataTransfer();
  transfer.items.add(new win.File([JSON.stringify(data)],'backup.json',{type:'application/json'}));
  input.files=transfer.files; input.dispatchEvent(new win.Event('change',{bubbles:true}));
  await waitFor(()=>input.value==='','import completes'); await win.eval('mutationQueue');
}

async function reset(legacy) {
  frames.replaceChildren();
  await requestValue(indexedDB.deleteDatabase('bellaDiary'));
  localStorage.removeItem(KEY); localStorage.removeItem('bellaDiary.aggregateWindow');
  if (legacy !== undefined) localStorage.setItem(KEY,legacy);
}
function state(frame) {return JSON.parse(frame.contentWindow.eval('JSON.stringify(store)'));}
async function loaded(frame) {
  await waitFor(()=>frame.contentDocument?.querySelector('#summary .metric'),'app startup');
  frame.contentWindow.confirm=()=>true; // Confirm only disposable test data operations.
  return frame;
}
async function start(inject = '', authConfigured = false, projectURL = 'https://auth-fixture.invalid', syncEnabled = false) {
  let html = await (await fetch('../index.html')).text();
  // Keep auth fixtures isolated even after the real config placeholders are filled.
  const config=authConfigured
    ? `<script>const SUPABASE_URL=${JSON.stringify(projectURL)};const SUPABASE_PUBLISHABLE_KEY="sb_publishable_test_placeholder";<\/script>`
    : '<script>const SUPABASE_URL="__SUPABASE_URL__";const SUPABASE_PUBLISHABLE_KEY="__SUPABASE_PUBLISHABLE_KEY__";<\/script>';
  html=html.replace('<script src="supabase-config.js" defer></script>',config);
  if (!syncEnabled) html=html.replace('<script src="sync.js" defer></script>','');
  const frame = document.createElement('iframe');
  frame.srcdoc = html.replace('<head>',`<head><base href="${location.origin}/"><script>window.confirm=()=>true;${inject}<\/script>`);
  frames.append(frame);
  return loaded(frame);
}
async function reload(frame, suffix = '') {
  frame.removeAttribute('srcdoc');
  frame.src = `/index.html?acceptance=${Date.now()}${suffix}`;
  await new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
  return loaded(frame);
}
async function click(frame, selector) {
  frame.contentDocument.querySelector(selector).click();
  await frame.contentWindow.eval('mutationQueue');
}
function blocked(frame) {return frame.contentWindow.eval('storageBlocked');}
function fail(error) {results.textContent += `\nFAIL: ${error.stack || error}`;document.getElementById('run').disabled=false;}

async function run() {
  if (location.origin !== 'http://127.0.0.1:8137') throw new Error('Use the disposable test origin http://127.0.0.1:8137 only.');
  document.getElementById('run').disabled=true; document.getElementById('offline').hidden=true;
  results.textContent='Running native IndexedDB checks…'; passed=0;
  // Ensure reruns use current shell files rather than a previous test worker.
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) if (key.startsWith('bellas-diary-shell-')) await caches.delete(key);

  await modelMigrationChecks();
  const legacy=JSON.stringify(known,null,2);
  await reset(legacy); await seedStage2(known); let frame=await start();
  let upgraded=state(frame), upgradedDB=await databaseContents();
  check(upgradedDB.version===4 && upgradedDB.meta.some(m=>m.key==='schemaVersion' && m.value===4),'A: database and diary schema upgrade from 1 to 4');
  check(upgradedKnown(upgraded),'A: Stage 2 upgrade preserves IDs, local diary times, order and fields');
  check(upgraded.events.every(e=>validMetadata(e) && e.createdAt===e.updatedAt && e.deletedAt===null) && new Set(upgraded.events.map(e=>e.createdAt)).size===1,'A: migration assigns one UTC instant and valid change IDs');
  check(localStorage.getItem(KEY)===legacy,'A: schema upgrade preserves legacy rollback snapshot');
  await reload(frame);check(same(state(frame),upgraded),'A: loading and rendering do not retimestamp records');
  await reset(legacy); await seedStage2(known);
  const beforeUpgradeFailure=await databaseContents();
  frame=await start("const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value){const req=add.call(this,value);req.addEventListener('success',()=>this.transaction.abort(),{once:true});return req;};");
  check(blocked(frame) && same(await databaseContents(),beforeUpgradeFailure),'A: failed schema migration rolls back version, events and metadata');
  await reload(frame);check(upgradedKnown(state(frame)),'A: previous valid database remains recoverable after migration failure');
  await reset(legacy); frame=await start();
  check(upgradedKnown(state(frame)),'A: legacy events, fields and order load unchanged');
  let database=await databaseContents();
  check(database.events.length===3 && database.meta.some(m=>m.key==='initialized' && m.value===true),'A: validated diary committed to IndexedDB');
  check(localStorage.getItem(KEY)===legacy,'A: legacy snapshot remains byte-for-byte unchanged');
  await click(frame,'[data-add="wee"]');
  check((await databaseContents()).events.length===4,'A: new event stored in IndexedDB');
  check(localStorage.getItem(KEY)===legacy,'A: new event is not mirrored into legacy snapshot');
  const migrated=state(frame); await reload(frame);
  check(same(state(frame),migrated),'A: migrated diary and new event survive reload');
  localStorage.setItem(KEY,'{broken-after-migration'); await reload(frame);
  check(same(state(frame),migrated) && !blocked(frame),'A: initialized IndexedDB ignores corrupt legacy snapshot');

  await reset(); const starting=await Promise.all([start(),start()]); frame=starting[0];
  check(state(frame).events.every(e=>validMetadata(e) && e.deletedAt===null),'B: all demo events receive valid metadata');
  check(state(frame).events.length===98,'B: fresh origin seeds seven-day demo');
  check(same(state(starting[0]),state(starting[1])) && (await databaseContents()).events.length===98,'B: simultaneous first launches initialize once');
  const seeded=state(frame); await reload(frame);
  check(same(state(frame),seeded),'B: reload neither duplicates nor regenerates demo');
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#clear-demo');
  await reload(frame);
  check((await databaseContents()).events.length===0,'B: clearing demo physically purges its records');
  check(frame.contentDocument.getElementById('demo-label').hidden && frame.contentDocument.getElementById('clear-demo').hidden,'B: demo controls stay hidden after clearing/reload');
  check(state(frame).events.length===0 && state(frame).demoCleared,'B: cleared demo stays cleared after reload');
  check(localStorage.getItem(KEY)===null,'B: fresh IndexedDB diary creates no legacy localStorage copy');
  starting[1].remove();

  for (const [selector,type,location] of [
    ['[data-add="wee"]','wee','outside'],['[data-add="poo"]','poo','outside'],['[data-add="meal"]','meal',undefined],
    ['[data-add="wee"][data-location="inside"]','wee','inside'],['[data-add="poo"][data-location="inside"]','poo','inside']
  ]) {
    await click(frame,selector); const event=state(frame).events.at(-1); await reload(frame);
    check(validMetadata(event) && event.createdAt===event.updatedAt && event.deletedAt===null,`C: quick ${location || ''} ${type} gets creation metadata`);
    check(state(frame).events.some(e=>e.id===event.id && e.type===type && e.location===location),`C: quick ${location || ''} ${type} persists`);
  }
  const beforeRapid=state(frame).events.length;
  for (let i=0;i<8;i++) frame.contentDocument.querySelector('[data-add="wee"]').click();
  await frame.contentWindow.eval('mutationQueue'); await reload(frame);
  check(state(frame).events.length===beforeRapid+8,'C: rapid recording retains every tap');

  await click(frame,'#custom'); let form=frame.contentDocument.getElementById('event-form');
  form.elements.time.value='09:41'; form.elements.note.value='Custom acceptance record';
  await click(frame,'#event-form button[type="submit"]'); let custom=state(frame).events.at(-1); await reload(frame);
  check(state(frame).events.some(e=>e.id===custom.id && e.note==='Custom acceptance record'),'C: custom entry persists');
  check(validMetadata(custom) && custom.createdAt===custom.updatedAt && custom.deletedAt===null,'C: custom entry gets creation metadata');
  await delay(5);
  await click(frame,`#timeline [data-id="${custom.id}"]`); form=frame.contentDocument.getElementById('event-form');
  form.elements.note.value='Edited acceptance record'; await click(frame,'#event-form button[type="submit"]'); await reload(frame);
  const edited=state(frame).events.find(e=>e.id===custom.id);
  check(edited.note==='Edited acceptance record','C: edit persists');
  check(edited.createdAt===custom.createdAt && edited.updatedAt>custom.updatedAt && edited.deletedAt===null && edited.mutationId!==custom.mutationId,'C: edit preserves ID/creation and advances update/change ID');
  await click(frame,`#timeline [data-id="${custom.id}"]`); await click(frame,'#delete-event'); await reload(frame);
  const tombstone=state(frame).events.find(e=>e.id===custom.id);
  check(validMetadata(tombstone) && tombstone.deletedAt!==null && tombstone.deletedAt===tombstone.updatedAt && tombstone.createdAt===custom.createdAt && tombstone.mutationId!==edited.mutationId,'C: deletion retains valid tombstone after reload');
  check((await databaseContents()).events.some(e=>same(e,tombstone)),'C: tombstone remains in native IndexedDB');
  check(!frame.contentDocument.querySelector(`#timeline [data-id="${custom.id}"]`) && !frame.contentDocument.querySelector(`#data [data-id="${custom.id}"]`),'C: tombstone disappears from Timeline and Data');
  const active=state(frame).events.filter(e=>e.deletedAt===null);
  check(frame.contentWindow.eval('activeEvents().length')===active.length && frame.contentDocument.getElementById('aggregate-count').textContent.endsWith(`${active.length} events`),'C: active boundary excludes tombstone from aggregates');
  const jsonWithTombstone=state(frame);
  await importBackup(frame,jsonWithTombstone);await reload(frame);
  check(same(state(frame),jsonWithTombstone),'C: version 2 import restores tombstones and metadata unchanged');

  let win=frame.contentWindow;
  const input=frame.contentDocument.getElementById('import-file'), transfer=new win.DataTransfer();
  transfer.items.add(new win.File([JSON.stringify({version:1,events:known.events})],'backup.json',{type:'application/json'}));
  input.files=transfer.files; input.dispatchEvent(new win.Event('change',{bubbles:true}));
  await waitFor(()=>upgradedKnown(state(frame)),'JSON import'); await reload(frame);
  check(upgradedKnown(state(frame)) && state(frame).events.every(validMetadata),'C: version 1 JSON import upgrades and persists');
  const imported=state(frame);
  // Retain a tombstone for actual export checks.
  await click(frame,'#timeline [data-id="m-poo"]');await click(frame,'#delete-event');
  const exportState=state(frame);
  // Exercise real export controls and Blob generation without saving test files.
  win=frame.contentWindow; const downloads=[]; const originalClick=win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,text:win.fetch(this.href).then(response=>response.text())});};
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#export-json');
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#export-csv');
  win.HTMLAnchorElement.prototype.click=originalClick;
  const json=JSON.parse(await downloads[0].text), csv=await downloads[1].text;
  check(downloads[0].name.endsWith('.json') && same(Object.keys(json),['version','exportedAt','demoCleared','events']) && json.version===2 && json.demoCleared===exportState.demoCleared && same(json.events,exportState.events),'C: JSON v2 export preserves metadata, tombstones and event order');
  check(downloads[1].name.endsWith('.csv') && csv.startsWith('id,datetime,date,time,type,location,pooConsistency,mealFood,mealAmount,note\r\n') && csv.includes('"Kibble"'),'C: CSV export preserves columns and quoted fields');
  check(!csv.includes('m-poo') && csv.includes('z-wee'),'C: CSV excludes tombstones while keeping active events');
  await importBackup(frame,json);await reload(frame);check(same(state(frame),exportState),'C: actual JSON export restores losslessly');
  await importBackup(frame,imported);
  await click(frame,'[data-filter="wee"]'); check(frame.contentDocument.querySelectorAll('#timeline .event-mark').length===1,'C: timeline filter still works');
  await click(frame,'#data-tab'); check(!frame.contentDocument.getElementById('data').hidden && frame.contentDocument.querySelectorAll('#data tbody tr').length===1,'C: Data shares filter and event store');
  await click(frame,'#stats-page-tab'); check(!frame.contentDocument.getElementById('stats-page').hidden,'C: Stats still switches independently');
  await click(frame,'#diary-page-tab'); check(frame.contentDocument.querySelector('[data-filter="wee"]').getAttribute('aria-pressed')==='true' && !frame.contentDocument.getElementById('data').hidden,'C: returning to Diary preserves view and filter');
  const preference=frame.contentDocument.getElementById('aggregate-window'); preference.value='7';preference.dispatchEvent(new win.Event('change',{bubbles:true}));await reload(frame);
  check(localStorage.getItem('bellaDiary.aggregateWindow')==='7' && frame.contentDocument.getElementById('aggregate-window').value==='7','C: aggregate-window preference stays in localStorage');

  const peer=await start(); await click(frame,'[data-add="meal"]');
  await waitFor(()=>state(peer).events.length===state(frame).events.length,'BroadcastChannel refresh');
  check(same(state(peer),state(frame)),'C: BroadcastChannel refreshes another open window'); peer.remove();
  const fallback=await start('window.BroadcastChannel=undefined;');await click(frame,'[data-add="poo"]');
  fallback.contentWindow.dispatchEvent(new fallback.contentWindow.Event('focus')); await fallback.contentWindow.eval('mutationQueue');
  check(same(state(fallback),state(frame)),'C: focus reload works without BroadcastChannel');fallback.remove();

  const beforeFailure=state(frame), dbBefore=await databaseContents();
  const success=await frame.contentWindow.eval(`(async()=>{
    const add=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(value){const request=add.call(this,value);request.addEventListener('success',()=>this.transaction.abort(),{once:true});return request;};
    try {return await commit(events=>events.map(e=>({...e,note:'Should roll back',updatedAt:new Date().toISOString(),mutationId:uniqueId()})),false);}
    finally {IDBObjectStore.prototype.add=add;}
  })()`);
  check(success===false && same(state(frame),beforeFailure),'D: failed native IndexedDB write leaves memory unchanged');
  check(same(await databaseContents(),dbBefore),'D: transaction abort rolls back event and metadata changes together');
  await click(frame,'[data-add="wee"]');check(state(frame).events.length===beforeFailure.events.length+1,'D: later writes recover after aborted transaction');

  for (const raw of ['{broken','null',JSON.stringify({version:99,demoCleared:false,events:[]}),JSON.stringify({version:1,demoCleared:false,events:[{...known.events[0],datetime:'2026-02-30T08:00'}]})]) {
    await reset(raw);frame=await start();database=await databaseContents();
    check(blocked(frame) && localStorage.getItem(KEY)===raw && database.events.length===0 && database.meta.length===0 && state(frame).events.length===0,'D: malformed legacy diary is retained, blocked and never replaced by demo');
  }
  await reset(legacy);frame=await start("const nativeAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value){const request=nativeAdd.call(this,value);request.addEventListener('success',()=>this.transaction.abort(),{once:true});return request;};");
  database=await databaseContents();check(blocked(frame) && localStorage.getItem(KEY)===legacy && database.events.length===0 && database.meta.length===0,'D: aborted migration leaves legacy intact and IndexedDB uninitialized');
  await reload(frame);check(upgradedKnown(state(frame)),'D: reload can safely retry failed migration');
  for (const inject of ["Object.defineProperty(window,'indexedDB',{value:undefined});","indexedDB.open=()=>{throw new DOMException('Unavailable','SecurityError');};"]) {
    await reset(legacy);frame=await start(inject);check(blocked(frame) && state(frame).events.length===0 && localStorage.getItem(KEY)===legacy,'D: unavailable/failed database open blocks without seeding or changing legacy');
  }
  await reset(legacy);frame=await start();
  const readOnlyLegacy=await start("const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='bellaDiary.store')throw new Error('Legacy access denied');return get.call(this,key);};");
  check(upgradedKnown(state(readOnlyLegacy)),'D: initialized database loads even when legacy storage access fails');readOnlyLegacy.remove();

  // Reruns can retain an unregistered controller. Force a fresh test installation
  // instead of treating that old controller as proof of the current precache.
  await navigator.serviceWorker.register(`/sw.js?acceptance=${Date.now()}`);
  await navigator.serviceWorker.ready;
  const required=['/','/index.html','/styles.css','/storage.js','/app.js','/supabase-config.js','/auth.js','/cloud-diagnostic.js','/sync.js','/manifest.json','/icons/favicon.svg','/icons/icon-192.png','/icons/icon-512.png'];
  await waitFor(async()=>{const cache=await caches.open('bellas-diary-shell-v13');const paths=(await cache.keys()).map(request=>new URL(request.url).pathname);return required.every(path=>paths.includes(path));},'current shell precache completes');
  const cache=await caches.open('bellas-diary-shell-v13'), keys=(await cache.keys()).map(request=>new URL(request.url).pathname);
  check(required.every(path=>keys.includes(path)),'E: v13 cache includes every static shell file');
  check(keys.every(path=>required.includes(path)),'E: service worker caches shell only, not diary or tests');
  // Strict current schema: no implicit legacy defaults or invalid instants/order.
  const valid=state(frame).events[0];
  for (const change of [{createdAt:undefined},{updatedAt:'bad'},{deletedAt:undefined},{mutationId:''},{createdAt:'2026-02-30T00:00:00.000Z'},{updatedAt:'1900-01-01T00:00:00.000Z'},{deletedAt:'9999-01-01T00:00:00.000Z'},{updatedAt:'2026-10-07T09:00:00+01:00'}]) {
    const prior=state(frame);let rejected=false;
    try {frame.contentWindow.validateEvents([{...valid,...change}]);} catch {rejected=true;}
    check(rejected && same(state(frame),prior),'F: current-schema metadata validation rejects malformed/missing/out-of-order fields');
  }
  const beforeDemoPurge=state(frame);
  const demoRecords=beforeDemoPurge.events.map((e,index)=>({...e,id:`demo-${index}`,demo:true}));
  demoRecords[0].deletedAt=demoRecords[0].updatedAt;
  await importBackup(frame,{version:2,demoCleared:false,events:[...beforeDemoPurge.events,...demoRecords]});
  await click(frame,'#clear-demo');await reload(frame);
  check(same(state(frame).events,beforeDemoPurge.events) && !(await databaseContents()).events.some(e=>e.demo),'F: demo purge removes active/deleted demos and preserves real records');
  await importBackup(frame,beforeDemoPurge);
  const peerDelete=await start();
  await click(frame,'#timeline [data-id="m-poo"]');await click(frame,'#delete-event');
  await waitFor(()=>state(peerDelete).events.find(e=>e.id==='m-poo')?.deletedAt!=null,'peer tombstone refresh');
  await reload(peerDelete);check(same(state(peerDelete),state(frame)) && !peerDelete.contentDocument.querySelector('#timeline [data-id="m-poo"]'),'F: peer refresh/reload retains tombstone without resurrection');peerDelete.remove();
  check(frame.contentDocument.querySelectorAll('#timeline .event-mark').length===2 && frame.contentDocument.querySelectorAll('#data tbody tr').length===2 && frame.contentDocument.querySelector('#summary .metric strong').textContent==='2','F: deleted accident excluded from table, timeline and tracked-day counts');
  const activeStats=frame.contentWindow.eval('statistics(activeEvents())');
  check(frame.contentDocument.getElementById('stats').textContent.includes('Accident-free streak2 days') && activeStats.mealPoo===null,'F: deleted accident excluded from streak and meal statistics');
  await authChecks(frame);
  await cloudChecks();
  await modelChecks(frame);
  await syncChecks();
  frame=await start();
  onlineFrame=frame; document.getElementById('offline').hidden=false;
  results.textContent+='\nREADY FOR OFFLINE: Stop the disposable HTTP server, then click the offline checks button.';
}

// Stub only the auth SDK: diary persistence remains native IndexedDB throughout.
const authFixture = `
window.authFixture={creates:0,gets:0,starts:0,stops:0,cloudCalls:0,user:null,online:true};
Object.defineProperty(navigator,'onLine',{get:()=>authFixture.online});
window.supabase={createClient:(url,key,options)=>{
  authFixture.creates++;authFixture.projectURL=url;authFixture.options=options;
  return {from:()=>{authFixture.cloudCalls++;throw new Error('No diary API allowed');},auth:{
    getSession:async()=>{authFixture.gets++;if(authFixture.hang)return new Promise(()=>{});return {data:{session:authFixture.user?{user:authFixture.user}:null},error:authFixture.fail?new Error('Auth failed'):null};},
    onAuthStateChange:callback=>{authFixture.emit=(event,user)=>{authFixture.user=user;callback(event,user?{user}:null);};return {data:{subscription:{unsubscribe(){}}}};},
    signInWithOAuth:async options=>{authFixture.oauth=options;return {error:null};},
    signOut:async options=>{authFixture.signOut=options;if(authFixture.signOutFails)return {error:new Error('Outage')};authFixture.emit('SIGNED_OUT',null);return {error:null};},
    startAutoRefresh:()=>{authFixture.starts++;},stopAutoRefresh:()=>{authFixture.stops++;}
  }};
}};`;
async function authChecks(diaryFrame) {
  const before=await databaseContents();
  const status=frame=>frame.contentDocument.getElementById('auth-status').textContent;
  let frame=await start();
  await waitFor(()=>status(frame).includes('Account setup needed'),'placeholder auth UI');
  check(status(frame).includes('Account setup needed') && frame.contentDocument.getElementById('auth-action').disabled,'G: placeholder config disables auth without blocking diary');frame.remove();
  const blockCDN=`window.cdnAttempts=0;const append=HTMLHeadElement.prototype.append;HTMLHeadElement.prototype.append=function(...nodes){if(nodes.some(node=>node.src?.startsWith('https://cdn.jsdelivr.net/'))){cdnAttempts++;queueMicrotask(()=>nodes[0].dispatchEvent(new Event('error')));return;}return append.apply(this,nodes);};`;
  frame=await start(blockCDN,true);
  await waitFor(()=>status(frame).includes('Account unavailable'),'blocked CDN UI');
  check(frame.contentWindow.cdnAttempts===1 && frame.contentDocument.querySelector('#summary .metric'),'G: failed CDN load leaves diary running');
  await click(frame,'[data-add="wee"]');
  check((await databaseContents()).events.length===before.events.length+1,'G: actual IndexedDB recording works after CDN failure');frame.remove();
  const afterRecord=await databaseContents();
  frame=await start(authFixture+'authFixture.fail=true;',true);
  await waitFor(()=>status(frame).includes('Account unavailable'),'auth outage UI');
  check(!blocked(frame) && same(await databaseContents(),afterRecord),'G: auth initialization failure does not block or modify diary');frame.remove();
  frame=await start(authFixture+'authFixture.hang=true;',true);
  await waitFor(()=>status(frame).includes('Checking account'),'pending auth UI');
  check(frame.contentDocument.querySelectorAll('#timeline .event-mark').length>0 && status(frame).includes('Checking account'),'G: pending auth request does not delay diary startup');frame.remove();
  frame=await start(authFixture,true);
  await waitFor(()=>status(frame).startsWith('Not signed in'),'signed-out auth UI');
  check(frame.contentDocument.getElementById('auth-action').textContent==='Sign in with Google','G: signed-out account UI renders correctly');
  const fixture=frame.contentWindow.authFixture;
  check(fixture.projectURL==='https://auth-fixture.invalid','H: createClient receives exactly the base project URL');
  check(fixture.creates===1 && fixture.options.auth.persistSession && fixture.options.auth.autoRefreshToken && fixture.options.auth.detectSessionInUrl && fixture.options.auth.flowType==='pkce','G: exactly one client uses browser persistence, refresh and PKCE detection');
  await click(frame,'#auth-action');await waitFor(()=>fixture.oauth,'Google action');
  check(fixture.oauth.provider==='google' && fixture.oauth.options.redirectTo===location.origin+'/' && fixture.creates===1,'G: Google action uses app-root redirect and reuses client');
  fixture.emit('SIGNED_IN',{email:'fixture@example.invalid',user_metadata:{full_name:'Chris <b>test</b>'}});
  check(status(frame)==='Signed in · household diary sync' && frame.contentDocument.getElementById('auth-identity').textContent==='Chris <b>test</b> · fixture@example.invalid' && !frame.contentDocument.querySelector('#auth-identity b'),'G: signed-in identity is safely rendered as text');
  fixture.emit('TOKEN_REFRESHED',fixture.user);
  check(same(await databaseContents(),afterRecord) && fixture.cloudCalls===0,'G: auth state/refresh rendering neither modifies diary nor queries cloud diary tables');
  fixture.online=false;frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('offline'));
  await waitFor(()=>fixture.stops>0,'offline refresh pause');
  check(status(frame).startsWith('Offline') && !frame.contentDocument.getElementById('auth-identity').hidden && frame.contentDocument.getElementById('auth-action').disabled,'G: offline keeps known identity and pauses auth actions/refresh');
  let fetches=0;const nativeFetch=frame.contentWindow.fetch;frame.contentWindow.fetch=()=>{fetches++;return Promise.resolve();};
  try {await fixture.options.global.fetch('/must-not-fetch');} catch {}
  frame.contentWindow.fetch=nativeFetch;
  check(fetches===0,'G: offline auth transport makes no network request');
  fixture.online=true;frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('online'));
  check(status(frame).startsWith('Signed in') && !frame.contentDocument.getElementById('auth-action').disabled,'G: reconnect preserves session identity');
  fixture.signOutFails=true;await click(frame,'#auth-action');
  await waitFor(()=>frame.contentDocument.getElementById('auth-action').textContent==='Sign out','failed sign-out completes');
  check(status(frame).startsWith('Signed in') && !frame.contentDocument.getElementById('auth-error').hidden,'G: failed sign-out retains signed-in identity');
  fixture.signOutFails=false;await click(frame,'#auth-action');
  await waitFor(()=>status(frame).startsWith('Not signed in'),'sign-out completes');
  check(fixture.signOut.scope==='local' && same(await databaseContents(),afterRecord),'G: local-scope Supabase sign-out preserves diary, tombstones and demo state');
  frame.remove();
  frame=await start(authFixture+`Object.defineProperty(document,'currentScript',{get:()=>({src:new URL(document.baseURI).origin+'/bella-diary/auth.js?version=1#ignored'})});`,true);
  await waitFor(()=>status(frame).startsWith('Not signed in'),'production-path auth UI');
  await click(frame,'#auth-action');await waitFor(()=>frame.contentWindow.authFixture.oauth,'production-path OAuth action');
  check(frame.contentWindow.authFixture.oauth.options.redirectTo===location.origin+'/bella-diary/','G: GitHub Pages path is retained while query/fragment are discarded');frame.remove();
  frame=await start(authFixture+'authFixture.online=false;',true);
  await waitFor(()=>status(frame).startsWith('Offline'),'offline auth UI');
  check(status(frame).startsWith('Offline') && frame.contentWindow.authFixture.creates===0 && !blocked(frame),'G: configured offline startup skips SDK/auth while loading diary');frame.remove();
  for (const suffix of ['/rest/v1','/auth/v1','/?unexpected=1','/#unexpected']) {
    frame=await start(authFixture,true,'https://auth-fixture.invalid'+suffix);
    await waitFor(()=>status(frame).includes('Account setup needed'),'non-base URL rejected');
    check(frame.contentWindow.authFixture.creates===0 && frame.contentDocument.getElementById('auth-action').disabled && !blocked(frame),'H: API path/query/fragment cannot reach createClient; diary remains available');frame.remove();
  }
  frame=await start(authFixture,true,'https://auth-fixture.invalid/');
  await waitFor(()=>status(frame).startsWith('Not signed in'),'root slash accepted');
  check(frame.contentWindow.authFixture.projectURL==='https://auth-fixture.invalid','H: root trailing slash is normalized to project origin');frame.remove();
  const sources=await Promise.all(['../index.html','../app.js','../storage.js','../auth.js','../cloud-diagnostic.js','../sync.js','../supabase-config.js','../sw.js','../README.md'].map(async path=>(await (await fetch(path)).text())));
  const credentialPattern=/sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
  check(sources.every(source=>!credentialPattern.test(source)),'G: application/config/docs contain no secret keys or credential JWTs');
  await diaryFrame.contentWindow.eval('mutationQueue');
}

async function offline() {
  document.getElementById('offline').disabled=true;
  // A unique URL requires the worker's navigation fallback when the server is down.
  const before=state(onlineFrame);await reload(onlineFrame,'-offline');
  check(same(state(onlineFrame),before),'E: cached app loads with HTTP server stopped');
  await click(onlineFrame,'[data-add="wee"]');const added=state(onlineFrame);
  check(added.events.length===before.events.length+1 && (await databaseContents()).events.length===added.events.length,'E: native IndexedDB writes work offline');
  await reload(onlineFrame,'-offline-again');check(same(state(onlineFrame),added),'E: offline reload retains new event');
  const event=state(onlineFrame).events.at(-1);
  await click(onlineFrame,`#timeline [data-id="${event.id}"]`);
  onlineFrame.contentDocument.getElementById('event-form').elements.note.value='Offline edit';
  await click(onlineFrame,'#event-form button[type="submit"]');await reload(onlineFrame,'-offline-edited');
  const edited=state(onlineFrame).events.find(e=>e.id===event.id);
  check(edited.note==='Offline edit' && edited.createdAt===event.createdAt && edited.deletedAt===null,'E: offline edit persists without changing creation metadata');
  await click(onlineFrame,`#timeline [data-id="${event.id}"]`);await click(onlineFrame,'#delete-event');await reload(onlineFrame,'-offline-deleted');
  const deleted=state(onlineFrame).events.find(e=>e.id===event.id);
  check(deleted.deletedAt===deleted.updatedAt && deleted.deletedAt!==null && validMetadata(deleted) && !onlineFrame.contentDocument.querySelector(`#timeline [data-id="${event.id}"]`),'E: offline deletion/reload retains hidden tombstone');
  results.textContent+=`\nALL ${passed} CHECKS PASSED.`;
}
document.getElementById('run').addEventListener('click',()=>run().catch(fail));
document.getElementById('offline').addEventListener('click',()=>offline().catch(fail));
