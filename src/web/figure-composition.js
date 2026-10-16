import messages from './locales/en/figureComposition.json' with {type:'json'};

const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const text=v=>typeof v==='string'&&v.length<=300&&!/[\u0000-\u001f]/.test(v);
export const figurePlots=figure=>figure.kind==='panels'?figure.panels.map(p=>p.figure):[figure];
export const figureTargets=figures=>figures.flatMap(f=>[{id:f.id,title:f.title},...(f.kind==='panels'?f.panels.map(p=>({id:p.figure.id,title:f.title+' / '+p.label+' · '+p.figure.title})):[])]);
export function cloneFigure(figure,uuid=()=>crypto.randomUUID()){
 const copy=structuredClone(figure);copy.id=uuid();
 for(const plot of figurePlots(copy)){
  if(copy.kind==='panels')plot.id=uuid();
  const seriesIds=new Map();plot.series.forEach(s=>{const old=s.id;s.id=uuid();seriesIds.set(old,s.id);});plot.annotations?.forEach(a=>{a.id=uuid();if(a.kind==='callout')a.seriesId=seriesIds.get(a.seriesId)??a.seriesId;});
 }
 if(copy.kind==='panels')copy.panels.forEach(p=>p.id=uuid());
 return copy;
}
export function createComposition(plots){
 return {id:crypto.randomUUID(),title:messages.title,kind:'panels',layout:{columns:2,linkX:false,linkY:false},panels:plots.map((figure,i)=>({id:crypto.randomUUID(),label:String.fromCharCode(65+i),figure:cloneFigure(figure)}))};
}
export function compositionIssues(figure,validatePlot,{draft=false}={}){
 if(!figure||Object.keys(figure).sort().join()!==('source' in figure?'id,kind,layout,panels,source,title':'id,kind,layout,panels,title')||!uuid(figure.id)||!text(figure.title)||!draft&&!figure.title.trim()||!figure.layout||Object.keys(figure.layout).sort().join()!=='columns,linkX,linkY'||!['linkX','linkY'].every(k=>typeof figure.layout[k]==='boolean'))return [messages.structure];
 if(!Number.isInteger(figure.layout.columns)||figure.layout.columns<1||figure.layout.columns>3||!Array.isArray(figure.panels)||figure.panels.length<2||figure.panels.length>8)return [messages.limits];
 const ids=new Set([figure.id]),issues=[];
 for(const p of figure.panels){
  if(!p||Object.keys(p).sort().join()!=='figure,id,label'||!uuid(p.id)||ids.has(p.id)||!text(p.label)||!draft&&!p.label.trim()||!p.figure||p.figure.kind==='panels'||!uuid(p.figure.id)||ids.has(p.figure.id)||p.id===p.figure.id)return [messages.invalidPanel];
  ids.add(p.id);ids.add(p.figure.id);issues.push(...validatePlot(p.figure,{draft}));
 }
 if(issues.length)return issues;
 const plots=figurePlots(figure),first=plots[0];
 for(const axis of ['x','y'])if(figure.layout[axis==='x'?'linkX':'linkY']){
  if(plots.some(f=>f.kind==='heatmap')||axis==='x'&&first.x.kind==='category'||plots.some(f=>f[axis].kind!==first[axis].kind||f[axis].scale!==first[axis].scale||!!f[axis].reversed!==!!first[axis].reversed||JSON.stringify([...(f[axis].ticks??[])].sort((a,b)=>a.value-b.value).map(t=>[t.value,t.label]))!==JSON.stringify([...(first[axis].ticks??[])].sort((a,b)=>a.value-b.value).map(t=>[t.value,t.label]))||f[axis].label!==first[axis].label||(f.kind==='bar-horizontal')!==(first.kind==='bar-horizontal')))return [messages.incompatible];
 }
 return [];
}

// The union includes each panel's explicit limits and symmetric uncertainty.
// Rendering overrides copies only; saved independent ranges stay untouched.
export function linkedPanelPlots(figure,domains){
 const plots=figurePlots(figure),ranges=plots.map(domains),shared={};
 for(const axis of ['x','y'])if(figure.layout[axis==='x'?'linkX':'linkY'])shared[axis]={min:Math.min(...ranges.map(r=>r[axis].min)),max:Math.max(...ranges.map(r=>r[axis].max))};
 return plots.map(f=>({...f,...Object.fromEntries(Object.entries(shared).map(([axis,range])=>[axis,{...f[axis],...range}]))}));
}
