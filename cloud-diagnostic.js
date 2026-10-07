'use strict';

// Optional, explicit cloud diagnostic. Never reads or writes local diary storage.
(() => {
  const el = id => document.getElementById(id);
  const NOTE = 'Bella Diary cloud connection test';
  const columns = 'id,household_id,type,datetime,location,note,demo,client_created_at,client_updated_at,deleted_at,mutation_id,server_updated_at';
  let identity = null, household = null, busy = false, generation = 0;
  let message = '', report = '', controller = null, activeId = null;

  function render() {
    const signedIn = !!window.bellaAuth?.getUser()?.id;
    el('cloud-diagnostic').hidden = !signedIn;
    el('cloud-household').textContent = household ? `Household: ${household.name}` : 'Household: not yet identified';
    el('cloud-status').textContent = !navigator.onLine ? 'Cloud access: Offline' : message;
    el('cloud-test').disabled = !signedIn || !navigator.onLine || busy;
    el('cloud-test').textContent = busy ? 'Checking cloud access...' : 'Run cloud connection test';
    el('cloud-results').textContent = report;
    el('cloud-results').hidden = !report;
  }

  function context() {
    return {client:window.bellaAuth.getClient(), user:identity, generation, signal:controller.signal, controller};
  }
  function current(ctx) {
    return ctx.generation === generation && ctx.user === window.bellaAuth.getUser()?.id && navigator.onLine && !ctx.signal.aborted;
  }
  async function request(ctx, query) {
    if (!current(ctx)) throw new Error('Unavailable');
    const timer = setTimeout(() => ctx.controller.abort(),10000);
    try {
      // Abort the actual request, not just its UI wait; no retries or queues.
      const result = await query.abortSignal(ctx.signal);
      if (!current(ctx) || result.error) throw new Error('Unavailable');
      return result.data;
    } finally {clearTimeout(timer);}
  }
  function requireValue(ok) {if (!ok) throw new Error('Verification failed');}

  async function discover(ctx) {
    message = 'Cloud access: Checking membership'; render();
    const members = await request(ctx,ctx.client.from('household_members').select('household_id').eq('user_id',ctx.user));
    if (!Array.isArray(members)) throw new Error('Membership');
    if (members.length !== 1) {
      message = members.length === 0 ? 'Cloud access: No household membership. Ask the household owner to arrange setup.' : 'Cloud access: Multiple households found. Household selection is required.';
      return false;
    }
    message = 'Cloud access: Checking household'; render();
    const homes = await request(ctx,ctx.client.from('households').select('id,name').eq('id',members[0].household_id));
    requireValue(homes?.length === 1 && homes[0].id === members[0].household_id && typeof homes[0].name === 'string');
    household = homes[0];
    message = 'Cloud access: Checking event read'; render();
    // Only prove SELECT access. No downloaded records enter the local diary.
    await request(ctx,ctx.client.from('diary_events').select('id').eq('household_id',household.id).limit(1));
    message = 'Cloud access: Ready';
    return true;
  }

  async function discoverOnly() {
    if (busy || !identity || !navigator.onLine) return;
    busy = true; controller = new AbortController(); const ctx = context();
    try {await discover(ctx);}
    catch {if (ctx.generation === generation) message += ' failed. Check connectivity and household permissions, then run the test to retry.';}
    finally {if (ctx.generation === generation) {busy = false; controller = null; render();}}
  }

  // Compare instants: PostgreSQL may return +00:00 and microsecond precision.
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const sameInstant = (a,b) => instant(a) && instant(b) && Date.parse(a) === Date.parse(b);
  function verify(row, expected, previous) {
    requireValue(row && ['id','household_id','type','datetime','location','note','demo','mutation_id'].every(key => row[key] === expected[key]));
    requireValue(sameInstant(row.client_created_at,expected.client_created_at) && sameInstant(row.client_updated_at,expected.client_updated_at));
    requireValue(expected.deleted_at === null ? row.deleted_at === null : sameInstant(row.deleted_at,expected.deleted_at));
    // server_updated_at is never sent by this module: the database assigns it.
    requireValue(instant(row.server_updated_at) && (!previous || row.server_updated_at !== previous));
  }
  function localTime(date) {
    const pad = value => String(value).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function run() {
    if (busy || !identity || !navigator.onLine || !window.bellaAuth.getClient()) return;
    busy = true; controller = new AbortController(); const ctx = context();
    let stage = 'Authenticated access', id = null, expected, stamp, inserted = false;
    const checks = [];
    const stageStart = value => {stage = value; report = checks.concat(`${stage}: checking...`).join('\n'); render();};
    const ok = () => {checks.push(`${stage}: OK`);};
    const rowQuery = () => ctx.client.from('diary_events').select(columns).eq('household_id',household.id).eq('id',id).single();
    const target = query => query.eq('household_id',household.id).eq('id',id).eq('demo',true);
    try {
      report = ''; stageStart(stage);
      if (!await discover(ctx)) {report = message; return;}
      ok();
      const now = new Date(); const utc = now.toISOString(); id = crypto.randomUUID(); activeId = id;
      expected = {id,household_id:household.id,type:'wee',datetime:localTime(now),location:'outside',note:NOTE,demo:true,
        client_created_at:utc,client_updated_at:utc,deleted_at:null,mutation_id:crypto.randomUUID()};
      stageStart('Insert');
      const created = await request(ctx,ctx.client.from('diary_events').insert(expected).select(columns).single());
      inserted = true; verify(created,expected); stamp = created.server_updated_at; ok();
      stageStart('Read');
      const read = await request(ctx,rowQuery()); verify(read,expected); requireValue(read.server_updated_at === stamp); ok();
      stageStart('Update');
      let next = new Date(Math.max(Date.now(),Date.parse(expected.client_updated_at)+1)).toISOString();
      const update = {note:NOTE+' - updated',client_updated_at:next,mutation_id:crypto.randomUUID()};
      expected = {...expected,...update};
      const updated = await request(ctx,target(ctx.client.from('diary_events').update(update)).select(columns).single());
      verify(updated,expected,stamp); stamp = updated.server_updated_at; ok();
      stageStart('Tombstone');
      next = new Date(Math.max(Date.now(),Date.parse(next)+1)).toISOString();
      const tombstone = {deleted_at:next,client_updated_at:next,mutation_id:crypto.randomUUID()};
      expected = {...expected,...tombstone};
      const deleted = await request(ctx,target(ctx.client.from('diary_events').update(tombstone)).select(columns).single());
      verify(deleted,expected,stamp); stamp = deleted.server_updated_at;
      const retained = await request(ctx,rowQuery()); verify(retained,expected); requireValue(retained.server_updated_at === stamp); ok();
      stageStart('Cleanup');
      await request(ctx,target(ctx.client.from('diary_events').delete()));
      const remaining = await request(ctx,ctx.client.from('diary_events').select('id').eq('household_id',household.id).eq('id',id));
      requireValue(Array.isArray(remaining) && remaining.length === 0); ok();
      report = ['Cloud connection test passed',`Household: ${household.name}`,...checks].join('\n');
    } catch {
      if (ctx.generation === generation) report = [...checks,`${stage}: failed. Check connectivity and household permissions, then try again.`,
        ...(id ? [`Diagnostic event ID: ${id}`,inserted ? 'Cleanup not verified; this disposable demo row may remain in the cloud.' : 'The insert outcome may be uncertain; a disposable demo row may remain in the cloud.'] : [])].join('\n');
    } finally {
      if (ctx.generation === generation) {busy = false; controller = null; activeId = null; render();}
    }
  }

  function accountChanged() {
    const next = window.bellaAuth?.getUser()?.id || null;
    if (next !== identity) {
      generation++; controller?.abort(); controller = null; busy = false;
      identity = next; household = null; report = ''; message = ''; activeId = null;
      // Do not call the SDK inside its auth callback lock.
      if (identity) setTimeout(discoverOnly,0);
    }
    render();
  }
  el('cloud-test').addEventListener('click',run);
  window.addEventListener('bella-auth-change',accountChanged);
  window.addEventListener('offline',() => {
    if (busy) report = ['Cloud check interrupted: offline. Run again when online.',
      ...(activeId ? [`Diagnostic event ID: ${activeId}`, 'Cleanup not verified; a disposable demo row may remain in the cloud.'] : [])].join('\n');
    generation++; controller?.abort(); controller = null; busy = false; activeId = null;
    message = 'Cloud access: Run connection test to recheck'; render();
  });
  window.addEventListener('online',() => {render(); if (identity && !household) discoverOnly();});
  accountChanged();
})();
