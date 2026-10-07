'use strict';

// Bella's small household reconciler. UI still reads/writes only IndexedDB.
(() => {
  const uuid = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const fields = {pooConsistency:'poo_consistency',mealFood:'meal_food',mealAmount:'meal_amount',
    createdAt:'client_created_at',updatedAt:'client_updated_at',deletedAt:'deleted_at',mutationId:'mutation_id'};
  let running = false, queued = false, scheduled = null, controller = null, identity = null, generation = 0, status = '';
  const el = id => document.getElementById(id);
  const clean = event => event.serverVersion !== null && event.syncBaseMutationId !== null && event.mutationId === event.syncBaseMutationId;

  // One normal-diary field mapping. No server-generated values are sent.
  function toCloud(event,householdId) {
    const row = {id:event.id,household_id:householdId,type:event.type,datetime:event.datetime,note:event.note,demo:false,
      location:event.location ?? null,poo_consistency:null,meal_food:null,meal_amount:null};
    for (const [local,cloud] of Object.entries(fields)) row[cloud] = event[local] ?? null;
    return row;
  }
  function fromCloud(row,householdId) {
    if (!row || row.household_id !== householdId || row.demo !== false || !uuid(row.id)) throw new Error('Invalid cloud record');
    const event = {id:row.id,type:row.type,datetime:row.datetime,note:row.note ?? '',
      serverVersion:Number(row.server_version),syncBaseMutationId:row.mutation_id};
    if (row.location !== null) event.location = row.location;
    for (const [local,cloud] of Object.entries(fields)) {
      const value = row[cloud];
      event[local] = ['createdAt','updatedAt','deletedAt'].includes(local) && value !== null ? new Date(value).toISOString() : value;
    }
    return validateEvents([event])[0];
  }
  const equivalent = (a,b) => JSON.stringify(toCloud(a,'')) === JSON.stringify(toCloud(b,''));
  const sameRecord = (a,b) => a && b && equivalent(a,b) && a.serverVersion === b.serverVersion && a.syncBaseMutationId === b.syncBaseMutationId;
  function validContext(ctx) {
    return navigator.onLine && ctx.user === window.bellaAuth?.getUser()?.id && !ctx.signal.aborted;
  }
  function render() {
    el('sync-now').disabled = running || !navigator.onLine || !window.bellaAuth?.getUser()?.id || !diaryLoaded || storageBlocked;
    el('sync-status').textContent = !navigator.onLine ? 'Offline · diary saves locally'
      : !window.bellaAuth?.getUser()?.id ? 'Sign in to sync' : running ? 'Syncing…' : status || 'Waiting for household discovery';
  }
  async function send(ctx,query) {
    if (!validContext(ctx)) throw new Error('Sync unavailable');
    let timer;
    try {
      const result = await Promise.race([query.abortSignal(ctx.signal),new Promise((_,reject) => {
        timer = setTimeout(() => {ctx.controller.abort(); reject(new Error('Sync unavailable'));},10000);
      })]);
      if (!validContext(ctx)) throw new Error('Sync unavailable');
      if (result.error) {const error = new Error('Cloud request failed'); error.code = result.error.code; throw error;}
      return result;
    } finally {clearTimeout(timer);}
  }
  async function fetchSnapshot(ctx) {
    const rows = [], ids = new Set();
    // Page explicitly: Supabase's response row cap must not truncate a diary.
    let total = Infinity;
    while (rows.length < total) {
      const result = await send(ctx,ctx.client.from('diary_events').select('*',{count:'exact'})
        .eq('household_id',ctx.household).eq('demo',false).order('id').range(rows.length,rows.length+499));
      if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count < 0) throw new Error('Incomplete cloud snapshot');
      total = result.count;
      if (!result.data.length && rows.length < total) throw new Error('Incomplete cloud snapshot');
      for (const row of result.data) {
        if (ids.has(row.id)) throw new Error('Changing cloud snapshot');
        ids.add(row.id); rows.push(fromCloud(row,ctx.household));
      }
    }
    return new Map(rows.map(event => [event.id,event]));
  }
  async function readOne(ctx,id) {
    const {data} = await send(ctx,ctx.client.from('diary_events').select('*').eq('household_id',ctx.household).eq('id',id));
    if (!Array.isArray(data) || data.length > 1) throw new Error('Invalid cloud record');
    if (data[0]?.demo === true) throw new Error('Diagnostic ID collision');
    return data.length ? fromCloud(data[0],ctx.household) : null;
  }

  async function cycle() {
    if (!diaryLoaded || storageBlocked || !navigator.onLine || !window.bellaAuth?.getUser()?.id) {render(); return;}
    const local = validateStore(await diaryRepository.load(upgradeStore));
    controller = new AbortController();
    const ctx = {client:window.bellaAuth.getClient(),user:window.bellaAuth.getUser().id,controller,signal:controller.signal,household:local.householdId};
    if (!ctx.client || await window.bellaAuth.checkSession() !== ctx.user || !validContext(ctx)) throw new Error('Session unavailable');
    const discovered = await window.bellaCloud.discoverHousehold(ctx.client,ctx.user,async query => (await send(ctx,query)).data);
    if (!discovered.household) {status = discovered.issue; return;}
    if (ctx.household === null) {
      await diaryRepository.bindHousehold(discovered.household.id,() => validContext(ctx));
      ctx.household = discovered.household.id;
      refreshStore();
    }
    if (discovered.household.id !== ctx.household) {status = 'Household mismatch · sync paused'; return;}
    const cloud = await fetchSnapshot(ctx), accepted = new Map(), conflicts = new Map(local.syncConflicts.map(copy => [copy.id,copy]));
    let skipped = 0;
    for (const event of local.events) {
      if (event.demo) continue;
      if (!uuid(event.id)) {skipped++; continue;}
      let remote = cloud.get(event.id);
      if (conflicts.has(event.id)) {conflicts.set(event.id,{id:event.id,cloud:remote || null}); continue;}
      if (event.serverVersion === null) {
        if (remote) {
          if (equivalent(event,remote)) accepted.set(event.id,remote);
          else conflicts.set(event.id,{id:event.id,cloud:remote});
          continue;
        }
        try {
          const {data} = await send(ctx,ctx.client.from('diary_events').insert(toCloud(event,ctx.household)).select('*').single());
          remote = fromCloud(data,ctx.household);
          if (!equivalent(event,remote)) throw new Error('Insert payload changed');
          accepted.set(event.id,remote); cloud.set(event.id,remote);
        } catch (error) {
          if (error.code !== '23505') throw error;
          remote = await readOne(ctx,event.id);
          if (remote && equivalent(event,remote)) accepted.set(event.id,remote);
          else conflicts.set(event.id,{id:event.id,cloud:remote});
        }
        continue;
      }
      if (!remote || remote.serverVersion < event.serverVersion) {conflicts.set(event.id,{id:event.id,cloud:remote || null}); continue;}
      if (clean(event)) continue; // Merge below refreshes a clean copy.
      // An unknown legacy baseline may be established only by exact equivalence.
      if (event.syncBaseMutationId === null && equivalent(event,remote)) {accepted.set(event.id,remote); continue;}
      if (remote.serverVersion !== event.serverVersion || event.syncBaseMutationId === null) {
        conflicts.set(event.id,{id:event.id,cloud:remote}); continue;
      }
      const payload = toCloud(event,ctx.household);
      delete payload.id; delete payload.household_id; delete payload.client_created_at;
      const {data} = await send(ctx,ctx.client.from('diary_events').update(payload).eq('id',event.id)
        .eq('household_id',ctx.household).eq('server_version',event.serverVersion).eq('demo',false).select('*'));
      if (!Array.isArray(data)) throw new Error('Invalid update result');
      if (data.length !== 1) {
        conflicts.set(event.id,{id:event.id,cloud:await readOne(ctx,event.id)}); continue;
      }
      remote = fromCloud(data[0],ctx.household);
      if (remote.serverVersion !== event.serverVersion+1 || !equivalent(event,remote)) throw new Error('Invalid accepted update');
      accepted.set(event.id,remote); cloud.set(event.id,remote);
    }
    if (!validContext(ctx)) throw new Error('Sync unavailable');
    const before = new Map(local.events.map(event => [event.id,event]));
    const result = await diaryRepository.transact(saved => {
      if (!validContext(ctx) || saved.householdId !== ctx.household) throw new Error('Household or account changed');
      const copies = new Map(saved.syncConflicts.map(copy => [copy.id,copy]));
      const events = saved.events.map(event => {
        if (event.demo || !uuid(event.id)) return event;
        const original = before.get(event.id), remote = accepted.get(event.id) || cloud.get(event.id);
        if (conflicts.has(event.id)) {copies.set(event.id,conflicts.get(event.id)); return event;}
        if (copies.has(event.id)) return event;
        if (accepted.has(event.id) && original) {
          // A later local edit keeps its content/mutation, but the accepted write
          // advances its base. The next queued cycle can push that later edit.
          if (sameRecord(event,original)) return remote;
          if (event.serverVersion === original.serverVersion && event.syncBaseMutationId === original.syncBaseMutationId) {
            return {...event,serverVersion:remote.serverVersion,syncBaseMutationId:original.mutationId};
          }
          return event;
        }
        if (remote && clean(event) && remote.serverVersion >= event.serverVersion && (!original || sameRecord(event,original))) return remote;
        if (remote && !clean(event) && remote.serverVersion !== event.serverVersion) copies.set(event.id,{id:event.id,cloud:remote});
        return event;
      });
      const ids = new Set(events.map(event => event.id));
      for (const [id,remote] of cloud) if (!ids.has(id)) {events.push(remote); ids.add(id);}
      return validateStore({...saved,events,syncConflicts:Array.from(copies.values()).filter(copy => ids.has(copy.id))});
    });
    if (result.changed) refreshStore();
    const count = result.store.syncConflicts.length;
    status = count ? `${count} diary ${count === 1 ? 'entry needs' : 'entries need'} attention · conflict copies in JSON backup`
      : skipped ? `Sync warning · ${skipped} non-UUID ${skipped === 1 ? 'entry remains' : 'entries remain'} local` : 'Synced';
  }
  async function drain() {
    scheduled = null; if (running) return;
    running = true; render();
    try {
      while (queued) {
        queued = false; const started = generation;
        try {await cycle();}
        catch {
          if (generation !== started) continue; // Honour a new account/online trigger.
          queued = false; status = 'Sync issue · local diary kept; try Sync now when online';
        }
      }
    }
    finally {controller = null; running = false; render();}
  }
  function requestSync() {
    if (!navigator.onLine || !window.bellaAuth?.getUser()?.id) {render(); return;}
    queued = true;
    if (!running && scheduled === null) scheduled = setTimeout(drain,0);
  }
  window.bellaSync = Object.freeze({request:requestSync});
  el('sync-now').addEventListener('click',requestSync);
  window.addEventListener('bella-local-save',requestSync);
  window.addEventListener('bella-diary-ready',requestSync);
  window.addEventListener('online',requestSync);
  window.addEventListener('offline',() => {generation++; queued = false; controller?.abort(); render();});
  window.addEventListener('bella-auth-change',() => {
    const next = window.bellaAuth?.getUser()?.id || null;
    if (next !== identity) {generation++; identity = next; queued = false; controller?.abort(); status = ''; requestSync();}
    render();
  });
  identity = window.bellaAuth?.getUser()?.id || null;
  render(); requestSync();
})();
