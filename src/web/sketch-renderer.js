import {sketchBounds} from './sketch-model.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=value=>String(Math.round(value*1000)/1000);
// Only validated primitives are rendered. No raw SVG, external resources,
// script, CSS, fragment references or workspace dependencies are accepted.
export function sketchItemSVG(i){
 const stroke=`stroke="${i.colour}" stroke-width="${n(i.weight)}" stroke-linecap="round" stroke-linejoin="round"`;
 if(i.kind==='stroke')return i.points.length===1?`<circle cx="${n(i.points[0][0])}" cy="${n(i.points[0][1])}" r="${n(i.weight/2)}" fill="${i.colour}"/>`:`<polyline points="${i.points.map(p=>p.map(n).join(',')).join(' ')}" fill="none" ${stroke}/>`;
 if(i.kind==='text')return `<text x="${n(i.x)}" y="${n(i.y)}" fill="${i.colour}" font-family="sans-serif" font-size="${n(i.size)}" dominant-baseline="hanging">${i.text.split('\n').map((t,j)=>`<tspan x="${n(i.x)}" dy="${j?'1.2em':'0'}">${esc(t)}</tspan>`).join('')}</text>`;
 const b=sketchBounds(i);
 if(i.kind==='rectangle')return `<rect x="${n(b.left)}" y="${n(b.top)}" width="${n(b.right-b.left)}" height="${n(b.bottom-b.top)}" fill="${i.fill}" ${stroke}/>`;
 if(i.kind==='ellipse')return `<ellipse cx="${n((b.left+b.right)/2)}" cy="${n((b.top+b.bottom)/2)}" rx="${n((b.right-b.left)/2)}" ry="${n((b.bottom-b.top)/2)}" fill="${i.fill}" ${stroke}/>`;
 const line=`<line x1="${n(i.x)}" y1="${n(i.y)}" x2="${n(i.x2)}" y2="${n(i.y2)}" ${stroke}/>`;
 if(i.kind==='line'||i.x===i.x2&&i.y===i.y2)return line;
 const angle=Math.atan2(i.y2-i.y,i.x2-i.x),length=Math.min(Math.hypot(i.x2-i.x,i.y2-i.y)/2,Math.max(10,i.weight*4)),point=offset=>[i.x2-length*Math.cos(angle+offset),i.y2-length*Math.sin(angle+offset)].map(n).join(',');
 return line+`<polyline points="${point(-.45)} ${n(i.x2)},${n(i.y2)} ${point(.45)}" fill="none" ${stroke}/>`;
}
export function renderSketch(a,{editing=false,selected=null}={}){
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}" role="img" aria-label="${esc(a.title)}"${editing?' data-sketch-canvas tabindex="0"':''}><title>${esc(a.title)}</title><desc>${esc(a.description)}</desc><rect width="${a.width}" height="${a.height}" fill="${a.background}"/>${a.items.map(i=>`<g${editing?` data-sketch-item="${i.id}"`:''}>${sketchItemSVG(i)}</g>`).join('')}${editing&&selected?a.items.filter(i=>i.id===selected).map(i=>{const b=sketchBounds(i);return `<rect x="${n(Math.max(0,b.left-4))}" y="${n(Math.max(0,b.top-4))}" width="${n(Math.max(8,b.right-b.left+8))}" height="${n(Math.max(8,b.bottom-b.top+8))}" fill="none" stroke="#3958ba" stroke-width="1" stroke-dasharray="4 4" pointer-events="none"/>`;}).join(''):''}</svg>`;
}
