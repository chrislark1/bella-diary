'use strict';

// Native IndexedDB stays behind the whole-diary repository boundary.
const diaryRepository = (() => {
  const DATABASE = 'bellaDiary', LEGACY_KEY = 'bellaDiary.store';
  let opening = null, channel = null;

  function openDatabase(upgradeStore) {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable.');
        const request = indexedDB.open(DATABASE, 4);
        let failed = false, upgradeError;
        request.onupgradeneeded = event => {
          const db = request.result, transaction = request.transaction;
          if (event.oldVersion === 0) {
            db.createObjectStore('events', {keyPath:'id'});
            db.createObjectStore('meta', {keyPath:'key'});
            return;
          }
          // Read, validate and replace within the native versionchange transaction.
          // Schedule writes in the request callback, without an await (Safari-safe).
          const events = transaction.objectStore('events').getAll();
          const meta = transaction.objectStore('meta').getAll();
          let remaining = 2;
          const upgrade = () => {
            if (--remaining) return;
            try {
              const saved = reconstructDiary(events.result,meta.result);
              if (saved !== null) {
                if (typeof upgradeStore !== 'function') throw new Error('Diary schema upgrade is required.');
                replaceDiary(transaction,upgradeStore(saved));
              }
            } catch (error) {upgradeError = error; transaction.abort();}
          };
          events.onsuccess = upgrade; meta.onsuccess = upgrade;
        };
        request.onerror = () => {failed = true; reject(upgradeError || request.error);};
        request.onblocked = () => {failed = true; reject(new Error('Close other diary windows before upgrading storage.'));};
        request.onsuccess = () => {
          const db = request.result;
          if (failed) {db.close(); return;}
          db.onversionchange = () => {db.close(); opening = null;};
          db.onclose = () => {opening = null;};
          resolve(db);
        };
      }).catch(error => {opening = null; throw new Error(`Could not open diary storage: ${error.message}`);});
    }
    return opening;
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('Diary transaction aborted.'));
    });
  }

  async function readDiary(db) {
    const transaction = db.transaction(['events','meta'], 'readonly');
    const [events, records] = await Promise.all([
      requestValue(transaction.objectStore('events').getAll()),
      requestValue(transaction.objectStore('meta').getAll()),
      transactionDone(transaction)
    ]);
    return reconstructDiary(events,records);
  }

  function reconstructDiary(events, records) {
    const meta = new Map(records.map(record => [record.key,record.value]));
    if (meta.get('initialized') !== true) {
      if (events.length || records.length) throw new Error('Diary storage is incomplete.');
      return null;
    }
    // Retain the old event sequence, including ties and JSON export order.
    const order = meta.get('eventOrder'), byId = new Map(events.map(event => [event.id,event]));
    if (!Array.isArray(order) || order.length !== events.length) throw new Error('Diary event order is invalid.');
    const orderedEvents = order.map(id => {
      if (!byId.has(id)) throw new Error('Diary event order is invalid.');
      const event = byId.get(id); byId.delete(id); return event;
    });
    const saved = {version:meta.get('schemaVersion'), demoCleared:meta.get('demoCleared'), events:orderedEvents};
    if (saved.version >= 3) {
      if (!meta.has('householdId') || !validHousehold(meta.get('householdId'))) throw new Error('Diary household binding is invalid.');
      saved.householdId = meta.get('householdId');
    }
    if (saved.version === 4) saved.syncConflicts = meta.get('syncConflicts');
    return saved;
  }

  function writeDiary(db, store, initializeOnly) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['events','meta'], 'readwrite');
      let wrote = false, failure, householdId = null;
      transaction.oncomplete = () => resolve({wrote, householdId});
      transaction.onabort = () => reject(failure || transaction.error || new Error('Diary transaction aborted.'));
      const meta = transaction.objectStore('meta');
      const write = () => {
        try {
          // Binding is authoritative in this transaction, even for a stale window
          // or a JSON restore. Event saves cannot erase or replace it.
          const binding = meta.get('householdId');
          binding.onsuccess = () => {
            try {
              householdId = binding.result?.value ?? null;
              if (!validHousehold(householdId)) throw new Error('Invalid household binding.');
              const conflicts = meta.get('syncConflicts');
              conflicts.onsuccess = () => {
                try {replaceDiary(transaction,{...store, householdId, syncConflicts:conflicts.result?.value || []}); wrote = true;}
                catch (error) {failure = error; transaction.abort();}
              };
            } catch (error) {failure = error; transaction.abort();}
          };
        }
        catch (error) {failure = error; try {transaction.abort();} catch {}}
      };
      if (initializeOnly) {
        // Check inside the write transaction so a second launch cannot reseed
        // or overwrite a diary initialized by another window in the meantime.
        const request = meta.get('initialized');
        request.onsuccess = () => {if (request.result?.value !== true) write();};
      } else write();
    });
  }

  function replaceDiary(transaction, store) {
    const events = transaction.objectStore('events'), meta = transaction.objectStore('meta');
    events.clear(); meta.clear();
    // add() makes duplicate IDs abort the entire transaction.
    store.events.forEach(event => events.add(event));
    meta.put({key:'schemaVersion', value:store.version});
    meta.put({key:'demoCleared', value:store.demoCleared});
    meta.put({key:'eventOrder', value:store.events.map(event => event.id)});
    meta.put({key:'initialized', value:true});
    meta.put({key:'householdId', value:store.householdId});
    meta.put({key:'syncConflicts', value:store.syncConflicts || []});
  }

  const validHousehold = id => id === null || typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

  function getChannel() {
    if (!channel && typeof BroadcastChannel !== 'undefined') {
      try {channel = new BroadcastChannel('bellaDiary.changes');} catch {}
    }
    return channel;
  }

  return {
    async load(upgradeStore) {
      try {
        const db = await openDatabase(upgradeStore);
        const saved = await readDiary(db);
        if (saved !== null) return saved; // Never use the rollback snapshot once initialized.
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy === null) return null;
        if (typeof upgradeStore !== 'function') throw new Error('Legacy diary validation is required.');
        const validated = upgradeStore(JSON.parse(legacy));
        // App validation must finish before any legacy events become authoritative.
        await this.save(validated, {initializeOnly:true});
        return await readDiary(db);
      } catch (error) {throw new Error(`Could not read the saved diary: ${error.message}`);}
    },

    async save(store, {initializeOnly = false} = {}) {
      try {
        const db = await openDatabase();
        const {wrote, householdId} = await writeDiary(db, store, initializeOnly);
        // A notification failure must not turn a committed write into an error.
        if (wrote) {try {getChannel()?.postMessage('saved');} catch {}}
        return householdId;
      } catch (error) {throw new Error(`Could not save the diary: ${error.message}`);}
    },

    // Read and transform the latest diary in one transaction. No awaits in its
    // request callbacks: Safari keeps the transaction active, including rollback.
    async transact(transform) {
      const db = await openDatabase();
      return new Promise((resolve,reject) => {
        const tx = db.transaction(['events','meta'],'readwrite');
        const events = tx.objectStore('events').getAll(), meta = tx.objectStore('meta').getAll();
        let pending = 2, result, changed = false, failure;
        const apply = () => {
          if (--pending) return;
          try {
            const saved = reconstructDiary(events.result,meta.result);
            if (!saved) throw new Error('Diary is not initialized.');
            const next = transform(saved);
            if (next && next.householdId !== saved.householdId) throw new Error('Household binding cannot change.');
            changed = !!next && JSON.stringify(next) !== JSON.stringify(saved);
            result = next || saved;
            if (changed) replaceDiary(tx,result);
          } catch (error) {failure = error; tx.abort();}
        };
        events.onsuccess = meta.onsuccess = apply;
        tx.onabort = () => reject(failure || tx.error || new Error('Diary transaction aborted.'));
        tx.oncomplete = () => {
          if (changed) {try {getChannel()?.postMessage('saved');} catch {}}
          resolve({changed,store:result});
        };
      });
    },

    async bindHousehold(id, canBind = () => true) {
      if (id === null || !validHousehold(id)) throw new Error('Invalid household ID.');
      const db = await openDatabase();
      const transaction = db.transaction('meta','readwrite'), meta = transaction.objectStore('meta');
      const done = transactionDone(transaction);
      let mismatch = false;
      const request = meta.get('householdId');
      request.onsuccess = () => {
        const existing = request.result?.value;
        if (!validHousehold(existing)) {transaction.abort(); return;}
        if (existing !== null && existing !== id) {mismatch = true; return;}
        if (existing === null) {
          if (!canBind()) {transaction.abort(); return;}
          meta.put({key:'householdId',value:id});
        }
      };
      await done;
      if (mismatch) throw new Error('Household mismatch: this diary is already linked to another household.');
      try {getChannel()?.postMessage('saved');} catch {}
      return id;
    },

    subscribe(listener) {
      const broadcast = getChannel();
      const onMessage = event => {if (event.data === 'saved') listener();};
      broadcast?.addEventListener('message', onMessage);
      return () => broadcast?.removeEventListener('message', onMessage);
    }
  };
})();
