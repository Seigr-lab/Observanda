import {figureCoordinateNumber} from './figure-number-labels.js';
import {observationAnnotation,observationAnnotationIssues,renderObservationAnnotations,observationPosition,observationAnnotationName} from './figure-observation-annotations.js';
import observationMessages from './locales/en/figureObservations.json' with {type:'json'};
import messages from './locales/en/figureComposition.json' with {type:'json'};
import {figureStyle} from './figure-style.js';
import {placeAnnotationLabels,wrapAnnotationText} from './figure-annotation-layout.js';

const keys=(v,names)=>v&&Object.keys(v).sort().join()===names.sort().join();
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function annotationIssues(figure,xValue,{draft=false}={}){
 const annotations=figure.annotations;if(annotations===undefined)return [];
 if(!Array.isArray(annotations)||annotations.length>64)return [messages.annotationLimit];
 const ids=new Set();
 for(const a of annotations){
  if(a&&observationAnnotation(a)){if(!uuid(a.id)||ids.has(a.id))return [messages.annotationInvalid];ids.add(a.id);const errors=observationAnnotationIssues(a,figure,xValue,{draft});if(errors.length)return errors;continue;}
  if(!keys(a,['id','kind','axis','start','end','label','color','opacity'])||!uuid(a.id)||ids.has(a.id)||!['boundary','interval'].includes(a.kind)||!['x','y'].includes(a.axis)||typeof a.label!=='string'||a.label.length>300||/[\u0000-\u001f]/.test(a.label)||!/^#[0-9a-f]{6}$/i.test(a.color)||!Number.isFinite(a.opacity)||a.opacity<0||a.opacity>1||a.kind==='boundary'&&a.end!==null)return [messages.annotationInvalid];
  ids.add(a.id);
  const kind=a.axis==='x'?figure.x.kind:'number',start=xValue(a.start,kind),end=a.kind==='interval'?xValue(a.end,kind):start;
  if(kind==='category'||(!draft||a.start!==null)&&start===null||(!draft||a.end!==null)&&end===null||start!==null&&end!==null&&(a.kind==='interval'&&end<=start||figure[a.axis].scale==='log'&&(start<=0||end<=0)))return [messages.annotationRange];
  if(!draft&&!a.label.trim())return [messages.annotationInvalid];
 }
 return [];
}
export const createAnnotation=(kind,axis='x')=>({id:crypto.randomUUID(),kind,axis,start:null,end:null,label:'',color:'#92549f',opacity:.15});

// Coordinates and clipping come from the same transforms used for measurements.
export function renderAnnotations(figure,{left,top,plotW,plotH,horizontal,cx,cy,vx,vy,clip,esc}){
 let background='',foreground='';const items=[],style=figureStyle(figure),size=style.fontSize;
 for(const [index,a] of (figure.annotations??[]).entries()){
  if(observationAnnotation(a))continue;
  const vertical=(a.axis==='x')!==horizontal,project=a.axis==='x'?(horizontal?cy:cx):(horizontal?vx:vy),start=project(a.start),end=a.kind==='interval'?project(a.end):start;
  if(!Number.isFinite(start)||!Number.isFinite(end))continue;
  const low=Math.min(start,end),high=Math.max(start,end),min=vertical?left:top,max=min+(vertical?plotW:plotH);
  if(high<min||low>max)continue;
  const title='<title>'+esc(a.label+': '+figureCoordinateNumber(figure,a.axis,a.start)+(a.kind==='interval'?' – '+figureCoordinateNumber(figure,a.axis,a.end):''))+'</title>',attr='stroke="'+a.color+'" stroke-width="1.5" stroke-dasharray="6 4"';
  const line=p=>vertical?`<line x1="${p}" x2="${p}" y1="${top}" y2="${top+plotH}" ${attr}/>`:`<line x1="${left}" x2="${left+plotW}" y1="${p}" y2="${p}" ${attr}/>`;
  if(a.kind==='interval')background+=`<g class="figure-interval" clip-path="url(#${clip})">${title}<rect x="${vertical?low:left}" y="${vertical?top:low}" width="${vertical?high-low:plotW}" height="${vertical?plotH:high-low}" fill="${a.color}" fill-opacity="${a.opacity}"/></g>`;
  items.push({annotation:a,index,start,vertical});
  foreground+=`<g class="figure-annotation" data-annotation-id="${a.id}" clip-path="url(#${clip})">${title}${line(start)}${a.kind==='interval'?line(end):''}</g>`;
 }
 const layout=placeAnnotationLabels(items,{left,top,plotW,plotH,size,mode:style.annotationLabels});
 for(const {item,box} of layout.labels){
  const {x,y,width,height}=box;
  foreground+=`<g class="figure-annotation-label" data-annotation-id="${item.annotation.id}"><rect x="${x-2}" y="${y-2}" width="${width+4}" height="${height+4}" fill="${style.background}" fill-opacity=".9"/><text x="${x}" y="${y+size}" font-size="${size}" fill="${style.textColor}">${esc(item.annotation.label)}</text></g>`;
 }
 const advanced=renderObservationAnnotations(figure,{left,top,plotW,plotH,horizontal,cx,cy,vx,vy,clip,esc});
 return {background:background+advanced.background,foreground:foreground+advanced.foreground,key:[...(layout.key?items.map(item=>item.annotation):[]),...advanced.key]};
}

export function renderAnnotationKey(figure,annotations,{width,y,esc}){
 if(!annotations.length)return {svg:'',height:0};
 const style=figureStyle(figure),size=style.fontSize,columns=width>=760?2:1,columnWidth=(width-40)/columns;
 let cursor=y+size+12,svg=`<text class="figure-annotation-key-heading" x="20" y="${cursor}" font-size="${size}" font-weight="600">${esc(messages.annotations)}</text>`;
 cursor+=size+12;
 for(let index=0;index<annotations.length;index+=columns){
  let rowHeight=0;
  for(let col=0;col<columns&&index+col<annotations.length;col++){
   const a=annotations[index+col],x=20+col*columnWidth,axis=figure[a.axis]?.label||messages[a.axis==='x'?'coordinate':'value'];
   const label=wrapAnnotationText((a.kind==='callout'?(figure.annotations.indexOf(a)+1)+'. ':'')+a.label,columnWidth-38,size),position=wrapAnnotationText(observationAnnotation(a)?observationPosition(a,figure):axis+': '+figureCoordinateNumber(figure,a.axis,a.start)+(a.kind==='interval'?' – '+figureCoordinateNumber(figure,a.axis,a.end):''),columnWidth-38,size);
   const text=(lines,top,cls,weight='normal')=>`<text class="${cls}" x="${x+26}" y="${top}" font-size="${size}" font-weight="${weight}">${lines.map((line,i)=>`<tspan x="${x+26}" dy="${i?size*1.3:0}">${esc(line)}</tspan>`).join('')}</text>`;
   svg+=`<g class="figure-annotation-key-item" data-annotation-id="${a.id}"><title>${esc(observationAnnotation(a)?observationAnnotationName(a.kind):messages[a.kind])}</title>`;
   if(a.kind==='interval')svg+=`<rect x="${x}" y="${cursor-size+2}" width="18" height="${size}" fill="${a.color}" fill-opacity="${a.opacity}"/>`;
   svg+=`<line x1="${x}" x2="${x+18}" y1="${cursor-size/2}" y2="${cursor-size/2}" stroke="${a.color}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
   svg+=text(label,cursor,'figure-annotation-key-label','600')+text(position,cursor+label.length*size*1.3+4,'figure-annotation-key-position')+'</g>';
   rowHeight=Math.max(rowHeight,(label.length+position.length)*size*1.3+18);
  }
  cursor+=rowHeight;
 }
 return {svg:`<g class="figure-annotation-key" fill="${style.textColor}">${svg}</g>`,height:cursor-y};
}
export function annotationTable(figure,esc){
 const all=figure.annotations??[],rows=all.filter(a=>!observationAnnotation(a)),advanced=all.filter(observationAnnotation);if(!all.length)return '';
 const detail=advanced.length?'<table class="figure-observation-annotations-table"><caption>'+esc(messages.annotations)+'</caption><thead><tr><th>'+esc(messages.annotationLabel)+'</th><th>'+esc(observationMessages.position)+'</th></tr></thead><tbody>'+advanced.map(a=>'<tr><th scope="row">'+esc(a.label)+'</th><td>'+esc(observationPosition(a,figure))+'</td></tr>').join('')+'</tbody></table>':'';
 if(!rows.length)return detail;
 return '<table class="figure-annotations-table"><caption>'+esc(messages.annotations)+'</caption><thead><tr>'+['annotationLabel','dataKind','axis','start','end'].map(k=>'<th scope="col">'+esc(messages[k])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(a=>'<tr><th scope="row">'+esc(a.label)+'</th><td>'+esc(messages[a.kind])+'</td><td>'+esc(messages[a.axis==='x'?'coordinate':'value'])+'</td><td>'+esc(figureCoordinateNumber(figure,a.axis,a.start))+'</td><td>'+esc(figureCoordinateNumber(figure,a.axis,a.end))+'</td></tr>').join('')+'</tbody></table>'+detail;
}
