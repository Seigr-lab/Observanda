import {modelMessages} from './model-messages.js';
import {figureDataNumber,figureCoordinateNumber} from './figure-number-labels.js';
import messages from './locales/en/figureAxes.json' with {type:'json'};
import {wrapFigureText} from './figure-text-layout.js';
export function axisControlIssues(axis,{draft=false,kind='number',retained=false}={}){
 if(axis.reversed!==undefined&&typeof axis.reversed!=='boolean')return [messages.invalid];
 if(axis.ticks===undefined)return [];
 if(!Array.isArray(axis.ticks)||kind==='category'&&axis.ticks.length||!retained&&axis.ticks.length>100)return [messages.invalid];
 const seen=new Set();for(const tick of axis.ticks){if(!tick||Object.keys(tick).sort().join()!=='label,value'||!Number.isFinite(tick.value)||Math.abs(tick.value)>1e100||kind==='date'&&Math.abs(tick.value)>8.64e15||typeof tick.label!=='string'||!retained&&tick.label.length>300||/[\u0000-\u001f]/.test(tick.label)||!draft&&(!tick.label.trim()||seen.has(tick.value)||axis.scale==='log'&&tick.value<=0||axis.min!==null&&tick.value<axis.min||axis.max!==null&&tick.value>axis.max))return [messages.invalid];seen.add(tick.value);}
 return [];
}
export const axisFraction=(fraction,axis)=>axis.reversed?1-fraction:fraction;
export const explicitAxisTicks=axis=>axis.ticks?.length?[...axis.ticks].sort((a,b)=>a.value-b.value):null;
export const axisTickValues=axis=>(axis.ticks??[]).map(t=>t.value);
export function customTickLayout(ticks,{position,start,end,size,horizontal,labelWidth=220}){
 // Move labels, never tick positions. Leaders keep crowded labels associated
 // with their exact numeric positions, including reversed axes.
 const items=ticks.map(t=>{const lines=wrapFigureText(t.label,labelWidth,size);return {...t,lines,height:lines.length*size*1.3+8,target:position(t.value)};}).sort((a,b)=>a.target-b.target);
 if(horizontal){const lanes=[],heights=[];for(const item of items){item.width=Math.min(end-start,Math.max(size,...item.lines.map(l=>l.length*size*.64)));item.center=Math.max(start+item.width/2,Math.min(end-item.width/2,item.target));let lane=0;while(lanes[lane]!==undefined&&item.center-item.width/2<lanes[lane]+8)lane++;lanes[lane]=item.center+item.width/2;heights[lane]=Math.max(heights[lane]??0,item.height);item.lane=lane;}for(const item of items)item.offset=heights.slice(0,item.lane).reduce((a,b)=>a+b,0);return {items,height:heights.reduce((a,b)=>a+b,0)};}
 for(const [i,item] of items.entries())item.center=Math.max(item.target,start+item.height/2,i?items[i-1].center+(items[i-1].height+item.height)/2:-Infinity);
 if(items.at(-1)?.center+items.at(-1).height/2>end){items.at(-1).center=end-items.at(-1).height/2;for(let i=items.length-2;i>=0;i--)items[i].center=Math.min(items[i].center,items[i+1].center-(items[i+1].height+items[i].height)/2);}
 return {items,height:0};
}
export const verticalTickHeight=(ticks,width,size)=>ticks.reduce((n,t)=>n+wrapFigureText(t.label,width,size).length*size*1.3+8,0);
export function renderCustomAxis(ticks,{position,left,top,plotW,plotH,horizontal,style,grid,cls,esc,labelValue=value=>figureDataNumber(value,style)}){
 const size=style.fontSize,layout=customTickLayout(ticks,{position,start:horizontal?left:top,end:horizontal?left+plotW:top+plotH,size,horizontal,labelWidth:horizontal?Math.min(220,plotW):left-28});let svg='';
 for(const item of layout.items){const p=item.target;if(p<(horizontal?left:top)-.001||p>(horizontal?left+plotW:top+plotH)+.001)continue;
  if(grid)svg+=horizontal?`<line x1="${p}" x2="${p}" y1="${top}" y2="${top+plotH}" stroke="${style.gridColor}"/>`:`<line x1="${left}" x2="${left+plotW}" y1="${p}" y2="${p}" stroke="${style.gridColor}"/>`;
  const x=horizontal?item.center:left-12,y=horizontal?top+plotH+size*1.6+item.offset:item.center-(item.lines.length-1)*size*.65+size*.35;
  const path=horizontal?`M${p},${top+plotH} V${top+plotH+4} L${x},${y-size}`:`M${left},${p} H${left-4} L${left-9},${item.center}`;
  svg+=`<g class="figure-custom-tick" data-value="${item.value}"><path d="${path}" fill="none" stroke="${style.axisColor}"/><text class="${cls}" x="${x}" y="${y}" text-anchor="${horizontal?'middle':'end'}" font-size="${size}"><title>${esc(labelValue(item.value)+': '+item.label)}</title>${item.lines.map((line,i)=>`<tspan x="${x}" dy="${i?size*1.3:0}">${esc(line)}</tspan>`).join('')}</text></g>`;
 }return svg;
}
export function axisControlTable(f,esc,{translate}={}){const text=modelMessages('figureAxes',messages,translate);return ['x','y'].filter(k=>f[k].ticks?.length||f[k].reversed).map(k=>'<table class="figure-axis-settings-table"><caption>'+esc(f[k].label||text(k))+' · '+esc(text('direction'))+': '+esc(text(f[k].reversed?'reversed':'normal'))+'</caption><thead><tr><th>'+esc(text('value'))+'</th><th>'+esc(text('label'))+'</th></tr></thead><tbody>'+(f[k].ticks??[]).map(t=>'<tr><td>'+esc(figureCoordinateNumber(f,k,t.value))+'</td><td>'+esc(t.label)+'</td></tr>').join('')+'</tbody></table>').join('');}
