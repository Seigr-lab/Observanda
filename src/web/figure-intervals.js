import messages from './locales/en/figureIntervals.json' with {type:'json'};
export const INTERVAL_FIELDS=['xLower','xUpper','yLower','yUpper'];
export const pointIntervals=p=>({x:[p.xLower??p.x,p.xUpper??p.x],y:[p.yLower??(p.y===null?null:p.y-(p.error??0)),p.yUpper??(p.y===null?null:p.y+(p.error??0))]});
export function intervalIssues(p,figure,xValue,{draft=false}={}){
 const issues=[],present=k=>p[k]!==undefined&&p[k]!==null,number=v=>Number.isFinite(v)&&Math.abs(v)<=1e100;
 for(const k of INTERVAL_FIELDS)if(present(k)&&!(k[0]==='x'?xValue(p[k],figure.x.kind)!==null:number(p[k])))issues.push(messages.invalid);
 if(draft)return issues;
 for(const axis of ['x','y']){
  const lo=axis+'Lower',hi=axis+'Upper';if(!present(lo)&&!present(hi))continue;
  if(p.y===null||axis==='x'&&figure.x.kind==='category'||!present(lo)||!present(hi)){issues.push(messages.complete);continue;}
  const a=axis==='x'?xValue(p[lo],figure.x.kind):p[lo],b=axis==='x'?xValue(p[hi],figure.x.kind):p[hi],v=axis==='x'?xValue(p.x,figure.x.kind):p.y;
  if(a>v||b<v||a>b||figure[axis].scale==='log'&&a<=0)issues.push(messages.enclose);
 }
 if((present('yLower')||present('yUpper'))&&p.error!==null)issues.push(messages.conflict);
 if(figure.kind==='heatmap'&&INTERVAL_FIELDS.some(present))issues.push(messages.heatmap);
 return issues;
}
export function renderIntervals(p,{px,py,horizontal,cx,cy,vx,vy,numeric:n}){
 let svg='';const bounds=pointIntervals(p);
 for(const axis of ['x','y']){
  if(bounds[axis][0]===null||bounds[axis][1]===null||bounds[axis][0]===bounds[axis][1])continue;
  const vertical=axis==='x'?horizontal:!horizontal,project=axis==='x'?(horizontal?cy:cx):(horizontal?vx:vy),a=project(bounds[axis][0]),b=project(bounds[axis][1]);
  const d=vertical?`M${n(px)},${n(a)} V${n(b)} M${n(px-4)},${n(a)} h8 M${n(px-4)},${n(b)} h8`:`M${n(a)},${n(py)} H${n(b)} M${n(a)},${n(py-4)} v8 M${n(b)},${n(py-4)} v8`;
  svg+=`<path class="figure-measurement-interval figure-interval-${axis}" d="${d}" fill="none" stroke-width="1.4"/>`;
 }return svg;
}
export const intervalHint=(p,format=value=>value)=>INTERVAL_FIELDS.filter(k=>p[k]!==undefined&&p[k]!==null).map(k=>messages[k]+': '+format(p[k],k)).join('; ');
