// Laila's Lab weekly report. Usage: node weekly.js csv YYYY-MM   |   node weekly.js report [YYYY-MM-DD as "today"]
// Reads her practice history from the public database, in Eastern time. Needs Node 18+.
const PROJECT='lailas-math-lab',ET='America/New_York';
const dayKey=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:ET,year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);
const timeOf=ts=>new Intl.DateTimeFormat('en-US',{timeZone:ET,hour:'numeric',minute:'2-digit'}).format(ts);
const keyAdd=(k,n)=>{const[y,m,d]=k.split('-').map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)};
const dow=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(Date.UTC(y,m-1,d)).getUTCDay()};
const dec=v=>{if('integerValue' in v)return +v.integerValue;if('doubleValue' in v)return +v.doubleValue;if('stringValue' in v)return v.stringValue;if('booleanValue' in v)return v.booleanValue;
  if('arrayValue' in v)return(v.arrayValue.values||[]).map(dec);if('mapValue' in v){const o={};for(const k in(v.mapValue.fields||{}))o[k]=dec(v.mapValue.fields[k]);return o}return null};
async function fetchAll(){
  const url=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery`;
  const out=[];let before=null;
  for(;;){
    const q={from:[{collectionId:'sessions'}],orderBy:[{field:{fieldPath:'ts'},direction:'DESCENDING'}],limit:500};
    if(before!=null)q.where={fieldFilter:{field:{fieldPath:'ts'},op:'LESS_THAN',value:{doubleValue:before}}};
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({structuredQuery:q})});
    if(!r.ok)throw new Error('database '+r.status);
    const rows=(await r.json()).filter(x=>x.document);
    rows.forEach(x=>{const o={id:x.document.name.split('/').pop()};for(const k in x.document.fields)o[k]=dec(x.document.fields[k]);out.push(o)});
    if(rows.length<500)break;before=out[out.length-1].ts;
  }
  return out.sort((a,b)=>a.ts-b.ts);
}
const SPN={test:'Practice Test',cards:'Look, Cover, Write',fill:'Complete the Word',scramble:'Unscramble',hunt:'Word Hunt',sent:'Fill the Sentence',write:'Write a Sentence',spot:'Spot the Right Spelling'};
const ESN={quiz:'Examen',listen:'Escucha',match:'Empareja',type:'Escríbelo',fill:'Completa la palabra',scramble:'Ordena las letras'};
const GN={gcap:'Capital Quiz',gstate:'Which State?',gab:'State Abbreviations',gfl:'Florida Facts',sall:'Soccer Quiz',srule:'Rules Quiz',spos:'Positions Quiz',sspace:'Spacing Quiz',quiz:'Game Day Quiz',draft:'Division Draft',rules:'Rookie Rules'};
const SK={sub2:'Regroup tens (2-digit)',sub3o:'Regroup ones (3-digit)',sub3t:'Regroup tens (3-digit)',sub3b:'Regroup ones and tens',subz:'Subtract across zeros',sub32:'3-digit minus 2-digit',add3:'Add with regrouping',word:'Word problems',miss:'Find the missing number',mulA:'Times 2, 5 and 10',mulB:'Times 3 and 4',mulC:'Times 6, 7, 8 and 9',mulD:'Mixed times facts',mul10:'Times multiples of 10',mulmiss:'Missing factor',mulword:'Equal groups word problems'};
function info(s){
  const it=(s.items&&s.items[0])||{},es=s.mode==='spell'&&it.t==='es',a=it.a||'';
  const subject=s.mode==='geo'?'States':s.mode==='soc'?'Soccer':s.mode==='nfl'?'Football':es?'Español':s.mode==='spell'?'Spelling':'Math';
  let activity;
  if(a.startsWith('rev:'))activity='Review';
  else if(subject==='Math')activity=a.startsWith('sk:')?(SK[a.slice(3)]||a):({smart:'Smart Practice',guided:'Guided Practice',exam:'Practice Exam'}[s.mode]||s.mode);
  else activity=(es?ESN:subject==='Spelling'?SPN:GN)[it.g]||it.g||'';
  const clean=(s.items||[]).filter(i=>i.ok&&!i.h).length,helped=(s.items||[]).filter(i=>i.ok&&i.h).length;
  return{subject,activity,review:a.startsWith('rev:'),clean,helped,es};
}
const csvCell=v=>{v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
function csv(sessions,month){
  const head=['Date','Day','Week of (Mon)','Time (ET)','Subject','Activity','Where','Right','Questions','Percent','Right on first try','Right with help','Minutes','Stars earned','Stars paid?','Review round?'];
  const rows=sessions.filter(s=>dayKey(s.ts).startsWith(month)).map(s=>{
    const d=dayKey(s.ts),i=info(s),wk=keyAdd(d,-((dow(d)+6)%7));
    return[d,['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow(d)],wk,timeOf(s.ts),i.subject,i.activity,s.home||'',s.correct,s.total,s.total?Math.round(100*s.correct/s.total):0,i.clean,i.helped,Math.max(1,Math.round((s.secs||0)/60)),s.stars||0,s.stars>0?'Yes':'Practice only',i.review?'Yes':''];
  });
  return[head,...rows].map(r=>r.map(csvCell).join(',')).join('\n');
}
/* spaced review, same schedule as the app: 1 day, 3 days, 7 days */
function revRun(ev){let st=null;const gap=[1,3,7];ev.forEach(e=>{if(!e.clean){st={stage:0,due:keyAdd(e.day,1)};return}if(!st||st.stage>=3)return;if(e.day>=st.due){st.stage++;st.due=st.stage<3?keyAdd(e.day,gap[st.stage]):null}});return st}
function report(sessions,today){
  const mon=keyAdd(today,-((dow(today)+6)%7)),sun=keyAdd(mon,6),prev=keyAdd(mon,-7);
  const inW=(s,a,b)=>{const d=dayKey(s.ts);return d>=a&&d<=b};
  const wk=sessions.filter(s=>inW(s,mon,sun)),pw=sessions.filter(s=>inW(s,prev,keyAdd(mon,-1)));
  const by={};wk.forEach(s=>{const i=info(s),o=by[i.subject]||(by[i.subject]={sessions:0,minutes:0,stars:0,right:0,total:0,clean:0});o.sessions++;o.minutes+=Math.max(1,Math.round((s.secs||0)/60));o.stars+=s.stars||0;o.right+=s.correct;o.total+=s.total;o.clean+=info(s).clean});
  const days=new Set(wk.map(s=>dayKey(s.ts)));
  const all=new Set(sessions.filter(s=>!['nfl','soc'].includes(s.mode)).map(s=>dayKey(s.ts)));
  let streak=0,k=today;if(!all.has(k))k=keyAdd(k,-1);while(all.has(k)){streak++;k=keyAdd(k,-1)}
  /* words and skills */
  const wordEv={},skillEv={};
  sessions.forEach(s=>{
    const isEs=info(s).es,day=dayKey(s.ts);
    if(s.mode==='spell')(s.items||[]).forEach(i=>{if(!i.w)return;const key=(isEs?'es:':'sp:')+i.w;(wordEv[key]||(wordEv[key]=[])).push({day,clean:!!i.ok&&!i.h})});
    if(['smart','guided','exam'].includes(s.mode)){const g={};(s.items||[]).forEach(i=>{if(!i.t)return;const a=g[i.t]||(g[i.t]={n:0,c:0});a.n++;if(i.ok&&!i.h)a.c++});Object.entries(g).forEach(([t,a])=>{if(a.n<2)return;const f=a.c/a.n;if(f>=.8)(skillEv[t]||(skillEv[t]=[])).push({day,clean:true});else if(f<.6)(skillEv[t]||(skillEv[t]=[])).push({day,clean:false})})}
  });
  const dueOf=ev=>Object.entries(ev).filter(([,e])=>{const st=revRun(e);return st&&st.stage<3&&st.due<=today}).map(([k])=>k);
  const masteredBy=(cut)=>{const m=new Set();for(const[k,ev]of Object.entries(wordEv)){const e=ev.filter(x=>x.day<=cut);let streak2=0;for(let j=e.length-1;j>=0&&e[j].clean;j--)streak2++;if(streak2>=2)m.add(k)}return m};
  const nowM=masteredBy(today),beforeM=masteredBy(keyAdd(mon,-1));
  const newlyMastered=[...nowM].filter(k=>!beforeM.has(k)).map(k=>k.slice(3));
  const tricky=Object.entries(wordEv).filter(([,e])=>e.length>=2&&e.slice(-3).filter(x=>!x.clean).length>=2).map(([k])=>k.slice(3));
  const skillRows=Object.entries(skillEv).map(([t,e])=>({skill:SK[t]||t,last:e[e.length-1].clean?'solid':'needs work'}));
  const sum=(a,f)=>a.reduce((n,s)=>n+f(s),0);
  return{
    week:mon+' to '+sun,today,
    sessions:wk.length,previousWeekSessions:pw.length,minutes:sum(wk,s=>Math.max(1,Math.round((s.secs||0)/60))),stars:sum(wk,s=>s.stars||0),previousWeekStars:sum(pw,s=>s.stars||0),
    daysPracticed:days.size,streak,bySubject:by,
    reviewsWaiting:{spelling:dueOf(wordEv).filter(k=>k.startsWith('sp:')).length,espanol:dueOf(wordEv).filter(k=>k.startsWith('es:')).length,mathSkills:dueOf(skillEv).map(t=>SK[t]||t)},
    newlyMastered,trickyWords:tricky.slice(0,12),skills:skillRows,
    practiceRounds:wk.filter(s=>!(s.stars>0)).length,
    totalSessionsEver:sessions.length
  };
}
(async()=>{
  const [cmd,arg]=process.argv.slice(2),sessions=await fetchAll();
  if(cmd==='csv')console.log(csv(sessions,arg));
  else if(cmd==='months')console.log([...new Set(sessions.map(s=>dayKey(s.ts).slice(0,7)))].join('\n'));
  else console.log(JSON.stringify(report(sessions,arg||dayKey(Date.now())),null,1));
})().catch(e=>{console.error('FAILED',e.message);process.exit(1)});
