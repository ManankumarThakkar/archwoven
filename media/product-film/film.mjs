// Original landing motion design over recorded provider outputs.
export const duration = 32;
export const chapters = [
  { start: 0, label: 'The system' }, { start: 3, label: 'The idea' },
  { start: 6, label: 'The request' }, { start: 12, label: 'The events' },
  { start: 19, label: 'The repository' }, { start: 23, label: 'The evidence' },
  { start: 28, label: 'Archwoven' },
];
const C={};
export function applyProductTheme(readToken){
  const tokens={bg:'--cv-bg',card:'--cv-raised',ink:'--cv-text',muted:'--cv-muted',mint:'--cv-accent',amber:'--cv-amber',paper:'--sh-bg',panel:'--sh-panel',line:'--cv-line',accentSoft:'--cv-accent-soft',bar:'--cv-bar',dot:'--cv-dot',shInk:'--sh-ink',shText:'--sh-text',shMuted:'--sh-muted',shBar:'--sh-bar',greenInk:'--sh-green-ink',greenSoft:'--sh-green-soft'};
  for(const [key,token]of Object.entries(tokens)){
    const value=readToken(token).trim();
    if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error(`Missing product colour: ${token}`);
    C[key]=value;
  }
}
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const lerp=(a,b,p)=>a+(b-a)*clamp(p);
const reveal=(t,at,length=.65)=>smooth((t-at)/length);
const rect=(x,y,w,h,fill,rx=20,extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const txt=(s,x,y,size=30,color=C.ink,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${esc(s)}</text>`;
const group=(body,opacity=1,transform='')=>`<g opacity="${opacity}" transform="${transform}">${body}</g>`;
function brand(x,y,scale=1,opacity=1){
  return group(`<path d="M7 32 18.2 8.7a2 2 0 0 1 3.6 0L33 32" fill="none" stroke="${C.ink}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.8 24H25a4 4 0 0 0 0-8h-5" fill="none" stroke="#2caa8c" stroke-width="3.4" stroke-linecap="round"/>${txt('rchwoven',35,31,34,C.ink,'font-weight="600" letter-spacing="-1.6"')}`,opacity,`translate(${x} ${y}) scale(${scale})`);
}
const W=260,H=116;
const streamPositions={
  'actor.viewer':[90,650],'client.web':[460,450],'client.tv':[460,850],
  'edge.cdn':[830,650],'gw.api':[1200,650],'svc.catalog':[1570,250],
  'svc.playback':[1570,650],'svc.recommendation':[1570,1050],
  'svc.accounts':[1940,1170],'queue.kafka':[1940,650],
  'svc.analytics':[2310,650],'db.clickhouse':[2680,650],
  'db.postgres':[2310,1170],'cache.redis':[2680,1170],
};
const streamLabels={'svc.catalog':['Catalog'],'svc.playback':['Playback'],'svc.analytics':['Analytics'],'svc.recommendation':['Recommendations'],'svc.accounts':['Accounts'],'queue.kafka':['Kafka','View Events'],'db.clickhouse':['ClickHouse','Aggregates'],'db.postgres':['PostgreSQL','Accounts'],'cache.redis':['Redis','Sessions']};
const repoPositions={'app.main':[120,600],'api.router':[540,600],'api.routes.items':[1020,200],'api.routes.login':[1020,400],'api.routes.users':[1020,600],'api.routes.private':[1020,800],'api.routes.utils':[1020,1000],'datastore.postgresql':[1620,600]};
const repoLabels={'app.main':['FastAPI app'],'api.router':['API router'],'api.routes.items':['Items router'],'api.routes.login':['Login router'],'api.routes.users':['Users router'],'api.routes.private':['Private router'],'api.routes.utils':['Utilities router']};
function cameraAt(time,stops){
  if(time<=stops[0][0])return stops[0].slice(1);
  for(let i=1;i<stops.length;i++)if(time<stops[i][0]){
    const a=stops[i-1],b=stops[i],p=smooth((time-a[0])/(b[0]-a[0]));
    return a.slice(1).map((v,j)=>lerp(v,b[j+1],p));
  }
  return stops.at(-1).slice(1);
}
function camera(body,[cx,cy,z],sx=960,sy=500){
  return `<g data-camera="true" transform="translate(${sx} ${sy}) scale(${z}) translate(${-cx} ${-cy})">${body}</g>`;
}
function labelLines(label){
  if(label.length<21)return[label];
  const lines=[''];
  for(const word of label.split(' ')){const last=lines.length-1;if((lines[last]+' '+word).trim().length>20)lines.push(word);else lines[last]=(lines[last]+' '+word).trim();}
  return lines;
}
function node(n,position,{active=true,proposed=false,labels}={}){
  const [x,y]=position,color=proposed?C.amber:C.mint,titles=labels||labelLines(n.label);
  const kind=n.kind==='datastore'?'DATA STORE':n.kind.toUpperCase();
  let s=rect(x,y,W,H,active?C.accentSoft:C.card,17,`stroke="${active?color:C.line}" stroke-width="${active?2.2:1.4}" ${proposed?'stroke-dasharray="7 5"':''}`);
  s+=`<circle cx="${x+22}" cy="${y+26}" r="4" fill="${color}"/>`+txt(kind,x+37,y+32,16,C.muted,'letter-spacing="1.7"');
  titles.forEach((line,i)=>s+=txt(line,x+20,y+(titles.length>1?68:82)+i*31,line.length>=14?26:29,C.ink,'font-weight="600" letter-spacing="-.6"'));
  if(proposed)s+=txt('PROPOSED',x+W-16,y+31,14,C.amber,'text-anchor="end" font-weight="600"');
  return `<g data-node="${esc(n.id)}">${s}</g>`;
}
function curve(a,b){
  const x1=a[0]+W,y1=a[1]+H/2,x2=b[0],y2=b[1]+H/2,bend=Math.max(60,(x2-x1)/2);
  return {d:`M${x1} ${y1}C${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`,x1,y1,x2,y2,bend};
}
function bezier(c,p){const q=1-p;return[q*q*q*c.x1+3*q*q*p*(c.x1+c.bend)+3*q*p*p*(c.x2-c.bend)+p*p*p*c.x2,q*q*q*c.y1+3*q*q*p*c.y1+3*q*p*p*c.y2+p*p*p*c.y2];}
const requestIds=['e.viewer-web','e.web-cdn','e.cdn-gateway','e.gateway-playback'];
const eventIds=['e.playback-kafka','e.kafka-analytics','e.analytics-clickhouse'];
function graph(model,positions,time,{phase='wide',labels={},pathIds=[],flowStart=0,flowStep=.9}={}){
  const edges=model.edges.filter(e=>positions[e.from]&&positions[e.to]);
  const selected=new Set(pathIds),activeNodes=new Set(edges.filter(e=>selected.has(e.id)).flatMap(e=>[e.from,e.to]));
  let s='';
  for(const e of edges){
    const c=curve(positions[e.from],positions[e.to]),active=selected.has(e.id),context=phase!=='wide'&&!active;
    if(e.from==='gw.api'&&e.to==='svc.accounts')c.d='M1460 708C1500 708 1500 760 1500 810V1180Q1500 1228 1548 1228H1940';
    if(e.from==='svc.accounts'&&e.to==='cache.redis')c.d='M2200 1228C2240 1228 2235 1350 2280 1350H2600C2650 1350 2620 1228 2680 1228';
    const proposed=e.provenance==='proposed'||model.nodes.find(n=>n.id===e.from)?.provenance==='proposed'||model.nodes.find(n=>n.id===e.to)?.provenance==='proposed';
    const color=proposed?C.amber:(active?C.mint:C.muted);
    const i=pathIds.indexOf(e.id),progress=active?clamp((time-flowStart-i*flowStep)/flowStep):0;
    s+=group(`<path data-edge="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${c.d}" fill="none" stroke="${color}" stroke-width="${active?3.3:1.9}" ${e.type==='async'||proposed?'stroke-dasharray="9 7"':''} marker-end="url(#arrow)"/>`,context?.22:.8);
    if(active&&progress>0)s+=`<path d="${c.d}" fill="none" stroke="${C.mint}" stroke-width="4.5" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1-progress}"/>`;
    if(active&&progress>0&&progress<1){const[x,y]=bezier(c,progress);s+=`<circle cx="${x}" cy="${y}" r="7" fill="${C.paper}"/><circle cx="${x}" cy="${y}" r="15" fill="${C.mint}" opacity=".16"/>`;}
    if(active&&e.label&&Math.abs(c.y2-c.y1)<50)s+=txt(e.label,(c.x1+c.x2)/2,Math.min(positions[e.from][1],positions[e.to][1])-24,20,C.mint,'text-anchor="middle"');
  }
  for(const n of model.nodes){if(!positions[n.id])continue;const active=phase==='wide'||activeNodes.has(n.id);s+=group(node(n,positions[n.id],{active,proposed:n.provenance==='proposed',labels:labels[n.id]}),active?1:.22);}
  return s;
}
function caption(title,subtitle='',opacity=1){return group(txt(title,960,946,50,C.ink,'text-anchor="middle" font-weight="600" letter-spacing="-1.7"')+(subtitle?txt(subtitle,960,994,24,C.muted,'text-anchor="middle"'):''),opacity);}
function stream(data,t){
  const phase=t<6?'wide':t<12?'request':'events';
  const stops=[[0,1530,780,.55],[3,1530,780,.58],[5.8,1460,760,.6],[6.8,790,660,1.02],[9.5,1160,690,1.03],[12,1650,710,1.05],[14.2,2250,710,1.05],[18.8,2440,710,1.08]];
  let s=camera(graph(data.description,streamPositions,t,{phase,labels:streamLabels,pathIds:phase==='request'?requestIds:phase==='events'?eventIds:[],flowStart:phase==='events'?12.5:6.2,flowStep:phase==='events'?1.25:1.05}),cameraAt(t,stops));
  if(t<6)s+=txt('A STREAMING PLATFORM',100,152,20,C.muted,'letter-spacing="2.4" font-weight="600"');
  if(t>=3&&t<6.4){
    const enter=reveal(t,3,.55),exit=1-reveal(t,5.7,.65);
    s+=group(rect(118,252,660,454,C.panel,24)+txt('DESCRIBE AN IDEA',158,315,20,C.greenInk,'font-weight="600" letter-spacing="1.8"')+txt('“A video streaming platform:',158,392,33,C.shInk,'font-weight="600"')+txt('viewers use web and TV apps…',158,447,30,C.shText)+txt('playback writes view events',158,502,30,C.shText)+txt('to Kafka…”',158,557,30,C.shText)+txt('Your words become a system to explore.',158,648,23,C.shMuted),enter*exit,`translate(${lerp(-55,0,enter)} 0)`);
  }
  if(t>=12)s+=group(rect(128,170,217,42,C.accentSoft,21)+txt('ASYNC EVENTS',148,198,19,C.mint,'letter-spacing="1.3" font-weight="600"'),reveal(t,12.4));
  return s;
}
function repo(data,t){
  const focus=t>=23;
  const stops=[[19,1030,650,.57],[21,1030,650,.64],[23,1030,650,.64],[24.1,650,660,.94],[28,650,660,.97]];
  let s=camera(graph(data.repository,repoPositions,t,{phase:focus?'evidence':'wide',labels:repoLabels,pathIds:focus?['e.app.router']:[],flowStart:23.3,flowStep:1.1}),cameraAt(t,stops),lerp(960,710,reveal(t,23,1.1)),500);
  s+=txt('FASTAPI · CONNECTED SOURCE MODULES',100,152,20,C.muted,'letter-spacing="2.4" font-weight="600"');
  if(!focus)s+=group(rect(107,815,950,58,C.bar,29)+txt('github.com/fastapi/full-stack-fastapi-template',138,853,26,C.mint),reveal(t,19.5));
  else{
    const p=reveal(t,23.4,.8),e=data.repository.edges.find(e=>e.id==='e.app.router').evidence[0];
    s+=group(rect(1100,255,690,535,C.panel,24)+rect(1140,296,255,40,C.greenSoft,20)+txt('SOURCE-SUPPORTED',1157,323,18,C.greenInk,'font-weight="600" letter-spacing="1"')+txt(e.path,1140,400,31,C.shInk,'font-weight="600" letter-spacing="-.6"')+txt(`LINE ${e.lines[0]}  ·  COMMIT ${e.commit.slice(0,7)}`,1140,447,22,C.shMuted)+rect(1140,483,610,146,C.shBar,12)+txt('app.include_router(',1160,524,25,C.shInk,'font-family="ui-monospace,monospace"')+txt('  api_router,',1160,564,25,C.shInk,'font-family="ui-monospace,monospace"')+txt('  prefix=settings.API_V1_STR)',1160,604,25,C.shInk,'font-family="ui-monospace,monospace"')+txt('Declared defaults are visible.',1140,688,25,C.greenInk)+txt('Environment overrides remain unverified.',1140,729,23,C.shMuted),p,`translate(${lerp(80,0,p)} 0)`);
  }
  return s;
}
function end(t){
  const p=reveal(t,27.5,.9),draw=reveal(t,28.15,1.4);
  return group(`<path d="M-100 720C200 720 245 305 620 305H800C1040 305 1000 765 1410 765H2020" stroke="${C.line}" stroke-width="2" fill="none" pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1-draw}"/>`+brand(540,295,4.3,reveal(t,28.25,.8))+txt('Architecture, connected.',960,650,74,C.ink,'text-anchor="middle" font-weight="600" letter-spacing="-3"')+txt('From an idea. From your code. Into clearer thinking.',960,722,31,C.muted,'text-anchor="middle"')+txt('archwoven.dev',960,840,32,C.mint,'text-anchor="middle" font-weight="600"'),p);
}
export function renderFilm(data,time){
  const t=Math.min(duration-.001,Math.max(0,Number(time)||0));
  const fadeOut=1-reveal(t,18.6,.8),fadeIn=reveal(t,18.6,.8),endFade=1-reveal(t,27.5,.8);
  const scenes=(t<19.4?group(stream(data,t),fadeOut):'')+(t>=18.6&&t<28.3?group(repo(data,t),fadeIn*endFade):'');
  const titles=t<3?['An idea becomes the big picture.','Components, connections and room for the unknowns.']:t<6?['Start with what you know.','Describe an idea in plain language.']:t<12?['Follow a request.','Viewer → Web App → CDN → API Gateway → Playback']:['See where the data goes.','Playback → Kafka → Analytics → ClickHouse'];
  const captions=(t<19.4?group(caption(...titles),fadeOut):'')+(t>=18.6&&t<28.3?group(t<23?caption('Bring your code into view.','Recorded repository analysis · source pinned to a commit.'):caption('A picture you can question.','Inspect the source. Keep the unknowns visible.'),fadeIn*endFade):'');
  const label=chapters.findLast(c=>t>=c.start).label;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-label="${esc(label)}" style="font-family:Inter,Arial,sans-serif"><defs><radialGradient id="atmosphere"><stop stop-color="${C.accentSoft}" stop-opacity=".25"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/></radialGradient><linearGradient id="caption-shade" x2="0" y2="1"><stop stop-color="${C.bg}" stop-opacity="0"/><stop offset=".45" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="${C.dot}" opacity=".22"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="m1 1 7 4-7 4" fill="none" stroke="${C.muted}" stroke-width="1.2"/></marker><clipPath id="safe-frame"><rect x="65" y="120" width="1790" height="760" rx="30"/></clipPath></defs>${rect(0,0,1920,1080,C.bg,0)}${rect(0,0,1920,1080,'url(#atmosphere)',0)}${rect(0,0,1920,1080,'url(#grid)',0)}${brand(88,53,.95,t<28?1:1-reveal(t,28,.4))}${txt(t<19?'FROM AN IDEA':'FROM A REPOSITORY',1832,81,18,C.muted,'text-anchor="end" letter-spacing="1.8" opacity="'+(t<28?1:0)+'"')}<g clip-path="url(#safe-frame)">${scenes}</g>${rect(0,875,1920,205,'url(#caption-shade)',0)}${captions}${t>=27.5?end(t):''}${txt('Recorded examples · motion illustration',1832,1041,17,C.muted,'text-anchor="end"')}</svg>`;
}
