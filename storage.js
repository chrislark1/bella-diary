'use strict';

// Native IndexedDB stays behind the whole-diary repository boundary.
const diaryRepository = (() => {
  const DATABASE = 'bellaDiary', LEGACY_KEY = 'bellaDiary.store';
  let opening = null, channel = null;

  function openDatabase(upgradeStore) {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable.');
        const request = indexedDB.open(DATABASE, 2);
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
    return {version:meta.get('schemaVersion'), demoCleared:meta.get('demoCleared'), events:orderedEvents};
  }

  function writeDiary(db, store, initializeOnly) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['events','meta'], 'readwrite');
      let wrote = false, failure;
      transaction.oncomplete = () => resolve(wrote);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Diary transaction aborted.'));
      const meta = transaction.objectStore('meta');
      const write = () => {
        try {replaceDiary(transaction,store); wrote = true;}
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
  }

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
        const wrote = await writeDiary(db, store, initializeOnly);
        // A notification failure must not turn a committed write into an error.
        if (wrote) {try {getChannel()?.postMessage('saved');} catch {}}
      } catch (error) {throw new Error(`Could not save the diary: ${error.message}`);}
    },

    subscribe(listener) {
      const broadcast = getChannel();
      const onMessage = event => {if (event.data === 'saved') listener();};
      broadcast?.addEventListener('message', onMessage);
      return () => broadcast?.removeEventListener('message', onMessage);
    }
  };
})();
