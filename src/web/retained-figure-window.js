// A display window retains original identities and global Cartesian domains.
// Full exports use the original reader; display abbreviations never alter it.
import {seriesStyle} from './figure-style.js';
import {retainedFigureText} from './retained-figure-text.js';
const short=value=>{
 if(retainedFigureText(value))return value.preview.replace(/[\uD800-\uDBFF]$/,'')+'\u2026';
 if(Array.isArray(value))return value.map(short);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,short(item)]));
 return value;
};
export async function retainedFigureWindow(reader,window,{signal}={}){
 const {plotId,seriesOffset=0,seriesLimit,pointOffset=0,pointLimit}=window;
 if(typeof plotId!=='string'||![seriesOffset,pointOffset].every(v=>Number.isSafeInteger(v)&&v>=0)||!Number.isInteger(seriesLimit)||seriesLimit<1||seriesLimit>16||!Number.isInteger(pointLimit)||pointLimit<1||pointLimit>128)throw new Error('Invalid retained figure display window');
 signal?.throwIfAborted();const opened=await reader.header({plotId}),heatmap=opened.header.kind==='heatmap',series=(await reader.window({collection:'series',plotId,offset:seriesOffset,limit:seriesLimit})).items,points=new Map(),ranks=new Set();
 for(const item of series){signal?.throwIfAborted();if(heatmap)continue;const page=await reader.window({collection:'points',plotId,seriesId:item.id,offset:pointOffset,limit:pointLimit});points.set(item.id,page.items);if(seriesStyle(item.value).visible)for(const point of page.items)if(Number.isSafeInteger(point.categoryPosition))ranks.add(point.categoryPosition);}
 const categories=[];
 if(heatmap)categories.push(...(await reader.window({collection:'categories',plotId,offset:pointOffset,limit:pointLimit})).items);
 else for(const offset of [...ranks].sort((a,b)=>a-b)){signal?.throwIfAborted();const page=await reader.window({collection:'categories',plotId,offset,limit:1});if(page.items.length!==1)throw new Error('Missing retained display category');categories.push(page.items[0]);}
 const ticks=(await reader.window({collection:'ticks',plotId,offset:0,limit:128})).items;
 const display=Object.create(reader);
 display.header=async()=>({...short(opened),domains:{...opened.domains,...(heatmap?{categoryCount:categories.length,visibleSeriesCount:series.filter(item=>seriesStyle(item.value).visible).length}:{})}});
 display.items=async function*(selection){
  const values=selection.collection==='series'?series:selection.collection==='points'?(points.get(selection.seriesId)??[]):selection.collection==='categories'?categories:selection.collection==='ticks'?ticks:selection.collection==='annotations'?[]:null;
  if(values===null)throw new Error('Unsupported retained display collection');
  for(let i=0;i<values.length;i++){signal?.throwIfAborted();yield {...short(values[i]),...(heatmap&&selection.collection==='categories'?{windowPosition:i}:{})};}
 };
 // Methods stay bound to the authorized reader: its private roots never become
 // client supplied display data. Heatmap cells use the retained final value.
 for(const name of ['window','item','pointAtCategory','categoryPosition','textChunks'])if(typeof reader[name]==='function')display[name]=reader[name].bind(reader);
 return display;
}
