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
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
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
    return {events,meta};
  } finally {db.close();}
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
async function start(inject = '') {
  const html = await (await fetch('../index.html')).text();
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

  const legacy=JSON.stringify(known,null,2);
  await reset(legacy); let frame=await start();
  check(same(state(frame),known),'A: legacy events, fields and order load unchanged');
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
  check(state(frame).events.length===98,'B: fresh origin seeds seven-day demo');
  check(same(state(starting[0]),state(starting[1])) && (await databaseContents()).events.length===98,'B: simultaneous first launches initialize once');
  const seeded=state(frame); await reload(frame);
  check(same(state(frame),seeded),'B: reload neither duplicates nor regenerates demo');
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#clear-demo');
  await reload(frame);
  check(state(frame).events.length===0 && state(frame).demoCleared,'B: cleared demo stays cleared after reload');
  check(localStorage.getItem(KEY)===null,'B: fresh IndexedDB diary creates no legacy localStorage copy');
  starting[1].remove();

  for (const [selector,type,location] of [
    ['[data-add="wee"]','wee','outside'],['[data-add="poo"]','poo','outside'],['[data-add="meal"]','meal',undefined],
    ['[data-add="wee"][data-location="inside"]','wee','inside'],['[data-add="poo"][data-location="inside"]','poo','inside']
  ]) {
    await click(frame,selector); const event=state(frame).events.at(-1); await reload(frame);
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
  await click(frame,`#timeline [data-id="${custom.id}"]`); form=frame.contentDocument.getElementById('event-form');
  form.elements.note.value='Edited acceptance record'; await click(frame,'#event-form button[type="submit"]'); await reload(frame);
  check(state(frame).events.some(e=>e.id===custom.id && e.note==='Edited acceptance record'),'C: edit persists');
  await click(frame,`#timeline [data-id="${custom.id}"]`); await click(frame,'#delete-event'); await reload(frame);
  check(!state(frame).events.some(e=>e.id===custom.id),'C: deletion persists');

  let win=frame.contentWindow;
  const input=frame.contentDocument.getElementById('import-file'), transfer=new win.DataTransfer();
  transfer.items.add(new win.File([JSON.stringify({version:1,events:known.events})],'backup.json',{type:'application/json'}));
  input.files=transfer.files; input.dispatchEvent(new win.Event('change',{bubbles:true}));
  await waitFor(()=>same(state(frame),known),'JSON import'); await reload(frame);
  check(same(state(frame),known),'C: JSON import replaces diary and persists');
  // Exercise real export controls and Blob generation without saving test files.
  win=frame.contentWindow; const downloads=[]; const originalClick=win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click=function(){downloads.push({name:this.download,text:win.fetch(this.href).then(response=>response.text())});};
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#export-json');
  frame.contentDocument.getElementById('more-menu').open=true; await click(frame,'#export-csv');
  win.HTMLAnchorElement.prototype.click=originalClick;
  const json=JSON.parse(await downloads[0].text), csv=await downloads[1].text;
  check(downloads[0].name.endsWith('.json') && same(Object.keys(json),['version','exportedAt','events']) && json.version===1 && same(json.events,known.events),'C: JSON export preserves version-1 format and event order');
  check(downloads[1].name.endsWith('.csv') && csv.startsWith('id,datetime,date,time,type,location,pooConsistency,mealFood,mealAmount,note\r\n') && csv.includes('"Kibble"'),'C: CSV export preserves columns and quoted fields');
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
  const success=await frame.contentWindow.eval('commit([...store.events,store.events[0]],false)');
  check(success===false && same(state(frame),beforeFailure),'D: failed native IndexedDB write leaves memory unchanged');
  check(same(await databaseContents(),dbBefore),'D: transaction abort rolls back event and metadata changes together');
  await click(frame,'[data-add="wee"]');check(state(frame).events.length===beforeFailure.events.length+1,'D: later writes recover after aborted transaction');

  for (const raw of ['{broken','null',JSON.stringify({version:2,demoCleared:false,events:[]}),JSON.stringify({version:1,demoCleared:false,events:[{...known.events[0],datetime:'2026-02-30T08:00'}]})]) {
    await reset(raw);frame=await start();database=await databaseContents();
    check(blocked(frame) && localStorage.getItem(KEY)===raw && database.events.length===0 && database.meta.length===0 && state(frame).events.length===0,'D: malformed legacy diary is retained, blocked and never replaced by demo');
  }
  await reset(legacy);frame=await start("const nativeAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value){const request=nativeAdd.call(this,value);request.addEventListener('success',()=>this.transaction.abort(),{once:true});return request;};");
  database=await databaseContents();check(blocked(frame) && localStorage.getItem(KEY)===legacy && database.events.length===0 && database.meta.length===0,'D: aborted migration leaves legacy intact and IndexedDB uninitialized');
  await reload(frame);check(same(state(frame),known),'D: reload can safely retry failed migration');
  for (const inject of ["Object.defineProperty(window,'indexedDB',{value:undefined});","indexedDB.open=()=>{throw new DOMException('Unavailable','SecurityError');};"]) {
    await reset(legacy);frame=await start(inject);check(blocked(frame) && state(frame).events.length===0 && localStorage.getItem(KEY)===legacy,'D: unavailable/failed database open blocks without seeding or changing legacy');
  }
  await reset(legacy);frame=await start();
  const readOnlyLegacy=await start("const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='bellaDiary.store')throw new Error('Legacy access denied');return get.call(this,key);};");
  check(same(state(readOnlyLegacy),known),'D: initialized database loads even when legacy storage access fails');readOnlyLegacy.remove();

  await waitFor(()=>navigator.serviceWorker.controller,'service-worker control');
  const cache=await caches.open('bellas-diary-shell-v6'), keys=(await cache.keys()).map(request=>new URL(request.url).pathname);
  const required=['/','/index.html','/styles.css','/storage.js','/app.js','/manifest.json','/icons/favicon.svg','/icons/icon-192.png','/icons/icon-512.png'];
  check(required.every(path=>keys.includes(path)),'E: v6 cache includes every static shell file');
  check(keys.every(path=>required.includes(path)),'E: service worker caches shell only, not diary or tests');
  onlineFrame=frame; document.getElementById('offline').hidden=false;
  results.textContent+='\nREADY FOR OFFLINE: Stop the disposable HTTP server, then click the offline checks button.';
}

async function offline() {
  document.getElementById('offline').disabled=true;
  // A unique URL requires the worker's navigation fallback when the server is down.
  const before=state(onlineFrame);await reload(onlineFrame,'-offline');
  check(same(state(onlineFrame),before),'E: cached app loads with HTTP server stopped');
  await click(onlineFrame,'[data-add="wee"]');const added=state(onlineFrame);
  check(added.events.length===before.events.length+1 && (await databaseContents()).events.length===added.events.length,'E: native IndexedDB writes work offline');
  await reload(onlineFrame,'-offline-again');check(same(state(onlineFrame),added),'E: offline reload retains new event');
  results.textContent+=`\nALL ${passed} CHECKS PASSED.`;
}
document.getElementById('run').addEventListener('click',()=>run().catch(fail));
document.getElementById('offline').addEventListener('click',()=>offline().catch(fail));
