'use strict';

// One store, one filter, one editor. Datetimes are local wall-clock ISO strings.
const WINDOW_KEY = 'bellaDiary.aggregateWindow';
const TYPES = ['wee', 'poo', 'meal'];
const CONSISTENCIES = ['Firm', 'Normal', 'Soft', 'Diarrhoea'];
const MIN_SAMPLES = 3;
const DAY_START = 6 * 60, DAY_END = 22 * 60;
const $ = id => document.getElementById(id);
const pad = value => String(value).padStart(2, '0');
const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const localDatetime = date => `${localDate(date)}T${localTime(date)}`;
const dateOf = event => event.datetime.slice(0, 10);
const minutesOf = event => Number(event.datetime.slice(11, 13)) * 60 + Number(event.datetime.slice(14, 16));
// Daily marks and Timing Summary buckets share the same 00–24 plotting geometry.
const position = event => minutesOf(event) / 1440 * 100;
const accident = event => event.type !== 'meal' && event.location === 'inside';
const titleCase = text => text[0].toUpperCase() + text.slice(1);
const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const shortDate = date => new Date(`${date}T12:00`).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
const previousDate = date => {const d = new Date(`${date}T12:00`); d.setDate(d.getDate() - 1); return localDate(d);};
const uniqueId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes,byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const eventMetadata = (now = new Date().toISOString()) => ({createdAt:now, updatedAt:now, deletedAt:null, mutationId:uniqueId(), serverVersion:null, syncBaseMutationId:null});
const isActiveEvent = event => event.deletedAt === null;
const activeEvents = () => store.events.filter(isActiveEvent);
const median = values => {if (values.length < MIN_SAMPLES) return null; const a = [...values].sort((a,b) => a-b); const mid = Math.floor(a.length/2); return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;};
const duration = value => value == null ? '—' : value < 60 ? `${Math.round(value)} min` : `${Math.floor(Math.round(value)/60)} h ${Math.round(value)%60} min`;
const compactDuration = value => {
  if (value == null) return '—';
  const minutes = Math.max(0,Math.round(value));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes/60)}h ${pad(minutes%60)}m`;
  return `${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h`;
};
const spokenDuration = value => {
  if (value == null) return 'not available';
  const minutes = Math.max(0,Math.round(value)), days = Math.floor(minutes/1440), hours = Math.floor(minutes%1440/60), rest = minutes%60;
  if (days) return `${days} day${days===1?'':'s'}${hours ? ` ${hours} hour${hours===1?'':'s'}` : ''}`;
  if (hours) return `${hours} hour${hours===1?'':'s'}${rest ? ` ${rest} minute${rest===1?'':'s'}` : ''}`;
  return `${rest} minute${rest===1?'':'s'}`;
};
const clockTime = value => value == null ? '—' : `${pad(Math.floor(Math.round(value)/60)%24)}:${pad(Math.round(value)%60)}`;

// Reject invalid dates, duplicate IDs and irrelevant/unrecognised fields.
function validateEvents(input) {
  if (!Array.isArray(input)) throw new Error('The file must contain an events array.');
  const seen = new Set();
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 200 || seen.has(raw.id)) throw new Error('An event has an invalid type or a missing/duplicate ID.');
    seen.add(raw.id);
    if (typeof raw.datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(raw.datetime)) throw new Error('An event has an invalid date/time.');
    // Check calendar fields before Date can silently roll an invalid date forward.
    const [year, month, day, hour, minute] = raw.datetime.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})/).slice(1).map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || (raw.datetime.slice(16,19).startsWith(':') && Number(raw.datetime.slice(17,19)) > 59)) throw new Error('An event has an invalid calendar date/time.');
    const parsed = new Date(raw.datetime);
    if (!Number.isFinite(parsed.getTime())) throw new Error('An event has an invalid date/time.');
    const datetime = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw.datetime) ? localDatetime(parsed) : raw.datetime.slice(0,16);
    const event = {id:raw.id, type:raw.type, datetime, note:''};
    const text = (key, limit) => {if (raw[key] == null) return ''; if (typeof raw[key] !== 'string' || raw[key].length > limit) throw new Error(`Invalid ${key} field.`); return raw[key];};
    event.note = text('note', 2000);
    if (raw.type === 'meal') {event.mealFood = text('mealFood',200); event.mealAmount = text('mealAmount',100);}
    else {
      if (!['inside','outside'].includes(raw.location)) throw new Error('An event has an invalid location.');
      event.location = raw.location;
      if (raw.type === 'poo') {if (!CONSISTENCIES.includes(raw.pooConsistency)) throw new Error('A poo event has an invalid consistency.'); event.pooConsistency = raw.pooConsistency;}
    }
    const instant = key => {
      const value = raw[key];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`Invalid ${key} UTC timestamp.`);
      return value;
    };
    event.createdAt = instant('createdAt'); event.updatedAt = instant('updatedAt');
    event.deletedAt = raw.deletedAt === null ? null : instant('deletedAt');
    if (event.updatedAt < event.createdAt || (event.deletedAt !== null && event.deletedAt > event.updatedAt)) throw new Error('Invalid event modification order.');
    if (typeof raw.mutationId !== 'string' || !/^[a-z0-9-]{1,200}$/.test(raw.mutationId)) throw new Error('Invalid mutation ID.');
    event.mutationId = raw.mutationId;
    if (raw.serverVersion !== null && (!Number.isSafeInteger(raw.serverVersion) || raw.serverVersion < 1)) throw new Error('Invalid serverVersion.');
    event.serverVersion = raw.serverVersion;
    if (raw.syncBaseMutationId !== null && (typeof raw.syncBaseMutationId !== 'string' || !/^[a-z0-9-]{1,200}$/.test(raw.syncBaseMutationId))) throw new Error('Invalid sync baseline.');
    event.syncBaseMutationId = raw.syncBaseMutationId;
    if (event.serverVersion === null && event.syncBaseMutationId !== null) throw new Error('An unsynced event cannot have a sync baseline.');
    if (raw.demo === true) event.demo = true;
    return event;
  });
}

let store = {version:4, householdId:null, demoCleared:true, events:[], syncConflicts:[]};
let discoveredHousehold = null, diaryLoaded = false;
let activeFilter = 'all', activeTab = 'timeline', activePage = 'diary', activeWindow = '14', activeBinSize = 60, hasBinSizePreference = false, timingMetricFilter = 'all', timingView = 'over-time', editingId = null, messageTimer;
let storageBlocked = false;
let mutationQueue = Promise.resolve();

function notify(text) {
  $('message').textContent = text; $('message').hidden = false;
  clearTimeout(messageTimer); messageTimer = setTimeout(() => {$('message').hidden = true;}, 5500);
}

function validateStore(saved) {
  if (!saved || saved.version !== 4 || typeof saved.demoCleared !== 'boolean' || (saved.householdId !== null && (typeof saved.householdId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saved.householdId)))) throw new Error('Unrecognised saved diary.');
  const events = validateEvents(saved.events);
  if (!Array.isArray(saved.syncConflicts)) throw new Error('Invalid conflict copies.');
  const seen = new Set();
  const syncConflicts = saved.syncConflicts.map(copy => {
    if (!copy || typeof copy.id !== 'string' || seen.has(copy.id) || !events.some(event => event.id === copy.id)) throw new Error('Invalid conflict copy.');
    seen.add(copy.id);
    const cloud = copy.cloud === null ? null : validateEvents([copy.cloud])[0];
    if (cloud && (cloud.id !== copy.id || cloud.demo || cloud.serverVersion === null)) throw new Error('Invalid cloud conflict copy.');
    return {id:copy.id,cloud};
  });
  return {...saved, events, syncConflicts};
}

// Legacy upgrades are explicit; current-schema validation never supplies missing metadata.
function upgradeStore(saved) {
  if (saved?.version === 4) return validateStore(saved);
  if (saved?.version === 3) return validateStore({...saved,version:4,syncConflicts:[],events:saved.events.map(event => ({...event,syncBaseMutationId:null}))});
  if (saved?.version === 2) return validateStore({...saved, version:4, householdId:null, syncConflicts:[], events:saved.events.map(event => ({...event,serverVersion:null,syncBaseMutationId:null}))});
  if (!saved || saved.version !== 1 || typeof saved.demoCleared !== 'boolean' || !Array.isArray(saved.events)) throw new Error('Unrecognised legacy diary.');
  const now = new Date().toISOString();
  return validateStore({version:4, householdId:null, syncConflicts:[], demoCleared:saved.demoCleared, events:saved.events.map(event => ({...event, ...eventMetadata(now)}))});
}

// Keep the legacy demo field/backup format, but never retain sample diary rows.
function discardDemo(saved) {
  const events = saved.events.filter(event => event.demo !== true);
  const ids = new Set(events.map(event => event.id));
  return {...saved,events,demoCleared:true,syncConflicts:saved.syncConflicts.filter(copy => ids.has(copy.id))};
}

async function loadStore() {
  try {
    const saved = await diaryRepository.load(upgradeStore);
    if (saved !== null) {
      store = validateStore(saved);
      if (saved.events.some(event => event.demo === true)) {
        // Purge the latest committed diary atomically; this is not a mutation
        // or tombstone and must not dispatch a cloud-write trigger.
        const result = await diaryRepository.transact(current => {
          validateStore(current);
          return discardDemo(current);
        });
        store = validateStore(result.store);
      }
    } else {
      const initialStore = {version:4, householdId:null, demoCleared:true, events:[],syncConflicts:[]};
      await diaryRepository.save(initialStore, {initializeOnly:true});
      store = validateStore(await diaryRepository.load(upgradeStore));
    }
    diaryLoaded = true;
  } catch (error) {
    // Never overwrite unreadable saved data or claim it has been saved.
    storageBlocked = true;
    notify('Saved diary could not be opened. Storage may be unavailable; existing data has not been overwritten.');
  }
}

function commit(updateEvents, demoCleared, importedConflicts) {
  // Compute each mutation after the previous save finishes, preserving rapid taps.
  const pending = mutationQueue.then(async () => {
    if (storageBlocked) {notify('Storage is unavailable. Restore browser storage access before making changes.'); return false;}
    let next;
    try {
      ({store:next} = await diaryRepository.transact(saved => {
        const events = typeof updateEvents === 'function' ? updateEvents(saved.events) : updateEvents;
        return validateStore({...saved,demoCleared:demoCleared ?? saved.demoCleared,events,
          syncConflicts:Array.from(new Map([...(importedConflicts || []),...saved.syncConflicts].map(copy => [copy.id,copy])).values()).filter(copy => events.some(event => event.id === copy.id))});
      }));
    }
    catch (error) {notify('Could not save. Browser storage may be full or unavailable. Export a backup.'); return false;}
    store = next; render(); renderHouseholdBinding();
    window.dispatchEvent(new Event('bella-local-save')); return true;
  });
  mutationQueue = pending.catch(() => {});
  return pending;
}

function refreshStore() {
  // Cross-window reads share the queue so they cannot replace a pending local save.
  mutationQueue = mutationQueue.then(async () => {await loadStore(); render(); renderHouseholdBinding();});
}

// Household discovery supplies authorization; sync links an unbound diary.
function renderHouseholdBinding() {
  const userId = window.bellaAuth?.getUser()?.id;
  const discovered = discoveredHousehold?.userId === userId ? discoveredHousehold : null;
  $('household-binding').hidden = !userId;
  const mismatch = discovered && store.householdId !== null && store.householdId !== discovered.id;
  $('binding-status').textContent = mismatch ? 'Household mismatch: this local diary belongs to another household. It will not be rebound; sync is paused.'
    : store.householdId ? 'Local diary linked to this household'
    : 'Local diary will link automatically after household discovery.';
}
if (typeof window !== 'undefined') {
  window.addEventListener('bella-household-discovered',event => {discoveredHousehold = event.detail; renderHouseholdBinding();});
  window.addEventListener('bella-auth-change',() => {
    if (discoveredHousehold?.userId !== window.bellaAuth?.getUser()?.id) discoveredHousehold = null;
    renderHouseholdBinding();
  });
  window.addEventListener('offline',renderHouseholdBinding);
  window.addEventListener('online',renderHouseholdBinding);
}

function filteredEvents(events = activeEvents()) {
  return events.filter(event => activeFilter === 'all' || (activeFilter === 'accidents' ? accident(event) : event.type === activeFilter)).sort((a,b) => b.datetime.localeCompare(a.datetime));
}

function streak(events) {
  const dates = [...new Set(events.map(dateOf))].sort().reverse();
  if (!dates.length) return 0;
  let expected = dates[0], count = 0;
  for (const date of dates) {
    if (date !== expected || events.some(event => dateOf(event) === date && accident(event))) break;
    count++; expected = previousDate(date);
  }
  return count;
}

function details(event) {
  if (event.type === 'meal') return [event.mealFood, event.mealAmount].filter(Boolean).join(' · ') || 'Meal';
  return [accident(event) ? 'Inside accident' : 'Outside', event.pooConsistency].filter(Boolean).join(' · ');
}

function axisHTML(now = null) {
  const label = now ? (() => {const minute=now.getHours()*60+now.getMinutes(), nearest=Math.round(minute/240)*240;return `<span class="now-axis-label${Math.abs(minute-nearest)<60?' near-tick':''}" data-now-axis-label style="left:${minute/1440*100}%">Now</span>`;})() : '';
  return '<div class="axis-row"><span></span><div class="axis">' + [0,4,8,12,16,20,24].map(hour => `<span style="left:${hour/24*100}%">${pad(hour)}</span>`).join('') + label + '</div></div>';
}

function markHTML(event) {
  const label = `${shortDate(dateOf(event))}, ${event.datetime.slice(11,16)}, ${titleCase(event.type)}, ${details(event)}${event.note ? ', '+event.note : ''}`;
  const inner = `<span class="symbol ${event.type}"></span>${accident(event) ? '<span class="badge" aria-hidden="true">!</span>' : ''}`;
  return `<button class="event-mark" data-id="${escapeHTML(event.id)}" style="left:${position(event)}%" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${inner}</button>`;
}

function renderHeader(events, now = new Date()) {
  const stats = statistics(events);
  const since = type => {
    const latest = events.filter(event => event.type === type).reduce((found,event) => !found || Date.parse(event.datetime) > Date.parse(found.datetime) ? event : found,null);
    if (!latest) return null;
    const elapsed = (now.getTime()-new Date(latest.datetime).getTime())/60000;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  };
  const metrics = [
    {value:new Set(events.map(dateOf)).size,label:'Days tracked',aria:`${new Set(events.map(dateOf)).size} days tracked`},
    {value:compactDuration(since('wee')),description:'Since last wee',median:`Median ${compactDuration(stats.interval)}`,aria:`Time since last wee: ${spokenDuration(since('wee'))}. Median wee interval: ${spokenDuration(stats.interval)}.`},
    {value:compactDuration(since('meal')),description:'Since last meal',median:`Meal → poo median ${compactDuration(stats.mealPoo)}`,aria:`Time since last meal: ${spokenDuration(since('meal'))}. Median meal to poo: ${spokenDuration(stats.mealPoo)}.`},
    {value:compactDuration(since('poo')),description:'Since last poo',median:`Median ${compactDuration(stats.pooInterval)}`,aria:`Time since last poo: ${spokenDuration(since('poo'))}. Median poo interval: ${spokenDuration(stats.pooInterval)}.`},
    {value:streak(events),label:'Days accident-free',aria:`${streak(events)} days accident-free`}
  ];
  $('summary').innerHTML = metrics.map((metric,index) => `<div class="metric${index>0&&index<4?' decision-metric':''}" aria-label="${escapeHTML(metric.aria)}"><strong>${metric.value}</strong>${metric.description ? `<span class="metric-description">${escapeHTML(metric.description)}</span><span class="metric-median">${escapeHTML(metric.median)}</span>` : `<span>${escapeHTML(metric.label)}</span>`}</div>`).join('');
}

function bucketDistribution(events, type, trackedDays, binMinutes = activeBinSize, {distinctDays = false} = {}) {
  const bucketCount = Math.ceil(1440/binMinutes);
  const buckets = Array.from({length:bucketCount}, () => ({count:0, dates:new Set()}));
  const matching = events.filter(event => distinctDays ? accident(event) : event.type === type);
  matching.forEach(event => {const bucket = buckets[Math.floor(minutesOf(event)/binMinutes)]; bucket.count++; bucket.dates.add(dateOf(event));});
  const peak = Math.max(0,...buckets.map(bucket => distinctDays ? bucket.dates.size : bucket.count));
  return buckets.map(bucket => ({count:bucket.count, days:bucket.dates.size, percent:matching.length ? Math.round(bucket.count/matching.length*100) : 0, strength:peak ? (distinctDays ? bucket.dates.size : bucket.count)/peak : 0, total:matching.length, diaryDays:trackedDays}));
}

function defaultBinSize(trackedDays) {return trackedDays<=5?120:trackedDays<=8?90:60;}

function bucketTime(minute) {return `${pad(Math.floor(minute/60))}:${pad(minute%60)}`;}

function renderAggregate(events, now = new Date()) {
  const today = localDate(now);
  const cutoff = activeWindow === 'all' ? null : (() => {const day = new Date(`${today}T12:00`); day.setDate(day.getDate() - Number(activeWindow) + 1); return localDate(day);})();
  const windowEvents = activeWindow === 'all' ? events : events.filter(event => dateOf(event) >= cutoff && dateOf(event) <= today);
  const trackedDays = new Set(windowEvents.map(dateOf)).size;
  if (!hasBinSizePreference) activeBinSize = defaultBinSize(trackedDays);
  $('aggregate-bin-size').value = String(activeBinSize);
  const rows = [
    {type:'wee',label:'Wees',className:'wee-buckets'},
    {type:'poo',label:'Poos',className:'poo-buckets'},
    {type:'meal',label:'Meals',className:'meal-buckets'},
    {type:'accidents',label:'Accidents',className:'accident-buckets',distinctDays:true}
  ];
  const windowName = activeWindow === 'all' ? 'all time' : `the last ${activeWindow} days`;
  $('aggregate-count').textContent = `${trackedDays} ${trackedDays === 1 ? 'diary day' : 'diary days'} · ${windowEvents.length} events`;
  const bucketCount = Math.ceil(1440/activeBinSize);
  $('aggregate').innerHTML = axisHTML(now) + rows.map(({type,label,className,distinctDays}) => `<div class="time-row aggregate-row"><div class="date-label">${label}</div><div class="plot bucket-strip ${className}" style="--bucket-count:${bucketCount}">${bucketDistribution(windowEvents,type,trackedDays,activeBinSize,{distinctDays}).map(({count,days,percent,strength,total,diaryDays},index) => {
    const start=index*activeBinSize, end=start+activeBinSize;
    const interval=`${bucketTime(start)}–${bucketTime(end)}`;
    const detail = total ? (distinctDays ? `Seen on ${days} of ${diaryDays} diary days; ${count} recorded accident${count===1?'':'s'}. Shading: ${Math.round(strength*100)}% of this row's busiest time bin` : `${percent}% of recorded ${label.toLowerCase()} (${count} of ${total}); seen on ${days} of ${diaryDays} diary days. Shading: ${Math.round(strength*100)}% of this row's busiest bucket`) : `no recorded ${distinctDays?'accidents':label.toLowerCase()} ${windowName}`;
    const bucketLabel = `${label}, ${interval}, ${windowName}: ${detail}`;
    return `<button class="hour-bucket" style="--strength:${strength}" data-bucket-label="${escapeHTML(bucketLabel)}" aria-label="${escapeHTML(bucketLabel)}" title="${escapeHTML(bucketLabel)}"></button>`;
  }).join('')}<span class="timeline-now aggregate-now" style="left:${currentTimePercent(now)}%" aria-hidden="true"></span></div></div>`).join('');
}

function currentTimePercent(now = new Date()) {return (now.getHours()*60+now.getMinutes())/1440*100;}

function updateNowMarker(now = new Date()) {
  const percent=currentTimePercent(now), minute=now.getHours()*60+now.getMinutes(), nearest=Math.round(minute/240)*240;
  document.querySelectorAll('#aggregate .aggregate-now, #timeline .timeline-now').forEach(line => {line.style.left=`${percent}%`;});
  document.querySelectorAll('#aggregate [data-now-axis-label], #timeline [data-now-axis-label]').forEach(label => {label.style.left=`${percent}%`;label.classList.toggle('near-tick',Math.abs(minute-nearest)<60);});
  $('timeline').setAttribute('aria-label',`Diary timeline. Current time ${localTime(now)}.`);
}

function renderTimeline(events, allEvents, now = new Date()) {
  const dates = [...new Set(allEvents.map(dateOf))].sort().reverse();
  const groups = new Map(dates.map(date => [date,[]]));
  const totals = new Map(dates.map(date => [date,Object.fromEntries(TYPES.map(type => [type,0]))]));
  allEvents.forEach(event => totals.get(dateOf(event))[event.type]++);
  events.forEach(event => groups.get(dateOf(event)).push(event));
  $('timeline').innerHTML = axisHTML(now) + (dates.length ? dates.map(date => {
    const dayEvents = groups.get(date);
    const dayCounts = totals.get(date);
    const summaryLabel = `${dayCounts.wee} ${dayCounts.wee === 1 ? 'wee' : 'wees'}, ${dayCounts.poo} ${dayCounts.poo === 1 ? 'poo' : 'poos'}, ${dayCounts.meal} ${dayCounts.meal === 1 ? 'meal' : 'meals'}`;
    return `<div class="time-row ${date === localDate(now) ? 'today' : ''}"><div class="date-label"><span class="day-date">${shortDate(date)}</span><span class="day-summary" role="img" aria-label="${summaryLabel}">${TYPES.map(type => `<span class="day-count"><span class="symbol ${type}" aria-hidden="true"></span><span aria-hidden="true">${dayCounts[type]}</span></span>`).join('')}</span></div><div class="plot"><span class="timeline-now" style="left:${currentTimePercent(now)}%" aria-hidden="true"></span>${dayEvents.slice().reverse().map(event => markHTML(event)).join('')}</div></div>`;
  }).join('') : '<p class="empty">A fresh start for Bella. Tap + Wee, + Poo or + Meal to begin.</p>');
  if (dates.length && !events.length) $('timeline').insertAdjacentHTML('beforeend','<p class="empty">No events match this filter.</p>');
  updateNowMarker(now);
}

function renderTable(events) {
  $('data').innerHTML = events.length ? `<table><thead><tr><th>Date / time</th><th>Type</th><th>Details</th><th class="note-column">Note</th><th><span class="muted">Edit</span></th></tr></thead><tbody>${events.map(event => `<tr data-id="${escapeHTML(event.id)}"><td>${shortDate(dateOf(event))}<br>${event.datetime.slice(11,16)}</td><td><span class="symbol ${event.type}" aria-hidden="true"></span>${titleCase(event.type)}</td><td>${escapeHTML(details(event))}${accident(event) ? ' <span class="accident-example" aria-label="Inside accident">!</span>' : ''}<span class="table-note-inline">${escapeHTML(event.note)}</span></td><td class="note-column">${escapeHTML(event.note)}</td><td><button data-id="${escapeHTML(event.id)}" aria-label="Edit ${event.type} on ${escapeHTML(shortDate(dateOf(event)))} at ${event.datetime.slice(11,16)}">Edit</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No events to show. Try another filter or add an entry.</p>';
}

function intervalObservations(events, type) {
  const series=events.filter(event=>event.type===type);
  const observations=[];
  for (let i=1;i<series.length;i++) {
    const startEvent=series[i-1], endEvent=series[i], minutes=(new Date(endEvent.datetime)-new Date(startEvent.datetime))/60000;
    if (type==='wee' && accident(startEvent)) continue;
    if (minutes>0 && minutes<=24*60) observations.push({metric:type,startEvent,endEvent,completedAt:new Date(endEvent.datetime).getTime(),minutes});
  }
  return observations;
}

function timingObservations(events) {
  const sorted = events.filter(event => isActiveEvent(event) && event.demo !== true).slice().sort((a,b) => a.datetime.localeCompare(b.datetime));
  const observations = {wee:intervalObservations(sorted,'wee'),poo:intervalObservations(sorted,'poo'),'meal-poo':[]};
  let mealCandidate=null;
  for (const event of sorted) {
    if (event.type==='meal') {mealCandidate=event;continue;}
    if (event.type!=='poo' || !mealCandidate) continue;
    const minutes=(new Date(event.datetime)-new Date(mealCandidate.datetime))/60000;
    if (minutes>0) {
      if (minutes<=12*60) observations['meal-poo'].push({metric:'meal-poo',startEvent:mealCandidate,endEvent:event,completedAt:new Date(event.datetime).getTime(),minutes});
      mealCandidate=null;
    }
  }
  for (const series of Object.values(observations)) series.sort((a,b)=>a.completedAt-b.completedAt);
  return observations;
}

function trailingMedianObservations(series) {
  let first=0;
  return series.map((item,index)=>{
    const cutoff=item.completedAt-72*3600000;
    while(first<index&&series[first].completedAt<cutoff)first++;
    return {item,median:median(series.slice(first,index+1).map(candidate=>candidate.minutes))};
  });
}

function percentileRank(index,count) {return count===1?50:index/(count-1)*100;}

function statistics(events) {
  const sorted = [...events].sort((a,b) => a.datetime.localeCompare(b.datetime));
  const dates = [...new Set(events.map(dateOf))];
  const observations=timingObservations(events);
  const daytime = observations.wee.filter(({startEvent:a,endEvent:b}) => dateOf(a) === dateOf(b) && minutesOf(a) >= DAY_START && minutesOf(b) <= DAY_END).map(item=>item.minutes);
  const overnight = observations.wee.filter(({startEvent:a,endEvent:b}) => previousDate(dateOf(b)) === dateOf(a) && minutesOf(a) >= DAY_END && minutesOf(b) <= DAY_START).map(item=>item.minutes);
  const firsts = type => dates.map(date => sorted.find(event => event.type === type && dateOf(event) === date)).filter(Boolean).map(minutesOf);
  const meals = sorted.filter(event => event.type === 'meal');
  const mealTimes = [[],[],[]];
  dates.forEach(date => {
    const daily = meals.filter(event => dateOf(event) === date);
    if (daily.length === 3) daily.forEach((meal,index) => mealTimes[index].push(minutesOf(meal)));
  });
  const afterMeal = (type,maxHours) => meals.map(meal => {
    const next = sorted.find(event => event.type === type && new Date(event.datetime) > new Date(meal.datetime));
    return next ? (new Date(next.datetime)-new Date(meal.datetime))/60000 : null;
  }).filter(value => value !== null && value > 0 && value <= maxHours*60);
  const frequency = type => dates.length >= MIN_SAMPLES ? (events.filter(event => type === 'accidents' ? accident(event) : event.type === type).length/dates.length).toFixed(1) : '—';
  return {frequency, interval:median(observations.wee.map(item=>item.minutes)), pooInterval:median(observations.poo.map(item=>item.minutes)), daytime:daytime.length >= MIN_SAMPLES ? Math.max(...daytime) : null, overnight:overnight.length >= MIN_SAMPLES ? Math.max(...overnight) : null, firstWee:median(firsts('wee')), firstPoo:median(firsts('poo')), mealTimes:mealTimes.map(median), mealWee:median(afterMeal('wee',6)), mealPoo:median(observations['meal-poo'].map(item=>item.minutes))};
}

function renderStats(events) {
  const s = statistics(events);
  const groups = [
    ['Frequency', [['Wees / day',s.frequency('wee')],['Poos / day',s.frequency('poo')],['Meals / day',s.frequency('meal')],['Accidents / day',s.frequency('accidents')],['Accident-free streak',`${streak(events)} days`]]],
    ['Timing', [['Median wee interval',duration(s.interval)],['Median poo interval',duration(s.pooInterval)],['Longest daytime gap',duration(s.daytime)],['Longest overnight gap',duration(s.overnight)],['Typical first wee',clockTime(s.firstWee)],['Typical first poo',clockTime(s.firstPoo)],['Typical meals',s.mealTimes.every(v => v !== null) ? s.mealTimes.map(clockTime).join(' · ') : '—']]],
    ['After a meal', [['Median time to wee',duration(s.mealWee)],['Median time to poo',duration(s.mealPoo)]]]
  ];
  $('stats').innerHTML = groups.map(([heading,rows]) => `<div><h3>${heading}</h3>${rows.map(([label,value]) => `<div class="stat-line"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`).join('');
}

const CHART_SERIES = {
  wee:{label:'Wee gap',eventType:'wee',symbol:'circle'},
  poo:{label:'Poo gap',eventType:'poo',symbol:'diamond'},
  'meal-poo':{label:'Meal → poo',eventType:'meal',symbol:'triangle'}
};

function chartPointLabel(item) {
  const date=shortDate(dateOf(item.endEvent)), time=item.endEvent.datetime.slice(11,16), elapsed=compactDuration(item.minutes);
  if (item.metric==='meal-poo') return `Meal → poo\n${date}\nMeal ${item.startEvent.datetime.slice(11,16)}\nPoo ${time}\n${elapsed}`;
  return `${CHART_SERIES[item.metric].label}\n${date} ${time}\n${elapsed}\nPrevious ${item.metric} ${item.startEvent.datetime.slice(11,16)}`;
}

function chartMarker(symbol,x,y,size=5) {
  if (symbol==='diamond') return `<rect x="${x-size}" y="${y-size}" width="${size*2}" height="${size*2}" transform="rotate(45 ${x} ${y})"/>`;
  if (symbol==='triangle') return `<path d="M ${x} ${y-size-1} L ${x+size+1} ${y+size} L ${x-size-1} ${y+size} Z"/>`;
  return `<circle cx="${x}" cy="${y}" r="${size}"/>`;
}

function chartSeriesClass(metric) {return `chart-series-${metric.replaceAll(' ','-')}`;}

function renderTimingChart(events) {
  const all=timingObservations(events), enabled=timingMetricFilter==='all'?Object.keys(CHART_SERIES):[timingMetricFilter];
  const series=enabled.map(metric=>({metric,items:all[metric]}));
  const items=series.flatMap(row=>row.items);
  document.querySelectorAll('[data-chart-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chartFilter===timingMetricFilter)));
  document.querySelectorAll('[data-chart-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.chartView===timingView)));
  const target=$('timing-chart-plot'), detail=$('timing-point-detail');
  detail.textContent='Hover over, tap or focus a point to inspect its events.';
  if (!items.length) {target.innerHTML='<p class="empty">Not enough data yet</p>';return;}

  const W=Math.max(320,target.clientWidth||document.querySelector('main').clientWidth),H=430,left=W<600?54:76,right=W<600?12:22,top=24,bottom=58,plotW=W-left-right,plotH=H-top-bottom;
  const maxMinutes=Math.max(...items.map(item=>item.minutes)), yMax=Math.max(30,maxMinutes*1.1);
  const y=value=>top+plotH*(1-value/yMax);
  const minTime=Math.min(...items.map(item=>item.completedAt)), maxTime=Math.max(...items.map(item=>item.completedAt)), sameTime=minTime===maxTime;
  const xMin=timingView==='ordered'?0:(sameTime?minTime-12*3600000:minTime), xMax=timingView==='ordered'?100:(sameTime?maxTime+12*3600000:maxTime);
  const x=value=>left+(value-xMin)/(xMax-xMin)*plotW;
  const yTicks=[30,60,120,240,360,480,720,960,1200,1440].filter(value=>value<maxMinutes);
  if (maxMinutes>0 && !yTicks.length) yTicks.push(Math.round(maxMinutes/2));
  const grid=yTicks.map(value=>`<line class="chart-grid" x1="${left}" x2="${W-right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-axis-label y-axis-label" x="${left-10}" y="${y(value)+4}" text-anchor="end">${compactDuration(value)}</text>`).join('');
  const tickFractions=W<600?[0,.5,1]:[0,.25,.5,.75,1];
  const xTicks=timingView==='ordered'?tickFractions.map(fraction=>({value:fraction*100,label:`${Math.round(fraction*100)}%`})):
    tickFractions.map(fraction=>{const value=xMin+(xMax-xMin)*fraction,date=new Date(value),label=date.toLocaleDateString('en-GB',{day:'numeric',month:'short'}),sameDay=new Date(minTime).toDateString()===new Date(maxTime).toDateString();return {value,label:sameDay?`${localTime(date)}`:label};});
  const xAxis=xTicks.map(tick=>`<line class="chart-tick" x1="${x(tick.value)}" x2="${x(tick.value)}" y1="${top+plotH}" y2="${top+plotH+5}"/><text class="chart-axis-label" x="${x(tick.value)}" y="${top+plotH+21}" text-anchor="middle">${escapeHTML(tick.label)}</text>`).join('');
  const axisTitle=timingView==='ordered'?'Position in each metric’s duration distribution':'Completed at';
  const chartParts=[];
  for (const row of series) {
    const ordered=timingView==='ordered'?[...row.items].sort((a,b)=>a.minutes-b.minutes||a.completedAt-b.completedAt):row.items;
    const positioned=ordered.map((item,index)=>({item,x:timingView==='ordered'?x(percentileRank(index,ordered.length)):x(item.completedAt),y:y(item.minutes)}));
    const seriesClass=chartSeriesClass(row.metric);
    if (timingView==='over-time') {
      const medians=trailingMedianObservations(row.items).map((trend,index)=>({...positioned[index],median:trend.median}));
      let segment=[];
      const flush=()=>{if(segment.length>1)chartParts.push(`<path class="chart-trend ${seriesClass}" d="${segment.map((point,index)=>`${index?'L':'M'} ${point.x} ${y(point.median)}`).join(' ')}"/>`);segment=[];};
      medians.forEach(point=>{if(point.median===null)flush();else {segment.push(point);chartParts.push(`<circle class="chart-trend-point ${seriesClass}" cx="${point.x}" cy="${y(point.median)}" r="2.5"/>`);}});flush();
    } else if (ordered.length) {
      const med=median(ordered.map(item=>item.minutes)), center=x(50);
      if (positioned.length>1) chartParts.push(`<path class="chart-ordered ${seriesClass}" d="${positioned.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ')}"/>`);
      if (ordered.length>=MIN_SAMPLES) chartParts.push(`<g class="chart-reference ${seriesClass}" tabindex="0" role="img" aria-label="${escapeHTML(`${CHART_SERIES[row.metric].label}: median ${compactDuration(med)} at the 50th percentile.`)}"><title>${escapeHTML(`${CHART_SERIES[row.metric].label}: median ${compactDuration(med)}`)}</title>${chartMarker(CHART_SERIES[row.metric].symbol,center,y(med),6)}</g>`);
    }
    for (const point of positioned) {
      const label=chartPointLabel(point.item), plain=label.replaceAll('\n','. '),symbol=CHART_SERIES[row.metric].symbol;
      chartParts.push(`<g class="chart-point ${seriesClass}" transform="translate(${point.x} ${point.y})" tabindex="0" role="button" aria-label="${escapeHTML(plain)}" data-metric="${row.metric}" data-point-detail="${escapeHTML(plain)}"><title>${escapeHTML(label)}</title><circle class="chart-hit-area" r="10"/>${chartMarker(symbol,0,0,4)}</g>`);
    }
  }
  const ticksY=`<line class="chart-axis" x1="${left}" x2="${left}" y1="${top}" y2="${top+plotH}"/><line class="chart-axis" x1="${left}" x2="${W-right}" y1="${top+plotH}" y2="${top+plotH}"/>`;
  const hasQualifiedDistribution=series.some(row=>row.items.length>=MIN_SAMPLES);
  const orderedIqrBand=timingView==='ordered'&&hasQualifiedDistribution?`<rect class="chart-iqr-band" x="${x(25)}" y="${top}" width="${x(75)-x(25)}" height="${plotH}" aria-hidden="true"/>`:'';
  target.innerHTML=`<svg class="timing-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${timingView==='ordered'?'Ordered timing observations and distributions':'Timing observations over time'}"><g>${orderedIqrBand}${grid}${ticksY}${xAxis}<text class="chart-axis-title" x="${left+plotW/2}" y="${H-8}" text-anchor="middle">${axisTitle}</text>${chartParts.join('')}</g></svg>`;
}

function render() {
  const allEvents = activeEvents(), events = filteredEvents(allEvents);
  renderHeader(allEvents); renderAggregate(allEvents); renderTimeline(events,allEvents); renderTable(events); renderStats(allEvents);
  $('timeline').hidden = activeTab !== 'timeline'; $('data').hidden = activeTab !== 'data';
  $('diary-page').hidden = activePage !== 'diary'; $('stats-page').hidden = activePage !== 'stats';
  if (activePage==='stats') renderTimingChart(allEvents);
  document.querySelectorAll('[data-page]').forEach(button => {const selected = button.dataset.page === activePage; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;});
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.filter === activeFilter)));
  document.querySelectorAll('[data-tab]').forEach(button => {const selected = button.dataset.tab === activeTab; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;});
}

async function quickAdd(type, location = 'outside') {
  const event = {id:uniqueId(),type,datetime:localDatetime(new Date()),note:'', ...eventMetadata()};
  if (type === 'meal') {event.mealFood = ''; event.mealAmount = '';}
  else {event.location = location; if (type === 'poo') event.pooConsistency = 'Normal';}
  const visible = activeFilter === 'all' || activeFilter === type || (activeFilter === 'accidents' && accident(event));
  if (await commit(events => [...events,event])) notify(`${location === 'inside' && type !== 'meal' ? 'Inside '+type : titleCase(type)} saved at ${event.datetime.slice(11,16)}${visible ? '' : ' · hidden by current filter'}`);
}

function editorFields() {
  const type = $('event-form').elements.type.value;
  $('location-field').hidden = type === 'meal'; $('consistency-field').hidden = type !== 'poo'; $('meal-fields').hidden = type !== 'meal';
}

function openEditor(id = null) {
  const event = id ? activeEvents().find(event => event.id === id) : null;
  if (id && !event) return;
  editingId = id;
  const form = $('event-form'); form.reset();
  const data = event || {type:'wee',datetime:localDatetime(new Date()), location:'outside',pooConsistency:'Normal'};
  for (const key of ['type','location','pooConsistency','mealFood','mealAmount','note']) if (data[key] != null) form.elements[key].value = data[key];
  form.elements.date.value = dateOf(data); form.elements.time.value = data.datetime.slice(11,16);
  $('editor-title').textContent = id ? 'Edit entry' : 'Custom entry'; $('delete-event').hidden = !id;
  editorFields(); $('editor').showModal();
}

async function saveEditor(event) {
  event.preventDefault();
  const form = $('event-form'), value = key => form.elements[key].value;
  const entry = {id:editingId || uniqueId(),type:value('type'),datetime:`${value('date')}T${value('time')}`,note:value('note'), ...eventMetadata()};
  if (entry.type === 'meal') {entry.mealFood = value('mealFood'); entry.mealAmount = value('mealAmount');}
  else {entry.location = value('location'); if (entry.type === 'poo') entry.pooConsistency = value('pooConsistency');}
  // Preserve existing creation metadata and accepted sync baseline.
  const existing = editingId ? activeEvents().find(event => event.id === editingId) : null;
  if (editingId && !existing) {notify('This entry is no longer active.'); return;}
  if (existing) {entry.createdAt = existing.createdAt; entry.serverVersion = existing.serverVersion; entry.syncBaseMutationId = existing.syncBaseMutationId; if (existing.demo) entry.demo = true;}
  try {validateEvents([entry]);} catch (error) {notify(error.message); return;}
  const id = editingId;
  if (await commit(events => id ? events.map(event => event.id === id && isActiveEvent(event) ? {...entry, createdAt:event.createdAt, serverVersion:event.serverVersion, syncBaseMutationId:event.syncBaseMutationId} : event) : [...events,entry])) {$('editor').close(); notify('Entry saved');}
}

function download(filename,content,type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
}

function exportJSON() {download(`bellas-diary-${localDate(new Date())}.json`,JSON.stringify({version:2,exportedAt:new Date().toISOString(),demoCleared:store.demoCleared,events:store.events,...(store.syncConflicts.length ? {syncConflicts:store.syncConflicts} : {})},null,2),'application/json');}

function exportCSV() {
  const keys = ['id','datetime','date','time','type','location','pooConsistency','mealFood','mealAmount','note'];
  // Guard against spreadsheet formula execution while retaining a readable text value.
  const cell = value => {let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"';};
  const lines = [keys.join(','), ...[...activeEvents()].sort((a,b) => b.datetime.localeCompare(a.datetime)).map(event => keys.map(key => cell(key === 'date' ? dateOf(event) : key === 'time' ? event.datetime.slice(11,16) : event[key])).join(','))];
  download(`bellas-diary-${localDate(new Date())}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
}

async function importJSON(file) {
  if (!file) return;
  try {
    if (file.size > 10*1024*1024) throw new Error('Please choose a JSON backup smaller than 10 MB.');
    const data = JSON.parse(await file.text());
    if (!data || ![1,2].includes(data.version)) throw new Error('Please choose a version 1 or 2 Bella’s Diary JSON backup.');
    const restored = discardDemo(data.version === 1 ? upgradeStore({...data, demoCleared:true}) : validateStore({...data,version:4,householdId:store.householdId,syncConflicts:data.syncConflicts || [],events:data.events?.map(event => ({...event,serverVersion:event.serverVersion === undefined ? null : event.serverVersion,syncBaseMutationId:event.syncBaseMutationId === undefined ? null : event.syncBaseMutationId}))}));
    const events = restored.events, count = events.filter(isActiveEvent).length;
    if (!confirm(`Import ${count} events? This REPLACES all ${activeEvents().length} current entries. Export a backup first if you want to keep them.`)) return;
    if (await commit(events,restored.demoCleared,restored.syncConflicts)) notify(`Imported ${count} events`);
  } catch (error) {notify(`Import failed: ${error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message}`);}
  finally {$('import-file').value = '';}
}

function connectEvents() {
  try {const savedWindow = localStorage.getItem(WINDOW_KEY); if (['7','14','30','all'].includes(savedWindow)) activeWindow = savedWindow;} catch {}
  // Recalculate the default from the current diary on every load. In-session
  // selector changes still take effect until the next load.
  hasBinSizePreference = false;
  $('aggregate-window').value = activeWindow;
  $('aggregate-bin-size').value = String(activeBinSize);
  $('aggregate-window').addEventListener('change',event => {
    activeWindow = event.target.value;
    try {localStorage.setItem(WINDOW_KEY,activeWindow);} catch {notify('Could not save the pattern window on this device.');}
    renderAggregate(activeEvents());
  });
  $('aggregate-bin-size').addEventListener('change',event => {
    activeBinSize = ['30','60','90','120'].includes(event.target.value) ? Number(event.target.value) : 60;
    hasBinSizePreference = true;
    event.target.value = String(activeBinSize);
    renderAggregate(activeEvents());
  });
  $('timing-chart-controls').addEventListener('click',event=>{
    const filter=event.target.closest('[data-chart-filter]'), view=event.target.closest('[data-chart-view]');
    if (filter) timingMetricFilter=filter.dataset.chartFilter;
    if (view) timingView=view.dataset.chartView;
    if (filter||view) renderTimingChart(activeEvents());
  });
  $('timing-chart-plot').addEventListener('click',event=>{const point=event.target.closest('[data-point-detail]');if(point)$('timing-point-detail').textContent=point.dataset.pointDetail;});
  $('timing-chart-plot').addEventListener('focusin',event=>{const point=event.target.closest('[data-point-detail]');if(point)$('timing-point-detail').textContent=point.dataset.pointDetail;});
  $('timing-chart-plot').addEventListener('mouseover',event=>{const point=event.target.closest('[data-point-detail]');if(point)$('timing-point-detail').textContent=point.dataset.pointDetail;});
  $('timing-chart-plot').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-point-detail]')){event.preventDefault();$('timing-point-detail').textContent=event.target.dataset.pointDetail;}});
  $('more-menu').addEventListener('click',event => {if (event.target.closest('button') && !event.target.closest('#cloud-account')) setTimeout(() => {$('more-menu').open = false;},0);});
  document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click',() => quickAdd(button.dataset.add,button.dataset.location || 'outside')));
  $('aggregate').addEventListener('click',event => {const bucket = event.target.closest('[data-bucket-label]'); if (bucket) notify(bucket.dataset.bucketLabel);});
  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click',() => {activePage = button.dataset.page; render();});
    button.addEventListener('keydown',event => {if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {event.preventDefault(); activePage = event.key === 'Home' ? 'diary' : event.key === 'End' ? 'stats' : activePage === 'diary' ? 'stats' : 'diary'; render(); $(`${activePage}-page-tab`).focus();}});
  });
  $('custom').addEventListener('click',() => openEditor());
  $('filters').addEventListener('click',event => {const button = event.target.closest('[data-filter]'); if (button) {activeFilter = button.dataset.filter; render();}});
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click',() => {activeTab = button.dataset.tab; render();});
    button.addEventListener('keydown',event => {if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {event.preventDefault(); activeTab = event.key === 'Home' ? 'timeline' : event.key === 'End' ? 'data' : activeTab === 'timeline' ? 'data' : 'timeline'; render(); $(`${activeTab}-tab`).focus();}});
  });
  for (const id of ['timeline','data']) $(id).addEventListener('click',event => {const entry = event.target.closest('[data-id]'); if (entry) openEditor(entry.dataset.id);});
  $('event-form').elements.type.addEventListener('change',editorFields);
  $('event-form').addEventListener('submit',saveEditor);
  for (const id of ['close-editor','cancel-editor']) $(id).addEventListener('click',() => $('editor').close());
  $('delete-event').addEventListener('click',async () => {const id = editingId; if (id && confirm('Delete this entry?') && await commit(events => {const now = new Date().toISOString(); return events.map(event => event.id === id && isActiveEvent(event) ? {...event, updatedAt:now, deletedAt:now, mutationId:uniqueId()} : event);})) {$('editor').close(); notify('Entry deleted');}});
  $('export-json').addEventListener('click',exportJSON); $('export-csv').addEventListener('click',exportCSV);
  $('import-json').addEventListener('click',() => $('import-file').click());
  $('import-file').addEventListener('change',event => importJSON(event.target.files[0]));
  diaryRepository.subscribe(refreshStore);
  window.addEventListener('focus',refreshStore);
  document.addEventListener('visibilitychange',() => {if (!document.hidden) refreshStore();});
  // Refresh today's counts when the local calendar date changes while open.
  let lastDate = localDate(new Date());
  setInterval(() => {const now = new Date(), date = localDate(now); if (date !== lastDate) {lastDate = date; render();} else {renderHeader(activeEvents(),now);updateNowMarker(now);}},60000);
}

const RULES = '<p>Statistics use the entire diary, independently of the view filter. Frequencies divide totals by the number of dates with entries and need at least three tracked dates. A dash means there is not enough data.</p><p>The accident-free streak starts on the latest recorded date and counts backwards through consecutive calendar dates with entries and no inside wee or poo. A missing date or an accident stops it. It is a streak of recorded days, not a claim about unrecorded days.</p><p>Intervals use actual elapsed minutes between consecutive wees and poos; zero-length gaps and gaps over 24 hours are excluded. Wee intervals start only at an outdoor wee; an inside accident can end the interval but never starts another. Daytime gaps have both endpoints on the same day between 06:00 and 22:00. Overnight gaps run from 22:00 or later to 06:00 or earlier on the next date. Other gaps count only towards the overall median. Interval medians and longest gaps need three qualifying examples.</p><p>First-event times use a median of at least three days. Typical meals are the medians of the first, second and third meals on days with exactly three meals; each needs three days. Meal-to-toilet medians use the next wee within 6 hours or the first poo after the most recent unpaired meal within 12 hours; each poo is used at most once. At least three qualifying examples are required. These are diary heuristics.</p>';

async function setupOffline() {
  if (!('serviceWorker' in navigator)) {$('offline-status').textContent = 'Offline caching is unavailable in this browser.'; return;}
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const update = () => {$('offline-status').textContent = navigator.onLine ? 'Ready for offline use · saved on this device' : 'Offline · entries still save on this device';};
    update(); window.addEventListener('online',update); window.addEventListener('offline',update);
  } catch (error) {$('offline-status').textContent = 'Offline caching unavailable. Serve over HTTPS or localhost.';}
}

async function initialiseApp() { $('rules').innerHTML = RULES; await loadStore(); connectEvents(); render(); renderHouseholdBinding(); setupOffline(); window.dispatchEvent(new Event('bella-diary-ready')); }
if (typeof document !== 'undefined') initialiseApp();
