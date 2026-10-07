// Stage 4C: SDK-only stub, with the production app and real IndexedDB intact.
const cloudFixture = authFixture.replace("from:()=>{authFixture.cloudCalls++;throw new Error('No diary API allowed');}", 'from:table=>cloudFrom(table)') + `
window.cloudFixture={calls:[],rows:new Map(),households:1,stamp:0};
window.cloudFrom=table=>{
  const fixture=cloudFixture, q={table,op:'select',filters:[],fields:null,single:false};
  const builder={
    select(fields){q.fields=fields;return this;},eq(key,value){q.filters.push([key,value]);return this;},
    limit(n){q.limit=n;return this;},single(){q.single=true;return this;},
    insert(value){q.op='insert';q.payload=structuredClone(value);return this;},
    update(value){q.op='update';q.payload=structuredClone(value);return this;},
    delete(){q.op='delete';return this;},abortSignal(signal){q.signal=signal;return this;},
    then(resolve,reject){
      fixture.calls.push(q);authFixture.cloudCalls++;
      return (async()=>{
        if(fixture.hang){await new Promise(r=>{q.signal.addEventListener('abort',r,{once:true});});return {error:new Error('Aborted')};}
        if(fixture.fail===q.op || fixture.fail===table)return {error:new Error('sensitive raw error must not be displayed')};
        if(table==='household_members')return {data:Array.from({length:fixture.households},(_,i)=>({household_id:'home-'+i}))};
        if(table==='households')return {data:[{id:'home-0',name:'Bella <b>test</b>'}]};
        const id=q.filters.find(([key])=>key==='id')?.[1];
        let row=fixture.rows.get(id);
        const stamp=()=>new Date(1700000000000+(++fixture.stamp)*1000).toISOString();
        if(q.op==='insert'){row={...q.payload,server_updated_at:stamp()};fixture.rows.set(row.id,row);}
        if(q.op==='update'){row={...row,...q.payload,server_updated_at:(fixture.frozenStamp || (fixture.frozenTombstone && q.payload.deleted_at))?row.server_updated_at:stamp()};fixture.rows.set(id,row);}
        if(q.op==='delete'){if(!fixture.keepRow)fixture.rows.delete(id);return {data:null};}
        if(q.op==='select' && !id)return {data:Array.from(fixture.rows.values()).slice(0,q.limit||100)};
        if(fixture.missingStamp && row)row={...row,server_updated_at:null};
        return {data:q.single?structuredClone(row):row?[structuredClone(row)]:[]};
      })().then(resolve,reject);
    }
  };return builder;
};
authFixture.user={id:'fixture-user',email:'cloud@example.invalid'};
`;
async function cloudChecks() {
  const before=await databaseContents();
  const text=(frame,id)=>frame.contentDocument.getElementById(id).textContent;
  const complete=frame=>waitFor(()=>!frame.contentDocument.getElementById('cloud-test').disabled,'cloud test finishes');
  let frame=await start(cloudFixture+'authFixture.user=null;',true);
  await waitFor(()=>text(frame,'auth-status').startsWith('Not signed in'),'signed-out diagnostic');
  await click(frame,'#cloud-test');
  check(frame.contentDocument.getElementById('cloud-diagnostic').hidden && frame.contentWindow.cloudFixture.calls.length===0,'I: signed-out diagnostic is hidden and cannot run');frame.remove();
  for(const [count,label] of [[0,'No household membership'],[2,'Multiple households']]) {
    frame=await start(cloudFixture+`cloudFixture.households=${count};`,true);
    await waitFor(()=>text(frame,'cloud-status').includes(label),'membership diagnostic');await complete(frame);
    await click(frame,'#cloud-test');await complete(frame);
    check(text(frame,'cloud-status').includes(label) && frame.contentWindow.cloudFixture.calls.every(c=>c.table==='household_members' && c.op==='select'),'I: '+label+' stops before event access or writes');frame.remove();
  }
  frame=await start(cloudFixture,true);await waitFor(()=>text(frame,'cloud-status')==='Cloud access: Ready','one household');
  let fixture=frame.contentWindow.cloudFixture;
  check(fixture.calls.length===3 && fixture.calls.every(c=>c.op==='select') && fixture.rows.size===0,'I: startup only discovers membership/household and event read access; no test runs automatically');
  check(fixture.calls[0].filters.some(([k,v])=>k==='user_id' && v==='fixture-user') && text(frame,'cloud-household')==='Household: Bella <b>test</b>' && !frame.contentDocument.querySelector('#cloud-household b'),'I: discovery filters by authenticated identity and renders household name safely');
  frame.contentWindow.authFixture.online=false;frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('offline'));
  const callCount=fixture.calls.length;await click(frame,'#cloud-test');
  check(frame.contentDocument.getElementById('cloud-test').disabled && text(frame,'cloud-status').includes('Offline') && fixture.calls.length===callCount,'I: offline diagnostic cannot run and does not sign out');
  frame.contentWindow.authFixture.online=true;frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('online'));
  await click(frame,'#cloud-test');await complete(frame);
  check(text(frame,'cloud-results').startsWith('Cloud connection test passed'),'I: full diagnostic succeeds');
  const calls=fixture.calls.slice(callCount), writes=calls.filter(c=>c.op!=='select');
  check(writes.map(c=>c.op).join(',')==='insert,update,update,delete' && calls.map(c=>c.op).join(',')==='select,select,select,insert,select,update,update,select,delete,select','I: authenticated discovery, insert, read, update, tombstone/read and delete/absence checks run in order');
  const payload=writes[0].payload, uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check(uuid.test(payload.id) && uuid.test(payload.mutation_id) && payload.household_id==='home-0' && payload.type==='wee' && payload.location==='outside' && payload.demo===true && payload.note==='Bella Diary cloud connection test','I: unique disposable demo wee uses discovered household and diagnostic note');
  const now=new Date(), pad=n=>String(n).padStart(2,'0');
  check(payload.datetime.startsWith(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T`) && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(payload.datetime) && new Date(payload.client_created_at).toISOString()===payload.client_created_at && payload.client_created_at===payload.client_updated_at && payload.deleted_at===null && !('server_updated_at' in payload) && !('createdAt' in payload),'I: wall-clock datetime and canonical UTC metadata map to cloud schema; server timestamp omitted');
  check(writes[1].payload.mutation_id!==payload.mutation_id && writes[2].payload.mutation_id!==writes[1].payload.mutation_id && writes[2].payload.deleted_at===writes[2].payload.client_updated_at,'I: updates mint new mutations and tombstone shares its client update instant');
  check(writes.slice(1).every(c=>c.filters.some(([k,v])=>k==='id'&&v===payload.id)&&c.filters.some(([k,v])=>k==='household_id'&&v==='home-0')&&c.filters.some(([k,v])=>k==='demo'&&v===true)) && fixture.rows.size===0,'I: mutations and cleanup target only the generated demo ID/household; absence verified');
  check(same(await databaseContents(),before) && frame.contentWindow.authFixture.creates===1,'I: diagnostic neither uploads local diary records nor mutates IndexedDB; sole auth client reused');
  await click(frame,'#cloud-test');await complete(frame);
  check(fixture.calls.filter(c=>c.op==='insert')[1].payload.id!==payload.id,'I: repeat tests use fresh IDs, never reuse prior diagnostic records');
  await click(frame,'#auth-action');
  await waitFor(()=>frame.contentDocument.getElementById('cloud-diagnostic').hidden,'diagnostic hides on sign-out');
  check(same(await databaseContents(),before),'I: sign-out clears diagnostic identity without touching diary');frame.remove();
  for(const [inject,stage] of [["cloudFixture.missingStamp=true;",'Insert'],["cloudFixture.frozenStamp=true;",'Update'],["cloudFixture.keepRow=true;",'Cleanup'],["cloudFixture.frozenTombstone=true;",'Tombstone'],["cloudFixture.fail='update';",'Update'],["cloudFixture.fail='insert';",'Insert']]) {
    frame=await start(cloudFixture+inject,true);await waitFor(()=>text(frame,'cloud-status')==='Cloud access: Ready','failure fixture ready');
    await click(frame,'#cloud-test');await complete(frame);
    check(text(frame,'cloud-results').includes(stage+': failed') && !text(frame,'cloud-results').includes('sensitive raw error') && same(await databaseContents(),before),'I: '+stage+' failure is safe and leaves native diary unchanged ('+inject+')');frame.remove();
  }
  frame=await start(cloudFixture+"cloudFixture.fail='household_members';",true);
  await waitFor(()=>text(frame,'cloud-status').includes('failed'),'discovery outage');
  check(!blocked(frame) && frame.contentDocument.querySelector('#timeline .event-mark') && same(await databaseContents(),before),'I: discovery outage does not block local diary startup');frame.remove();
  frame=await start(cloudFixture,true);await waitFor(()=>text(frame,'cloud-status')==='Cloud access: Ready','abort fixture ready');fixture=frame.contentWindow.cloudFixture;
  fixture.hang=true;await click(frame,'#cloud-test');await waitFor(()=>fixture.calls.at(-1)?.signal,'pending cloud request');
  frame.contentWindow.authFixture.online=false;frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('offline'));
  check(fixture.calls.at(-1).signal.aborted && frame.contentDocument.getElementById('cloud-test').disabled && frame.contentWindow.bellaAuth.getUser().id==='fixture-user','I: offline aborts pending diagnostic without clearing the identity');
  check(same(await databaseContents(),before),'I: interrupted cloud operation leaves IndexedDB untouched');frame.remove();
  frame=await start(cloudFixture,true);await waitFor(()=>text(frame,'cloud-status')==='Cloud access: Ready','account-change fixture ready');fixture=frame.contentWindow.cloudFixture;
  fixture.hang=true;await click(frame,'#cloud-test');await waitFor(()=>fixture.calls.at(-1)?.signal,'pending account-change request');
  frame.contentWindow.authFixture.emit('SIGNED_OUT',null);
  check(fixture.calls.at(-1).signal.aborted && frame.contentDocument.getElementById('cloud-diagnostic').hidden && same(await databaseContents(),before),'I: account change aborts old-identity requests and hides prior results without altering diary');frame.remove();
  const source=await (await fetch('../cloud-diagnostic.js')).text();
  check(!/indexedDB|diaryRepository|localStorage|createClient\(/.test(source),'I: cloud diagnostic has no local store access or independent client construction');
}
