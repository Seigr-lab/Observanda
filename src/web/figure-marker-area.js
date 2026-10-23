import {figureDataNumber} from './figure-number-labels.js';
import messages from './locales/en/figureMarkerArea.json' with {type:'json'};
import {seriesStyle,figureStyle} from './figure-style.js';
import {wrapFigureText} from './figure-text-layout.js';
export const defaultMarkerArea=()=>({unitArea:24,label:messages.defaultLabel});
export function markerAreaIssues(f,{draft=false,retained=false}={}){
 const a=f.markerArea,points=f.series?.flatMap(s=>s.points)??[];
 if(points.some(p=>p.count!=null&&(!Number.isSafeInteger(p.count)||p.count<0)))return [messages.countInvalid];
 if(a===undefined)return [];
 if(!a||Object.keys(a).sort().join()!=='label,unitArea'||typeof a.label!=='string'||!retained&&a.label.length>300||/[\u0000-\u001f]/.test(a.label)||!Number.isFinite(a.unitArea)||a.unitArea<=0||a.unitArea>65536)return [messages.invalid];
 if(!draft&&(!['line','scatter'].includes(f.kind)||!a.label.trim()||points.some(p=>p.y!==null&&p.count==null)||points.some(p=>p.count*a.unitArea>65536)))return [messages.range];
 return [];
}
// All supported shapes have the same declared area. Scaling radius by count
// would square the encoded ratio, so each shape derives its dimensions here.
export function areaMarker({area,x,y,shape='circle',color='currentColor',hint='',esc,numeric:n=v=>v,cls='figure-count-marker'}){
 if(!(area>0))return '';const title='<title>'+esc(hint)+'</title>',attrs=`class="${cls}" data-area="${area}" fill="${color}" stroke="none"`;
 if(shape==='square'){const side=Math.sqrt(area);return `<rect ${attrs} x="${n(x-side/2)}" y="${n(y-side/2)}" width="${side}" height="${side}">${title}</rect>`;}
 if(shape==='diamond'){const r=Math.sqrt(area/2);return `<path ${attrs} d="M${n(x)},${n(y-r)} l${r},${r} l${-r},${r} l${-r},${-r} Z">${title}</path>`;}
 return `<circle ${attrs} cx="${n(x)}" cy="${n(y)}" r="${Math.sqrt(area/Math.PI)}">${title}</circle>`;
}
export function markerAreaLegend(f,{width,y,esc}){
 if(!f.markerArea)return {svg:'',height:0};
 const values=[...new Set(f.series.filter(s=>seriesStyle(s).visible).flatMap(s=>s.points.filter(p=>p.y!==null&&p.count>0).map(p=>p.count)))].sort((a,b)=>a-b),samples=[...new Set([values[0],values[Math.floor(values.length/2)],values.at(-1)].filter(v=>v!==undefined))],a=f.markerArea;
 const format=value=>figureDataNumber(value,figureStyle(f));
 const lines=wrapFigureText(a.label+' · '+messages.legendRule.replace('{area}',format(a.unitArea)),width-40,13);
 let svg=`<g class="figure-marker-size-legend"><text x="20" y="${y+24}" font-size="13">${lines.map((line,i)=>`<tspan x="20" dy="${i?17:0}">${esc(line)}</tspan>`).join('')}</text>`,cursor=y+30+lines.length*17;
 for(const value of samples){const r=Math.sqrt(value*a.unitArea/Math.PI),rowH=2*r+36;svg+=areaMarker({area:value*a.unitArea,x:width/2,y:cursor+r,color:'#667085',hint:a.label+': '+format(value),esc,cls:'figure-count-example'})+`<text x="${width/2}" text-anchor="middle" y="${cursor+2*r+20}" font-size="13">${esc(format(value))}</text>`;cursor+=rowH;}
 svg+=`<text x="20" y="${cursor+16}" font-size="12">${esc(messages.zero)}</text></g>`;return {svg,height:cursor+36-y};
}
