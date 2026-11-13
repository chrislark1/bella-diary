'use strict';
let trendView='frequency';
const TREND_SERIES=[{name:'Wee',color:'#c89925',dash:''},{name:'Poo',color:'#866044',dash:'5 3'}];
function trendMarker(series,x,y,size=2.5) {
  const style=TREND_SERIES[series];
  return series===0?`<circle cx="${x}" cy="${y}" r="${size}" fill="${style.color}"/>`:`<path d="M${x} ${y-size} L${x+size} ${y} L${x} ${y+size} L${x-size} ${y} Z" fill="${style.color}"/>`;
}
function trendSwatch(series) {const style=TREND_SERIES[series];return `<svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"><path d="M1 7 H27" stroke="${style.color}" stroke-width="2.5" stroke-dasharray="${style.dash}"/>${trendMarker(series,14,7,3)}</svg>`;}

// Completed calendar days only: missing logged days count as zero for frequency.
// Medians keep the diary's minimum of three qualifying observations.
function toiletBoundaryObservation(events,date) {
  const boundary=new Date(date+'T02:00');
  const toilets=events.filter(e=>e.type==='wee'||e.type==='poo');
  const before=toilets.filter(e=>new Date(e.datetime)<boundary).at(-1)||null;
  const after=toilets.find(e=>new Date(e.datetime)>=boundary)||null;
  return {before,after,morning:after?minutesOf(after):null,overnight:before&&after?(Date.parse(after.datetime)-Date.parse(before.datetime))/60000:null};
}
function toiletingTrends(events,now=new Date()) {
  const real=events.filter(e=>isActiveEvent(e)&&e.demo!==true&&isToiletingEvent(e)&&Date.parse(e.datetime)<=now.getTime()).sort((a,b)=>a.datetime.localeCompare(b.datetime));
  const result=[];if(!real.length)return result;
  const obs=timingObservations(real),first=dateOf(real[0]),today=localDate(now);
  const daily=new Map();for(const e of real){const date=dateOf(e);if(!daily.has(date))daily.set(date,[]);daily.get(date).push(e);}
  const start=new Date(first+'T12:00');start.setDate(start.getDate()+6);
  for(let day=start;localDate(day)<today;day.setDate(day.getDate()+1)){
    const date=localDate(day),begin=new Date(day);begin.setDate(begin.getDate()-6);const from=localDate(begin);
    const days=[];for(let d=new Date(begin);localDate(d)<=date;d.setDate(d.getDate()+1))days.push(daily.get(localDate(d))||[]);
    const inWindow=o=>dateOf(o.endEvent)>=from&&dateOf(o.endEvent)<=date;
    const observation=toiletBoundaryObservation(real,date),morning=observation.morning,duration=observation.overnight;
    const morningValues=[],overnightValues=[];
    for(const candidate of result.slice(-6).concat([{morning:[morning],overnight:[duration]}])){if(candidate.morning[0]!==null)morningValues.push(candidate.morning[0]);if(candidate.overnight[0]!==null)overnightValues.push(candidate.overnight[0]);}
    result.push({date,frequency:['wee','poo'].map(type=>days.reduce((n,d)=>n+d.filter(e=>e.type===type).length,0)/7),gaps:['wee','poo'].map(type=>median(obs[type].filter(inWindow).map(o=>o.minutes))),morning:[median(morningValues)],overnight:[median(overnightValues)]});
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
  const descriptions={frequency:'7-day mean wees and poos per day · completed calendar days, including days with no entries.',gaps:'7-day median completed wee and poo gaps · existing interval rules; at least 3 observations.',morning:'7-day median time of the first Wee or Poo after the local 02:00 boundary.',overnight:'7-day median duration from the last Wee or Poo before local 02:00 to the first one at or after it.',ordered:'Ordered timing observations · overall medians and percentile distribution.'};
  $('trend-description').textContent=descriptions[trendView];if(ordered)return;
  const points=toiletingTrends(events,now),values=points.flatMap(p=>p[trendView]).filter(v=>v!==null);
  if(!values.length){$('trend-plot').innerHTML='<p class="empty">Not enough completed history for this 7-day trend yet.</p>';return;}
  const W=Math.max(280,$('trend-plot').clientWidth||640),H=280,L=W<400?48:65,T=20,B=45,max=trendView==='morning'?Math.min(1440,Math.ceil(Math.max(...values)/30)*30+30):Math.max(...values,1)*1.1,min=trendView==='morning'?Math.max(0,Math.floor(Math.min(...values)/30)*30-30):0;
  const format=v=>trendView==='morning'?clockTime(v):trendView==='frequency'?v.toFixed(1):compactDuration(v);
  const labelText=value=>format(value)+(trendView==='frequency'?' / day':'');
  const lastValues=points[0][trendView].map((_,series)=>points.slice().reverse().find(p=>p[trendView][series]!==null)?.[trendView][series]).filter(v=>v!==undefined);
  const labelWidth=Math.max(...lastValues.map(v=>labelText(v).length*7.5+14));
  // Reserve a separate gutter before computing paths, grids and date-axis positions.
  const R=labelWidth+24,plotRight=W-R,labelX=plotRight+16;
  const x=i=>L+(points.length===1?.5:i/(points.length-1))*(plotRight-L),y=v=>T+(1-(v-min)/(max-min))*(H-T-B);
  let svg='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis-label">${format(v)}</text>`;}
  const endpoints=[];
  for(let series=0;series<points[0][trendView].length;series++) {
    const style=TREND_SERIES[series];let path='',connected=false,last=null;
    points.forEach((p,i)=>{const v=p[trendView][series];if(v===null){connected=false;return;}path+=`${connected?'L':'M'}${x(i)} ${y(v)} `;connected=true;last={x:x(i),y:y(v),value:v,date:p.date,series};svg+=`<g><title>${p.date}: ${style.name} ${format(v)}</title>${trendMarker(series,x(i),y(v))}</g>`;});
    svg+=`<path d="${path}" fill="none" stroke="${style.color}" stroke-width="2.5" stroke-dasharray="${style.dash}"/>`;
    if(last)endpoints.push(last);
  }
  const positions=resolveMedianLabelPositions(endpoints.map(p=>({metric:p.series,y:p.y})),T+12,H-B-12,28);
  for(const point of endpoints){
    const style=TREND_SERIES[point.series],label=labelText(point.value),width=label.length*7.5+14,height=24;
    const centerY=positions.get(point.series).labelY,box={x:labelX,y:centerY-height/2,width,height,centerY};
    svg+=`<g class="trend-endpoint" data-series="${style.name}" data-value="${point.value}" role="img" aria-label="${style.name}, latest plotted value ${label}, ${point.date}"><path d="M${point.x+4} ${point.y} H${plotRight+7} L${box.x} ${box.centerY}" fill="none" stroke="${style.color}" stroke-width="1"/><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${height}" rx="4" fill="#fffef9" stroke="${style.color}"/><text x="${box.x+7}" y="${box.centerY+4}" fill="#293c30" font-size="12">${label}</text></g>`;
  }
  for(const i of new Set(W<450?[0,points.length-1]:[0,Math.floor((points.length-1)/2),points.length-1]))svg+=`<text x="${x(i)}" y="${H-20}" text-anchor="${points.length===1?'middle':i===0?'start':i===points.length-1?'end':'middle'}" class="chart-axis-label">${W<450?new Date(points[i].date+'T12:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):points[i].date}</text>`;
  $('trend-plot').innerHTML=`<div class="trend-legend">${TREND_SERIES.slice(0,points[0][trendView].length).map((style,i)=>`<span>${trendSwatch(i)}${style.name}</span>`).join('')}<span class="muted">${trendView==='frequency'?'events / day':trendView==='morning'?'clock time':'duration'}</span></div><svg class="trend-svg" data-plot-right="${plotRight}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${descriptions[trendView]}">${svg}</svg>`;

}
function connectTrends(){const buttons=[...document.querySelectorAll('[data-trend]')];const select=i=>{trendView=buttons[i].dataset.trend;renderTrends();};buttons.forEach((b,i)=>{b.addEventListener('click',()=>select(i));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:4))%5;select(next);buttons[next].focus();});});$('detailed-timing').addEventListener('toggle',()=>{if($('detailed-timing').open)renderTimingChart(activeEvents());});}
