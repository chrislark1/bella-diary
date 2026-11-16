'use strict';
let trendView='frequency';
const TREND_SERIES=[{name:'Wee',color:'#c89925',dash:'',symbol:'circle'},{name:'Poo',color:'#866044',dash:'5 3',symbol:'diamond'},{name:'Overnight',color:'#428477',dash:'2 3',symbol:'square'}];
function trendMarker(series,x,y,size=2.5) {
  const style=TREND_SERIES[series];
  return style.symbol==='circle'?`<circle cx="${x}" cy="${y}" r="${size}" fill="${style.color}"/>`:style.symbol==='square'?`<rect x="${x-size}" y="${y-size}" width="${size*2}" height="${size*2}" fill="${style.color}"/>`:`<path d="M${x} ${y-size} L${x+size} ${y} L${x} ${y+size} L${x-size} ${y} Z" fill="${style.color}"/>`;
}
function trendSwatch(series) {const style=TREND_SERIES[series];return `<svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"><path d="M1 7 H27" stroke="${style.color}" stroke-width="2.5" stroke-dasharray="${style.dash}"/>${trendMarker(series,14,7,3)}</svg>`;}

// Completed calendar days only: missing logged days count as zero for frequency.
// Medians keep the diary's minimum of three qualifying observations.
function toiletBoundaryObservation(events,date) {
  const boundary=new Date(date+'T02:00');
  const toilets=events.filter(e=>e.type==='wee'||e.type==='poo');
  const before=toilets.filter(e=>new Date(e.datetime)<boundary).at(-1)||null;
  const after=toilets.find(e=>new Date(e.datetime)>=boundary&&dateOf(e)===date)||null;
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
    const observation=toiletBoundaryObservation(real,date),morning=observation.morning,duration=observation.overnight,boundary=new Date(date+'T02:00');
    const windowStart=new Date(date+'T12:00');windowStart.setDate(windowStart.getDate()-6);
    const boundaryWindowStart=new Date(localDate(windowStart)+'T02:00');
    const boundaryObservations=[];
    for(let boundaryDate=new Date(boundaryWindowStart);boundaryDate<=boundary;boundaryDate.setDate(boundaryDate.getDate()+1))boundaryObservations.push(toiletBoundaryObservation(real,localDate(boundaryDate)));
    const morningValues=boundaryObservations.map(o=>o.morning).filter(v=>v!==null),overnightValues=boundaryObservations.map(o=>o.overnight).filter(v=>v!==null);
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
  const descriptions={frequency:'7-day mean wees and poos per day · completed calendar days, including days with no entries.',gaps:'7-day median Wee, Poo and Overnight gaps · Overnight runs between the nearest toilets around local 02:00.',morning:'7-day median time of the first toilet after the local 02:00 boundary · Wee or Poo.',accidents:'Trailing 7-day accident rate and moving median of the last 5 completed Wee accident gaps.',ordered:'Ordered timing observations · overall medians and percentile distribution.'};
  $('trend-description').textContent=descriptions[trendView];if(ordered)return;
  if(trendView==='accidents'){renderAccidentTrend(events,now);return;}
  const points=toiletingTrends(events,now),seriesKey=trendView==='gaps'?'gaps':trendView,seriesCount=trendView==='gaps'?3:trendView==='morning'?1:2,values=points.flatMap(p=>trendView==='gaps'?[...p.gaps,p.overnight[0]]:p[seriesKey]).filter(v=>v!==null);
  if(!values.length){$('trend-plot').innerHTML='<p class="empty">Not enough completed history for this 7-day trend yet.</p>';return;}
  const W=Math.max(280,$('trend-plot').clientWidth||640),H=280,L=W<400?48:65,T=20,B=45,max=trendView==='morning'?Math.min(1440,Math.ceil(Math.max(...values)/30)*30+30):Math.max(...values,1)*1.1,min=trendView==='morning'?Math.max(0,Math.floor(Math.min(...values)/30)*30-30):0;
  const format=v=>trendView==='morning'?clockTime(v):trendView==='frequency'?v.toFixed(1):compactDuration(v);
  const labelText=value=>format(value)+(trendView==='frequency'?' / day':'');
  const valueAt=(point,series)=>trendView==='gaps'?(series<2?point.gaps[series]:point.overnight[0]):point[seriesKey][series];
  const lastValues=Array.from({length:seriesCount},(_,series)=>points.slice().reverse().map(p=>valueAt(p,series)).find(v=>v!==null));
  if(lastValues.some(v=>v===undefined)){ $('trend-plot').innerHTML='<p class="empty">Not enough completed history for this 7-day trend yet.</p>';return; }
  const labelWidth=Math.max(...lastValues.map(v=>labelText(v).length*7.5+14));
  // Reserve a separate gutter before computing paths, grids and date-axis positions.
  const R=labelWidth+24,plotRight=W-R,labelX=plotRight+16;
  const x=i=>L+(points.length===1?.5:i/(points.length-1))*(plotRight-L),y=v=>T+(1-(v-min)/(max-min))*(H-T-B);
  let svg='';for(let i=0;i<=4;i++){const v=min+(max-min)*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis-label">${format(v)}</text>`;}
  const endpoints=[];
  for(let series=0;series<seriesCount;series++) {
    const style=trendView==='gaps'?TREND_SERIES[series]:{...TREND_SERIES[0],name:'First toilet'};let path='',connected=false,last=null;
    points.forEach((p,i)=>{const v=valueAt(p,series);if(v===null){connected=false;return;}path+=`${connected?'L':'M'}${x(i)} ${y(v)} `;connected=true;last={x:x(i),y:y(v),value:v,date:p.date,series};svg+=`<g><title>${p.date}: ${style.name} ${format(v)}</title>${trendMarker(series,x(i),y(v))}</g>`;});
    svg+=`<path d="${path}" fill="none" stroke="${style.color}" stroke-width="2.5" stroke-dasharray="${style.dash}"/>`;
    if(last)endpoints.push(last);
  }
  const positions=resolveMedianLabelPositions(endpoints.map(p=>({metric:p.series,y:p.y})),T+12,H-B-12,28);
  for(const point of endpoints){
    const style=trendView==='gaps'?TREND_SERIES[point.series]:{...TREND_SERIES[0],name:'First toilet'},label=labelText(point.value),width=label.length*7.5+14,height=24;
    const centerY=positions.get(point.series).labelY,box={x:labelX,y:centerY-height/2,width,height,centerY};
    svg+=`<g class="trend-endpoint" data-series="${style.name}" data-value="${point.value}" role="img" aria-label="${style.name}, latest plotted value ${label}, ${point.date}"><path d="M${point.x+4} ${point.y} H${plotRight+7} L${box.x} ${box.centerY}" fill="none" stroke="${style.color}" stroke-width="1"/><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${height}" rx="4" fill="#fffef9" stroke="${style.color}"/><text x="${box.x+7}" y="${box.centerY+4}" fill="#293c30" font-size="12">${label}</text></g>`;
  }
  for(const i of new Set(W<450?[0,points.length-1]:[0,Math.floor((points.length-1)/2),points.length-1]))svg+=`<text x="${x(i)}" y="${H-20}" text-anchor="${points.length===1?'middle':i===0?'start':i===points.length-1?'end':'middle'}" class="chart-axis-label">${W<450?new Date(points[i].date+'T12:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}):points[i].date}</text>`;
  $('trend-plot').innerHTML=`<div class="trend-legend">${Array.from({length:seriesCount},(_,i)=>`<span>${trendSwatch(i)}${trendView==='morning'?'First toilet':trendView==='frequency'?TREND_SERIES[i].name:TREND_SERIES[i].name+' gap'}</span>`).join('')}<span class="muted">${trendView==='frequency'?'events / day':trendView==='morning'?'local clock time':'duration'}</span></div><svg class="trend-svg" data-plot-right="${plotRight}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${descriptions[trendView]}">${svg}</svg>`;

}
function renderAccidentTrend(events,now) {
  const history=diaryHistoryStart(events,now),start=history===null?null:history+168*3600000;
  const rates=start===null?[]:accidentRateObservations(events,start,now).filter(item=>item.rate!==null);
  const gaps=timingObservations(events)['wee-accident'];
  const rolling=trailingMedianObservations(gaps,null,5).filter(item=>item.median!==null);
  const open=currentWeeAccidentGap(events,now);
  if(!rates.length&&!rolling.length&&!open){$('trend-plot').innerHTML='<p class="empty">Not enough completed history for the accident trends yet.</p>';return;}
  const W=Math.max(300,$('trend-plot').clientWidth||640),H=300,L=W<420?54:68,T=24,B=48,R=W<420?132:150,plotRight=W-R,plotW=plotRight-L,plotH=H-T-B;
  const gapMax=Math.max(60,...rolling.map(item=>item.median),open?.minutes||0)*1.12,rateMax=Math.max(.5,Math.ceil(Math.max(0,...rates.map(item=>item.rate))*2)/2);
  const xStart=history===null?now.getTime():history;
  const x=time=>L+(time-xStart)/Math.max(1,now.getTime()-xStart)*plotW;
  const gy=value=>T+plotH*(1-value/gapMax),ry=value=>T+plotH*(1-value/rateMax);
  const series=[];
  if(rolling.length)series.push({name:'Wee accident gap',color:'#b65a3d',dash:'',items:rolling,value:i=>i.median,y:gy,format:compactDuration});
  if(rates.length)series.push({name:'Accidents / 24h',color:'#7053a3',dash:'5 4',items:rates,value:i=>i.rate,y:ry,format:v=>`${v.toFixed(1)} / 24h`});
  let svg='';
  for(let i=0;i<=4;i++){
    const frac=i/4,gv=gapMax*frac,rv=rateMax*(1-frac),yy=T+plotH*(1-frac);
    svg+=`<line x1="${L}" x2="${plotRight}" y1="${yy}" y2="${yy}" class="chart-grid"/><text x="${L-8}" y="${yy+4}" text-anchor="end" class="chart-axis-label">${compactDuration(gv)}</text><text x="${plotRight+7}" y="${yy+4}" class="chart-axis-label">${rv.toFixed(1)}</text>`;
  }
  const ends=[];
  for(const s of series){let path='';s.items.forEach((item,i)=>{const completedAt=item.item?.completedAt??item.completedAt,xx=x(completedAt),yy=s.y(s.value(item));path+=`${i?'L':'M'}${xx} ${yy} `;svg+=`<circle cx="${xx}" cy="${yy}" r="2.5" fill="${s.color}"/>`;});svg+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-dasharray="${s.dash}"/>`;const last=s.items.at(-1);if(last)ends.push({...s,x:x(last.item?.completedAt??last.completedAt),y:s.y(s.value(last)),v:s.value(last)});}
  const labelPositions=resolveMedianLabelPositions(ends.map((e,i)=>({metric:i,y:e.y})),T+12,H-B-12,28);
  ends.forEach((e,i)=>{const pos=labelPositions.get(i),label=e.format(e.v),w=label.length*6.5+10,labelX=plotRight+34;svg+=`<g class="trend-endpoint" data-series="${e.name}" data-value="${e.v}" role="img" aria-label="${e.name}, latest value ${label}"><path d="M${e.x+4} ${e.y} H${plotRight+4} L${labelX-3} ${pos.labelY}" fill="none" stroke="${e.color}"/><rect x="${labelX}" y="${pos.labelY-12}" width="${w}" height="24" rx="4" fill="#fffef9" stroke="${e.color}"/><text x="${labelX+5}" y="${pos.labelY+4}" font-size="11">${label}</text></g>`;});
  const ticks=rates.length?`<text x="${W-8}" y="${T+plotH/2}" transform="rotate(90 ${W-8} ${T+plotH/2})" text-anchor="middle" class="chart-axis-title">Accidents / 24h · higher worse</text>`:'';
  const legend=series.map(s=>`<span><svg width="28" height="14" aria-hidden="true"><path d="M1 7H27" stroke="${s.color}" stroke-width="2.5" stroke-dasharray="${s.dash}"/><circle cx="14" cy="7" r="3" fill="${s.color}"/></svg>${s.name}</span>`).join('');
  if(open){const xx=x(now.getTime()),yy=gy(open.minutes),size=4;svg+=`<g class="trend-open-accident" role="img" aria-label="Current wee accident gap ${compactDuration(open.minutes)} so far; excluded from completed-gap median"><title>Current wee accident gap ${compactDuration(open.minutes)} so far; excluded from completed-gap median</title><path d="M${xx} ${yy-size} L${xx+size} ${yy} L${xx} ${yy+size} L${xx-size} ${yy} Z" fill="#fffef9" stroke="#8e3f2d" stroke-width="2"/><text x="${L+4}" y="${T+12}" fill="#8e3f2d" font-size="10">Current open gap ${compactDuration(open.minutes)} · excluded from median</text></g>`;}
  const axisTitles=`<text x="${L}" y="${H-5}" class="chart-axis-title">Wee accident gap</text>${ticks}`;
  $('trend-plot').innerHTML=`<div class="trend-legend">${legend}${open?'<span><svg width="28" height="14" viewBox="0 0 28 14" aria-hidden="true"><path d="M14 2 L19 7 L14 12 L9 7 Z" fill="#fffef9" stroke="#8e3f2d" stroke-width="2"/></svg>Current open gap</span>':''}</div><svg class="trend-svg" viewBox="0 0 ${W} ${H}" data-plot-right="${plotRight}" role="img" aria-label="Wee accident gap duration on the left axis and accidents per 24 hours on the right axis">${svg}${axisTitles}<line x1="${L}" x2="${plotRight}" y1="${T}" y2="${T+plotH}" class="chart-axis"/><line x1="${plotRight}" x2="${plotRight}" y1="${T}" y2="${T+plotH}" class="chart-axis"/></svg>`;
}
function connectTrends(){const buttons=[...document.querySelectorAll('[data-trend]')];const select=i=>{trendView=buttons[i].dataset.trend;renderTrends();};buttons.forEach((b,i)=>{b.addEventListener('click',()=>select(i));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length;select(next);buttons[next].focus();});});$('detailed-timing').addEventListener('toggle',()=>{if($('detailed-timing').open)renderTimingChart(activeEvents());});}
