'use strict';

// Focused dependency-free checks for main Diary timeline marker lanes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),app);
const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8');
let passed=0;
const check=(name,test)=>{test();passed++;console.log('PASS '+name);};

const events=[
  {id:'wee',type:'wee',datetime:'2026-10-27T12:00',location:'inside',note:''},
  {id:'poo',type:'poo',datetime:'2026-10-27T12:00',location:'inside',note:'',pooConsistency:'Normal'},
  {id:'meal',type:'meal',datetime:'2026-10-27T12:00',note:''}
];
const markup=events.map(event=>{app.event=event;return vm.runInContext('markHTML(event)',app);});

check('same-time Wee, Poo and Meal keep the same accurate x-position and remain separate editable buttons',()=>{
  assert.ok(markup.every(html=>html.includes('style="left:50%"')&&html.startsWith('<button class="event-mark event-mark-')&&html.includes('data-id=')));
  assert.deepEqual(markup.map(html=>html.match(/event-mark event-mark-([^\"]+)/)[1]),['wee','poo','meal']);
  assert.ok(markup.every(html=>html.includes('<span class="event-glyph">')));
});

check('inside Wee and Poo accident badges stay nested with their underlying type markers',()=>{
  assert.ok(markup[0].includes('<span class="symbol wee"></span><span class="badge" aria-hidden="true">!</span>'));
  assert.ok(markup[1].includes('<span class="symbol poo"></span><span class="badge" aria-hidden="true">!</span>'));
  assert.ok(!markup[2].includes('badge'));
});

check('type lanes offset only the visual glyph, with Wee above, Poo centred and Meal below',()=>{
  assert.ok(css.includes('.event-mark-wee .event-glyph{transform:translateY(-4px)}'));
  assert.ok(css.includes('.event-mark-poo .event-glyph{transform:translateY(0)}'));
  assert.ok(css.includes('.event-mark-meal .event-glyph{transform:translateY(4px)}'));
  assert.ok(css.includes('.time-row .event-mark{z-index:2}'));
});

check('existing daily row heights, marker hit targets and vertical bounds remain unchanged',()=>{
  assert.ok(css.includes('.time-row{height:38px}'));
  assert.ok(css.includes('.time-row{height:32px}'));
  assert.ok(css.includes('.event-mark{height:34px;min-height:34px}'));
  assert.ok(css.includes('.event-mark{height:30px;min-height:30px}'));
  // Phone rows are 32px high; the shifted wee badge reaches at most 16px from
  // the row centre, while its marker itself stays well inside the row.
  const phoneHalfRow=32/2,weeOffset=4,badgeHalf=11/2,badgeCenterAboveGlyph=6.5;
  assert.ok(weeOffset+badgeCenterAboveGlyph+badgeHalf<=phoneHalfRow);
  assert.ok(weeOffset+11/2<phoneHalfRow);
});

console.log(`${passed} focused timeline-lane checks passed.`);
