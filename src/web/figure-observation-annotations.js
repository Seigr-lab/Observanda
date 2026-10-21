import {figureCoordinateNumber} from './figure-number-labels.js';
import messages from './locales/en/figureObservations.json' with {type:'json'};
import {figureStyle} from './figure-style.js';import {wrapAnnotationText} from './figure-annotation-layout.js';
export const observationAnnotation=a=>['region','callout'].includes(a.kind);
export function observationAnnotationIssues(a,f,xValue,{draft=false}={}){
 const common=['id','kind','label','color','opacity'],fields=a.kind==='region'?['xLower','xUpper','yLower','yUpper']:['seriesId','pointIndex','dx','dy'];
 if(Object.keys(a).sort().join()!==[...common,...fields].sort().join()||typeof a.label!=='string'||a.label.length>300||/[\u0000-\u001f]/.test(a.label)||!draft&&!a.label.trim()||!/^#[0-9a-f]{6}$/i.test(a.color)||!Number.isFinite(a.opacity)||a.opacity<0||a.opacity>1)return [messages.invalid];
 if(a.kind==='region'){
  if(f.x.kind==='category')return [messages.regionRange];
  for(const axis of ['x','y']){const kind=axis==='x'?f.x.kind:'number',raw=[a[axis+'Lower'],a[axis+'Upper']],values=raw.map(v=>xValue(v,kind));if(values.some((v,i)=>v===null&&(!draft||raw[i]!==null))||values.every(v=>v!==null)&&(values[0]>=values[1]||f[axis].scale==='log'&&values[0]<=0))return [messages.regionRange];}
 }else{
  const series=f.series.find(s=>s.id===a.seriesId),p=series?.points[a.pointIndex];
  if(!series||!Number.isInteger(a.pointIndex)||a.pointIndex<0||!draft&&(!p||p.y===null)||![a.dx,a.dy].every(v=>Number.isFinite(v)&&Math.abs(v)<=2000))return [messages.calloutRange];
 }return [];
}
export function createObservationAnnotation(kind,f){return {id:crypto.randomUUID(),kind,label:'',color:'#92549f',opacity:.15,...(kind==='region'?{xLower:null,xUpper:null,yLower:null,yUpper:null}:{seriesId:f.series[0].id,pointIndex:0,dx:24,dy:-36})};}
export function observationPosition(a,f){
 if(a.kind==='region')return `${f.x.label||'X'}: ${figureCoordinateNumber(f,'x',a.xLower)} – ${figureCoordinateNumber(f,'x',a.xUpper)}; ${f.y.label||'Y'}: ${figureCoordinateNumber(f,'y',a.yLower)} – ${figureCoordinateNumber(f,'y',a.yUpper)}`;
 const s=f.series.find(s=>s.id===a.seriesId),p=s?.points[a.pointIndex];return `${s?.name??a.seriesId} · ${messages.observation} ${a.pointIndex+1}: (${figureCoordinateNumber(f,'x',p?.x)}, ${figureCoordinateNumber(f,'y',p?.y)})`;
}
export function renderObservationAnnotations(f,{left,top,plotW,plotH,horizontal,cx,cy,vx,vy,clip,esc}){
 let background='',foreground='';const key=[],style=figureStyle(f),size=style.fontSize,boxes=[];
 const px=x=>horizontal?cy(x):cx(x),py=y=>horizontal?vx(y):vy(y);
 for(const [index,a] of (f.annotations??[]).entries()){
  if(!observationAnnotation(a))continue;const title='<title>'+esc(a.label+': '+observationPosition(a,f))+'</title>';
  if(a.kind==='region'){
   const coords=[px(a.xLower),px(a.xUpper)],values=[py(a.yLower),py(a.yUpper)],xs=horizontal?values:coords,ys=horizontal?coords:values,x=Math.min(...xs),y=Math.min(...ys),width=Math.abs(xs[1]-xs[0]),height=Math.abs(ys[1]-ys[0]);
   background+=`<g class="figure-xy-region" data-annotation-id="${a.id}" clip-path="url(#${clip})">${title}<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke="${a.color}" stroke-width="1.5" fill="${a.color}" fill-opacity="${a.opacity}"/></g>`;
   if(style.annotationLabels!=='hidden')key.push(a);continue;
  }
  const s=f.series.find(s=>s.id===a.seriesId),p=s?.points[a.pointIndex];if(!p||s.style?.visible===false)continue;
  const x=horizontal?vx(p.y):cx(p.x),y=horizontal?cy(p.x):vy(p.y);if(x<left||x>left+plotW||y<top||y>top+plotH)continue;
  foreground+=`<g class="figure-observation-anchor" data-series-id="${a.seriesId}" data-point-index="${a.pointIndex}">${title}<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${a.color}" stroke-width="2"/></g>`;
  if(style.annotationLabels==='hidden')continue;
  const lines=wrapAnnotationText(a.label,Math.min(220,plotW*.6),size),w=Math.min(plotW,Math.max(...lines.map(l=>l.length*size*.64))+12),h=lines.length*size*1.3+10;
  let box=null;
  if(style.annotationLabels!=='key'&&h<=plotH)for(const [dx,dy] of [[a.dx,a.dy],[a.dx,-a.dy],[-a.dx-w,a.dy],[-a.dx-w,-a.dy]]){const b={x:Math.max(left,Math.min(left+plotW-w,x+dx)),y:Math.max(top,Math.min(top+plotH-h,y+dy)),w,h};if(!boxes.some(o=>b.x<o.x+o.w+4&&b.x+b.w+4>o.x&&b.y<o.y+o.h+4&&b.y+b.h+4>o.y)){box=b;break;}}
  if(box){boxes.push(box);foreground+=`<g class="figure-observation-callout" data-annotation-id="${a.id}"><path d="M${x},${y} L${box.x+box.w/2},${box.y+box.h/2}" fill="none" stroke="${a.color}"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${style.background}" stroke="${a.color}"/><text x="${box.x+6}" y="${box.y+size+3}" font-size="${size}" fill="${style.textColor}">${lines.map((l,i)=>`<tspan x="${box.x+6}" dy="${i?size*1.3:0}">${esc(l)}</tspan>`).join('')}</text></g>`;}
  else{key.push(a);foreground+=`<text class="figure-observation-key-marker" x="${Math.min(left+plotW-14,x+8)}" y="${Math.max(top+size,y-8)}" font-size="${size}" fill="${a.color}">${index+1}</text>`;}
 }return {background,foreground,key};
}
export function referencedObservation(f,seriesId,index){return (f.annotations??[]).some(a=>a.kind==='callout'&&a.seriesId===seriesId&&(index===undefined||a.pointIndex===index));}
export function removedObservation(f,seriesId,index){for(const a of f.annotations??[])if(a.kind==='callout'&&a.seriesId===seriesId&&a.pointIndex>index)a.pointIndex--;}
export const observationAnnotationName=kind=>messages[kind];
