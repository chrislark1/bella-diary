'use strict';
let trendView='frequency';
// Completed calendar days only: missing logged days count as zero for frequency.
// Medians keep the diary's minimum of three qualifying observations.
function toiletingTrends(events,now=new Date()) {
  const real=events.filter(e=>isActiveEvent(e)&&e.demo!==true&&isToiletingEvent(e)&&Date.parse(e.datetime)<=now.getTime()).sort((a,b)=>a.datetime.localeCompare(b.datetime));
  const result=[];if(!real.length)return result;
  const obs=timingObservations(real),first=dateOf(real[0]),today=localDate(now);
  const daily=new Map();for(const e of real){const date=dateOf(e);if(!daily.has(date))daily.set(date,{wee:[],poo:[]});if(e.type==='wee'||e.type==='poo')daily.get(date)[e.type].push(e);}
  const start=new Date(first+'T12:00');start.setDate(start.getDate()+6);
  for(let day=start;localDate(day)<today;day.setDate(day.getDate()+1)){
    const date=localDate(day),begin=new Date(day);begin.setDate(begin.getDate()-6);const from=localDate(begin);
    const days=[];for(let d=new Date(begin);localDate(d)<=date;d.setDate(d.getDate()+1))days.push(daily.get(localDate(d))||{wee:[],poo:[]});
    const inWindow=o=>dateOf(o.endEvent)>=from&&dateOf(o.endEvent)<=date;
    result.push({date,frequency:['wee','poo'].map(type=>days.reduce((n,d)=>n+d[type].length,0)/7),gaps:['wee','poo'].map(type=>median(obs[type].filter(inWindow).map(o=>o.minutes))),morning:[median(days.filter(d=>d.wee.length).map(d=>minutesOf(d.wee[0])))],overnight:[median(obs.wee.filter(o=>inWindow(o)&&isOvernightObservation(o)).map(o=>o.minutes))]});
  }return result;
}
function renderTrends(events=activeEvents(),now=new Date()) {
  const ordered=trendView==='ordered',panel=$('timing-chart-panel');
  $(ordered?'ordered-slot':'detailed-slot').appendChild(panel);
  timingView=ordered?'ordered':'over-time';
  document.querySelector('.chart-views').hidden=true;
  $('detailed-timing').hidden=ordered;
  $('trend-plot').hidden=ordered;
  $('trend-panel').setAttribute('aria-labelledby','trend-'+trendView);
  document.querySelectorAll('[data-trend]').forEach(b=>{const selected=b.dataset.trend===trendView;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
  renderTimingChart(events,now);
  const descriptions={frequency:'7-day mean wees and poos per day · completed calendar days, including days with no entries.',gaps:'7-day median completed wee and poo gaps · existing interval rules; at least 3 observations.',morning:'7-day median first wee time of day · at least 3 recorded mornings.',overnight:'7-day median overnight wee duration · previous evening at or after 22:00 to next morning at or before 06:00; at least 3 observations.',ordered:'Ordered timing observations · overall medians and percentile distribution.'};
  $('trend-description').textContent=descriptions[trendView];if(ordered)return;
  const points=toiletingTrends(events,now),values=points.flatMap(p=>p[trendView]).filter(v=>v!==null);
  if(!values.length){$('trend-plot').innerHTML='<p class="empty">Not enough completed history for this 7-day trend yet.</p>';return;}
  const W=640,H=280,L=65,R=20,T=20,B=45,max=trendView==='morning'?Math.min(1440,Math.ceil(Math.max(...values)/30)*30+30):Math.max(...values,1)*1.1,min=trendView==='morning'?Math.max(0,Math.floor(Math.min(...values)/30)*30-30):0;
  const x=i=>L+(points.length===1?.5:i/(points.length-1))*(W-L-R),y=v=>T+(1-(v-min)/(max-min))*(H-T-B);
  const format=v=>trendView==='morning'?clockTime(v):trendView==='frequency'?v.toFixed(1):compactDuration(v);
  let svg='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis-label">${format(v)}</text>`;}
  for(let series=0;series<points[0][trendView].length;series++){let path='',connected=false;points.forEach((p,i)=>{const v=p[trendView][series];if(v===null){connected=false;return;}path+=`${connected?'L':'M'}${x(i)} ${y(v)} `;connected=true;svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="2.5" fill="${series?'#866044':'#c89925'}"><title>${p.date}: ${series?'Poo':'Wee'} ${format(v)}</title></circle>`;});svg+=`<path d="${path}" fill="none" stroke="${series?'#866044':'#c89925'}" stroke-width="2.5"/>`;}
  for(const i of new Set([0,Math.floor((points.length-1)/2),points.length-1]))svg+=`<text x="${x(i)}" y="${H-20}" text-anchor="${points.length===1?'middle':i===0?'start':i===points.length-1?'end':'middle'}" class="chart-axis-label">${points[i].date}</text>`;
  $('trend-plot').innerHTML=`<p class="muted">● Gold: Wee${points[0][trendView].length===2?' · Brown: Poo':''} · ${trendView==='frequency'?'events / day':trendView==='morning'?'clock time':'duration'}</p><svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${descriptions[trendView]}">${svg}</svg>`;
}
function connectTrends(){const buttons=[...document.querySelectorAll('[data-trend]')];const select=i=>{trendView=buttons[i].dataset.trend;renderTrends();};buttons.forEach((b,i)=>{b.addEventListener('click',()=>select(i));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:4))%5;select(next);buttons[next].focus();});});$('detailed-timing').addEventListener('toggle',()=>{if($('detailed-timing').open)renderTimingChart(activeEvents());});}
