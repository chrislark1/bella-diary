'use strict';

// Focused rendering checks for the timeline's date-side daily counters.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const timeline={innerHTML:'',setAttribute(){},insertAdjacentHTML(){}};
const app=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),app);
app.document={getElementById:id=>id==='timeline'?timeline:null,querySelectorAll:()=>[]};
const event=(id,type,datetime,location='outside')=>({id,type,datetime,location,deletedAt:null,note:''});
const events=[
  event('wee-accident','wee','2026-10-20T08:00','inside'),
  event('poo-accident','poo','2026-10-20T09:00','inside'),
  event('wee-outside','wee','2026-10-20T10:00'),
  event('meal','meal','2026-10-20T11:00'),
  event('next-day-outside','poo','2026-10-19T12:00')
];
app.events=events;app.visible=events.filter(item=>item.type==='wee');
vm.runInContext('renderTimeline(visible,events,new Date("2026-10-20T12:00"))',app);
const rows=[...timeline.innerHTML.matchAll(/<div class="time-row[^"]*">([\s\S]*?)<\/div><div class="plot">/g)].map(match=>match[1]);
assert.match(rows[0],/class="day-summary" role="img" aria-label="2 wees, 1 poo, 1 meal, 2 accidents"/);
assert.match(rows[0],/<i class="accident-example" aria-hidden="true">!<\/i><span aria-hidden="true">2<\/span>/);
assert.match(rows[1],/class="day-summary" role="img" aria-label="0 wees, 1 poo, 0 meals, 0 accidents"/);
assert.equal(rows.length,2);
console.log('3 focused daily accident-count checks passed.');
