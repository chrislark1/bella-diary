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
// Daily marks and hourly buckets share the same 00–24 plotting geometry.
const position = event => minutesOf(event) / 1440 * 100;
const accident = event => event.type !== 'meal' && event.location === 'inside';
const titleCase = text => text[0].toUpperCase() + text.slice(1);
const escapeHTML = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const shortDate = date => new Date(`${date}T12:00`).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
const previousDate = date => {const d = new Date(`${date}T12:00`); d.setDate(d.getDate() - 1); return localDate(d);};
const uniqueId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const median = values => {if (values.length < MIN_SAMPLES) return null; const a = [...values].sort((a,b) => a-b); const mid = Math.floor(a.length/2); return a.length%2 ? a[mid] : (a[mid-1]+a[mid])/2;};
const duration = value => value == null ? '—' : value < 60 ? `${Math.round(value)} min` : `${Math.floor(Math.round(value)/60)} h ${Math.round(value)%60} min`;
const clockTime = value => value == null ? '—' : `${pad(Math.floor(Math.round(value)/60)%24)}:${pad(Math.round(value)%60)}`;

function demoWeek(now = new Date()) {
  const events = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const day = new Date(now); day.setDate(day.getDate() - daysAgo);
    const shift = [0, 8, -7, 12, -4, 5, -9][6-daysAgo];
    const schedule = [
      ['wee', 370], ['meal', 420], ['wee', 445], ['poo', 465], ['wee', 570],
      ['wee', 680], ['meal', 750], ['wee', 780], ['poo', 820], ['wee', 920],
      ['meal', 1080], ['wee', 1110], ['wee', 1225], ['wee', 1320]
    ];
    schedule.forEach(([type, minute], index) => {
      const adjusted = minute + shift + (index%3)*3;
      const event = {id:uniqueId(), type, datetime:`${localDate(day)}T${pad(Math.floor(adjusted/60))}:${pad(adjusted%60)}`, note:'', demo:true};
      if (type === 'meal') {event.mealFood = 'Puppy kibble'; event.mealAmount = '80 g';}
      else {event.location = (daysAgo === 5 && index === 4) || (daysAgo === 3 && index === 7) ? 'inside' : 'outside'; if (type === 'poo') event.pooConsistency = daysAgo === 3 ? 'Soft' : 'Normal';}
      if (accident(event)) event.note = 'A little too late getting outside';
      events.push(event);
    });
  }
  return events;
}

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
    if (raw.demo === true) event.demo = true;
    return event;
  });
}

let store = {version:1, demoCleared:false, events:[]};
let activeFilter = 'all', activeTab = 'timeline', activePage = 'diary', activeWindow = '14', editingId = null, messageTimer;
let storageBlocked = false;
let mutationQueue = Promise.resolve();

function notify(text) {
  $('message').textContent = text; $('message').hidden = false;
  clearTimeout(messageTimer); messageTimer = setTimeout(() => {$('message').hidden = true;}, 5500);
}

function validateStore(saved) {
  if (!saved || saved.version !== 1 || typeof saved.demoCleared !== 'boolean') throw new Error('Unrecognised saved diary.');
  return {...saved, events:validateEvents(saved.events)};
}

async function loadStore() {
  try {
    const saved = await diaryRepository.load(validateStore);
    if (saved !== null) {
      store = validateStore(saved);
    } else {
      const initialStore = {version:1, demoCleared:false, events:demoWeek()};
      await diaryRepository.save(initialStore, {initializeOnly:true});
      store = validateStore(await diaryRepository.load(validateStore));
    }
  } catch (error) {
    // Never overwrite unreadable saved data or claim it has been saved.
    storageBlocked = true;
    notify('Saved diary could not be opened. Storage may be unavailable; existing data has not been overwritten.');
  }
}

function commit(updateEvents, demoCleared) {
  // Compute each mutation after the previous save finishes, preserving rapid taps.
  const pending = mutationQueue.then(async () => {
    if (storageBlocked) {notify('Storage is unavailable. Restore browser storage access before making changes.'); return false;}
    const events = typeof updateEvents === 'function' ? updateEvents(store.events) : updateEvents;
    const next = {version:1, demoCleared:demoCleared ?? store.demoCleared, events};
    try {await diaryRepository.save(next);}
    catch (error) {notify('Could not save. Browser storage may be full or unavailable. Export a backup.'); return false;}
    store = next; render(); return true;
  });
  mutationQueue = pending.catch(() => {});
  return pending;
}

function refreshStore() {
  // Cross-window reads share the queue so they cannot replace a pending local save.
  mutationQueue = mutationQueue.then(async () => {await loadStore(); render();});
}

function filteredEvents() {
  return store.events.filter(event => activeFilter === 'all' || (activeFilter === 'accidents' ? accident(event) : event.type === activeFilter)).sort((a,b) => b.datetime.localeCompare(a.datetime));
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

function axisHTML() {
  return '<div class="axis-row"><span></span><div class="axis">' + [0,4,8,12,16,20,24].map(hour => `<span style="left:${hour/24*100}%">${pad(hour)}</span>`).join('') + '</div></div>';
}

function markHTML(event) {
  const label = `${shortDate(dateOf(event))}, ${event.datetime.slice(11,16)}, ${titleCase(event.type)}, ${details(event)}${event.note ? ', '+event.note : ''}`;
  const inner = `<span class="symbol ${event.type}"></span>${accident(event) ? '<span class="badge" aria-hidden="true">!</span>' : ''}`;
  return `<button class="event-mark" data-id="${escapeHTML(event.id)}" style="left:${position(event)}%" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${inner}</button>`;
}

function renderHeader() {
  const today = store.events.filter(event => dateOf(event) === localDate(new Date()));
  const metrics = [[new Set(store.events.map(dateOf)).size,'Days tracked'], ...TYPES.map(type => [today.filter(event => event.type === type).length, `Today's ${type === 'wee' ? 'wees' : type === 'poo' ? 'poos' : 'meals'}`]), [streak(store.events),'Days accident-free']];
  $('summary').innerHTML = metrics.map(([value,label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  const hasDemo = store.events.some(event => event.demo);
  $('demo-label').hidden = !hasDemo; $('clear-demo').hidden = !hasDemo;
}

function hourlyDistribution(events, type, trackedDays) {
  const buckets = Array.from({length:24}, () => ({count:0, dates:new Set()}));
  const matching = events.filter(event => event.type === type);
  matching.forEach(event => {const bucket = buckets[Math.floor(minutesOf(event)/60)]; bucket.count++; bucket.dates.add(dateOf(event));});
  const peak = Math.max(0,...buckets.map(bucket => bucket.count));
  return buckets.map(bucket => ({count:bucket.count, days:bucket.dates.size, percent:matching.length ? Math.round(bucket.count/matching.length*100) : 0, strength:peak ? bucket.count/peak : 0, total:matching.length, diaryDays:trackedDays}));
}

function renderAggregate(events) {
  const today = localDate(new Date());
  const cutoff = activeWindow === 'all' ? null : (() => {const day = new Date(`${today}T12:00`); day.setDate(day.getDate() - Number(activeWindow) + 1); return localDate(day);})();
  const windowEvents = activeWindow === 'all' ? events : events.filter(event => dateOf(event) >= cutoff && dateOf(event) <= today);
  const trackedDays = new Set(windowEvents.map(dateOf)).size;
  const labels = {wee:'Wees',poo:'Poos',meal:'Meals'};
  const windowName = activeWindow === 'all' ? 'all time' : `the last ${activeWindow} days`;
  $('aggregate-count').textContent = `${trackedDays} ${trackedDays === 1 ? 'diary day' : 'diary days'} · ${windowEvents.length} events`;
  $('aggregate').innerHTML = axisHTML() + TYPES.map(type => `<div class="time-row aggregate-row"><div class="date-label">${labels[type]}</div><div class="plot bucket-strip ${type}-buckets">${hourlyDistribution(windowEvents,type,trackedDays).map(({count,days,percent,strength,total,diaryDays},hour) => {
    const label = `${labels[type]}, ${pad(hour)}:00–${pad(hour+1)}:00, ${windowName}: ${total ? `${percent}% of recorded ${labels[type].toLowerCase()} (${count} of ${total}); seen on ${days} of ${diaryDays} diary days. Shading: ${Math.round(strength*100)}% of this row's busiest hour` : `no recorded ${labels[type].toLowerCase()} ${windowName}`}`;
    return `<button class="hour-bucket" style="--strength:${strength}" data-bucket-label="${escapeHTML(label)}" aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}"></button>`;
  }).join('')}</div></div>`).join('');
}

function renderTimeline(events) {
  const dates = [...new Set(store.events.map(dateOf))].sort().reverse();
  const groups = new Map(dates.map(date => [date,[]]));
  events.forEach(event => groups.get(dateOf(event)).push(event));
  $('timeline').innerHTML = axisHTML() + (dates.length ? dates.map(date => {
    const dayEvents = groups.get(date);
    return `<div class="time-row ${date === localDate(new Date()) ? 'today' : ''}"><div class="date-label">${shortDate(date)}</div><div class="plot">${dayEvents.slice().reverse().map(event => markHTML(event)).join('')}</div></div>`;
  }).join('') : '<p class="empty">A fresh start for Bella. Tap + Wee, + Poo or + Meal to begin.</p>');
  if (dates.length && !events.length) $('timeline').insertAdjacentHTML('beforeend','<p class="empty">No events match this filter.</p>');
}

function renderTable(events) {
  $('data').innerHTML = events.length ? `<table><thead><tr><th>Date / time</th><th>Type</th><th>Details</th><th class="note-column">Note</th><th><span class="muted">Edit</span></th></tr></thead><tbody>${events.map(event => `<tr data-id="${escapeHTML(event.id)}"><td>${shortDate(dateOf(event))}<br>${event.datetime.slice(11,16)}</td><td><span class="symbol ${event.type}" aria-hidden="true"></span>${titleCase(event.type)}</td><td>${escapeHTML(details(event))}${accident(event) ? ' <span class="accident-example" aria-label="Inside accident">!</span>' : ''}<span class="table-note-inline">${escapeHTML(event.note)}</span></td><td class="note-column">${escapeHTML(event.note)}</td><td><button data-id="${escapeHTML(event.id)}" aria-label="Edit ${event.type} on ${escapeHTML(shortDate(dateOf(event)))} at ${event.datetime.slice(11,16)}">Edit</button></td></tr>`).join('')}</tbody></table>` : '<p class="empty">No events to show. Try another filter or add an entry.</p>';
}

function statistics(events) {
  const sorted = [...events].sort((a,b) => a.datetime.localeCompare(b.datetime));
  const dates = [...new Set(events.map(dateOf))];
  const wees = sorted.filter(event => event.type === 'wee');
  const intervals = [], daytime = [], overnight = [];
  for (let i = 1; i < wees.length; i++) {
    const a = wees[i-1], b = wees[i];
    const elapsed = (new Date(b.datetime)-new Date(a.datetime))/60000;
    if (elapsed <= 0 || elapsed > 24*60) continue; // Missing days are not useful intervals.
    intervals.push(elapsed);
    if (dateOf(a) === dateOf(b) && minutesOf(a) >= DAY_START && minutesOf(b) <= DAY_END) daytime.push(elapsed);
    if (previousDate(dateOf(b)) === dateOf(a) && minutesOf(a) >= DAY_END && minutesOf(b) <= DAY_START) overnight.push(elapsed);
  }
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
  return {frequency, interval:median(intervals), daytime:daytime.length >= MIN_SAMPLES ? Math.max(...daytime) : null, overnight:overnight.length >= MIN_SAMPLES ? Math.max(...overnight) : null, firstWee:median(firsts('wee')), firstPoo:median(firsts('poo')), mealTimes:mealTimes.map(median), mealWee:median(afterMeal('wee',6)), mealPoo:median(afterMeal('poo',12))};
}

function renderStats() {
  const s = statistics(store.events);
  const groups = [
    ['Frequency', [['Wees / day',s.frequency('wee')],['Poos / day',s.frequency('poo')],['Meals / day',s.frequency('meal')],['Accidents / day',s.frequency('accidents')],['Accident-free streak',`${streak(store.events)} days`]]],
    ['Timing', [['Median wee interval',duration(s.interval)],['Longest daytime gap',duration(s.daytime)],['Longest overnight gap',duration(s.overnight)],['Typical first wee',clockTime(s.firstWee)],['Typical first poo',clockTime(s.firstPoo)],['Typical meals',s.mealTimes.every(v => v !== null) ? s.mealTimes.map(clockTime).join(' · ') : '—']]],
    ['After a meal', [['Median time to wee',duration(s.mealWee)],['Median time to poo',duration(s.mealPoo)]]]
  ];
  $('stats').innerHTML = groups.map(([heading,rows]) => `<div><h3>${heading}</h3>${rows.map(([label,value]) => `<div class="stat-line"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`).join('');
}

function render() {
  const events = filteredEvents();
  renderHeader(); renderAggregate(store.events); renderTimeline(events); renderTable(events); renderStats();
  $('timeline').hidden = activeTab !== 'timeline'; $('data').hidden = activeTab !== 'data';
  $('diary-page').hidden = activePage !== 'diary'; $('stats-page').hidden = activePage !== 'stats';
  document.querySelectorAll('[data-page]').forEach(button => {const selected = button.dataset.page === activePage; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;});
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.filter === activeFilter)));
  document.querySelectorAll('[data-tab]').forEach(button => {const selected = button.dataset.tab === activeTab; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1;});
}

async function quickAdd(type, location = 'outside') {
  const event = {id:uniqueId(),type,datetime:localDatetime(new Date()),note:''};
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
  const event = id ? store.events.find(event => event.id === id) : null;
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
  const entry = {id:editingId || uniqueId(),type:value('type'),datetime:`${value('date')}T${value('time')}`,note:value('note')};
  if (entry.type === 'meal') {entry.mealFood = value('mealFood'); entry.mealAmount = value('mealAmount');}
  else {entry.location = value('location'); if (entry.type === 'poo') entry.pooConsistency = value('pooConsistency');}
  // Editing a demo event keeps its provenance until explicitly cleared.
  if (editingId && store.events.find(event => event.id === editingId)?.demo) entry.demo = true;
  try {validateEvents([entry]);} catch (error) {notify(error.message); return;}
  const id = editingId;
  if (await commit(events => id ? events.map(event => event.id === id ? entry : event) : [...events,entry])) {$('editor').close(); notify('Entry saved');}
}

function download(filename,content,type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),10000);
}

function exportJSON() {download(`bellas-diary-${localDate(new Date())}.json`,JSON.stringify({version:1,exportedAt:new Date().toISOString(),events:store.events},null,2),'application/json');}

function exportCSV() {
  const keys = ['id','datetime','date','time','type','location','pooConsistency','mealFood','mealAmount','note'];
  // Guard against spreadsheet formula execution while retaining a readable text value.
  const cell = value => {let s = String(value ?? ''); if (/^[\s]*[=+@-]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"';};
  const lines = [keys.join(','), ...[...store.events].sort((a,b) => b.datetime.localeCompare(a.datetime)).map(event => keys.map(key => cell(key === 'date' ? dateOf(event) : key === 'time' ? event.datetime.slice(11,16) : event[key])).join(','))];
  download(`bellas-diary-${localDate(new Date())}.csv`,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
}

async function importJSON(file) {
  if (!file) return;
  try {
    if (file.size > 10*1024*1024) throw new Error('Please choose a JSON backup smaller than 10 MB.');
    const data = JSON.parse(await file.text());
    if (!data || data.version !== 1) throw new Error('Please choose a version 1 Bella’s Diary JSON backup.');
    const events = validateEvents(data.events);
    if (!confirm(`Import ${events.length} events? This REPLACES all ${store.events.length} current entries. Export a backup first if you want to keep them.`)) return;
    if (await commit(events,true)) notify(`Imported ${events.length} events`);
  } catch (error) {notify(`Import failed: ${error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message}`);}
  finally {$('import-file').value = '';}
}

function connectEvents() {
  try {const savedWindow = localStorage.getItem(WINDOW_KEY); if (['7','14','30','all'].includes(savedWindow)) activeWindow = savedWindow;} catch {}
  $('aggregate-window').value = activeWindow;
  $('aggregate-window').addEventListener('change',event => {
    activeWindow = event.target.value;
    try {localStorage.setItem(WINDOW_KEY,activeWindow);} catch {notify('Could not save the pattern window on this device.');}
    renderAggregate(store.events);
  });
  $('more-menu').addEventListener('click',event => {if (event.target.closest('button')) setTimeout(() => {$('more-menu').open = false;},0);});
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
  $('delete-event').addEventListener('click',async () => {const id = editingId; if (id && confirm('Delete this entry?') && await commit(events => events.filter(event => event.id !== id))) {$('editor').close(); notify('Entry deleted');}});
  $('clear-demo').addEventListener('click',async () => {if (confirm('Clear illustrative demo entries? Entries you added yourself will stay. Edited demo entries will also be removed.')) {if (await commit(events => events.filter(event => !event.demo),true)) notify('Demo cleared. Ready for Bella’s own diary.');}});
  $('export-json').addEventListener('click',exportJSON); $('export-csv').addEventListener('click',exportCSV);
  $('import-json').addEventListener('click',() => $('import-file').click());
  $('import-file').addEventListener('change',event => importJSON(event.target.files[0]));
  diaryRepository.subscribe(refreshStore);
  window.addEventListener('focus',refreshStore);
  document.addEventListener('visibilitychange',() => {if (!document.hidden) refreshStore();});
  // Refresh today's counts when the local calendar date changes while open.
  let lastDate = localDate(new Date());
  setInterval(() => {const date = localDate(new Date()); if (date !== lastDate) {lastDate = date; render();}},60000);
}

const RULES = '<p>Statistics use the entire diary, independently of the view filter. Frequencies divide totals by the number of dates with entries and need at least three tracked dates. A dash means there is not enough data.</p><p>The accident-free streak starts on the latest recorded date and counts backwards through consecutive calendar dates with entries and no inside wee or poo. A missing date or an accident stops it. It is a streak of recorded days, not a claim about unrecorded days.</p><p>Intervals use actual elapsed minutes between consecutive wees; zero-length gaps and gaps over 24 hours are excluded. Daytime gaps have both endpoints on the same day between 06:00 and 22:00. Overnight gaps run from 22:00 or later to 06:00 or earlier on the next date. Other gaps count only towards the overall median. Interval medians and longest gaps need three qualifying examples.</p><p>First-event times use a median of at least three days. Typical meals are the medians of the first, second and third meals on days with exactly three meals; each needs three days. Meal-to-toilet medians use the next wee within 6 hours or the next poo within 12 hours, with at least three qualifying meals. These are diary heuristics.</p><p>Demo entries are illustrative, including a full example day for today. Clear demo data before starting your own records; any entries you added yourself will stay.</p>';

async function setupOffline() {
  if (!('serviceWorker' in navigator)) {$('offline-status').textContent = 'Offline caching is unavailable in this browser.'; return;}
  try {
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const update = () => {$('offline-status').textContent = navigator.onLine ? 'Ready for offline use · saved on this device' : 'Offline · entries still save on this device';};
    update(); window.addEventListener('online',update); window.addEventListener('offline',update);
  } catch (error) {$('offline-status').textContent = 'Offline caching unavailable. Serve over HTTPS or localhost.';}
}

async function initialiseApp() { $('rules').innerHTML = RULES; await loadStore(); connectEvents(); render(); setupOffline(); }
if (typeof document !== 'undefined') initialiseApp();
