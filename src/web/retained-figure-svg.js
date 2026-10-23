import {retainedFigureWindow} from './retained-figure-window.js';
// Complete retained-figure SVG output. Iteration is bounded independently of
// point, series, panel and annotation counts; consumers must drain the stream.
import {figureStyle,seriesStyle,FONT_FAMILIES} from './figure-style.js';
import {figureDomain,figureFraction,figureTicks} from './figure-scales.js';
import {axisFraction} from './figure-axis-controls.js';
import {xValue} from './figure-model.js';
import {figureDataNumber,figureCoordinateNumber,figureTickLabels} from './figure-number-labels.js';
import {renderIntervals,intervalHint} from './figure-intervals.js';
import {areaMarker} from './figure-marker-area.js';
import {renderAnnotations} from './figure-annotations.js';
import {projectionDescription,projectionAxisLabel} from './figure-projection-display.js';
import {figureNumeralHelp} from './figure-radix-labels.js';
import {heatmapBand,heatmapThresholdText} from './figure-heatmap.js';
import heatmapMessages from './locales/en/figureHeatmap.json' with {type:'json'};
import markerMessages from './locales/en/figureMarkerArea.json' with {type:'json'};
import {escapeFigureText as esc,figureTextChunks,figureTextHeight,figureSVGText,retainedFigureText,composeFigureText} from './retained-figure-text.js';
const n=value=>{if(!Number.isFinite(value))throw new Error('Non-finite retained figure geometry');return Number(value.toFixed(3));};
const check=signal=>signal?.throwIfAborted();
const selection=(collection,id,field,plotId)=>({collection,id,field,...(plotId?{plotId}:{})});
const headerText=(f,field)=>selection('header',f.plotId??f.id,field);
const summaryValue=(range,log)=>log?[range.positiveMin,range.positiveMax]:[range.min,range.max];
const scope=(collection,plotId,seriesId)=>({collection,plotId,...(seriesId?{seriesId}:{})});
async function* items(reader,collection,plotId,signal,seriesId){for await(const row of reader.items(scope(collection,plotId,seriesId))){check(signal);yield row;}}
const preview=value=>(retainedFigureText(value)?value.preview:String(value??'')).replace(/[\uD800-\uDBFF]$/,'');
function axisName(f,axis){
 const value=f.kind==='heatmap'&&axis==='y'?f.heatmap.valueLabel:f[axis].label,field=f.kind==='heatmap'&&axis==='y'?'heatmap.valueLabel':axis+'.label';
 if(!retainedFigureText(value))return projectionAxisLabel(f,axis);
 const parts=[{value,selection:headerText(f,field)}];
 if(f.projection?.[axis]){const marker='__RETAINED_AXIS__',example={...f,[axis]:{...f[axis],label:marker},...(f.kind==='heatmap'&&axis==='y'?{heatmap:{...f.heatmap,valueLabel:marker}}:{})},text=projectionAxisLabel(example,axis),at=text.indexOf(marker);parts.unshift({value:text.slice(0,at)});parts.push({value:text.slice(at+marker.length)});}
 return composeFigureText(parts);
}
function projectionLines(f){
 const example={...f,x:{...f.x,label:'__RETAINED_X__'},y:{...f.y,label:'__RETAINED_Y__'},...(f.kind==='heatmap'?{heatmap:{...f.heatmap,valueLabel:'__RETAINED_Y__'}}:{})};
 return projectionDescription(example).map(text=>{const match=text.match(/__RETAINED_([XY])__/);if(!match)return text;const axis=match[1].toLowerCase(),field=f.kind==='heatmap'&&axis==='y'?'heatmap.valueLabel':axis+'.label',value=f.kind==='heatmap'&&axis==='y'?f.heatmap.valueLabel:f[axis].label;return composeFigureText([{value:text.slice(0,match.index)},{value:value||(axis==='x'?'X':'Value'),selection:headerText(f,field)},{value:text.slice(match.index+match[0].length)}]);});
}
async function* legends(reader,g){
 const {f,plotId,width,style,domains}=g,position=g.legendPosition;
 if(!f.legend)return;
 const available=position==='right'?g.legendWidth:width-40;
 const longest=Math.max(100,(domains.maximumSeriesNameLength??24)*style.legendSize*.85+26);
 const columns=position==='right'?1:Math.max(1,Math.floor(available/Math.min(available,longest))),cellWidth=available/columns;
 let row=[],y=0;
 for await(const item of items(reader,'series',plotId,g.signal)){
  const name=item.value.name,height=await figureTextHeight(reader,name,selection('series',item.id,'name',plotId),cellWidth-26,style.legendSize)+12;
  row.push({item,height});
  if(row.length===columns){const height=Math.max(...row.map(v=>v.height));for(let i=0;i<row.length;i++)yield {...row[i],x:i*cellWidth,y,cellWidth};y+=height;row=[];}
 }
 for(let i=0;i<row.length;i++)yield {...row[i],x:i*cellWidth,y,cellWidth};
}
async function annotationFigure(reader,g,row){
 const a={...row.value,label:preview(row.value.label)},f={...g.f,annotations:[a],series:[],style:{...g.style,annotationLabels:g.style.annotationLabels==='hidden'?'hidden':'key'}};
 if(a.kind==='callout'){
  const series=await reader.item({collection:'series',plotId:g.plotId,id:a.seriesId});
  const page=await reader.window({collection:'points',plotId:g.plotId,seriesId:a.seriesId,offset:a.pointIndex,limit:1}),p=page.items[0];
  if(!series||!p||p.position!==a.pointIndex)throw new Error('Missing retained figure annotation point');
  f.series=[{...series.value,name:preview(series.value.name),id:series.id,points:{[a.pointIndex]:{...p.value,x:retainedFigureText(p.value.x)?preview(p.value.x):p.value.x,_retainedCategoryPosition:p.categoryPosition}}}];
 }
 return f;
}
async function annotationDetails(reader,g,row){
 const a=row.value;
 if(a.kind==='callout'){
  const point=(await reader.window({collection:'points',plotId:g.plotId,seriesId:a.seriesId,offset:a.pointIndex,limit:1})).items[0],p=point.value,series=await reader.item({collection:'series',plotId:g.plotId,id:a.seriesId});
  return [{value:series.value.name,selection:selection('series',series.id,'name',g.plotId)},{value:composeFigureText([{value:'Observation '+(a.pointIndex+1)+': ('},{value:g.f.x.kind==='category'?p.x:figureCoordinateNumber(g.f,'x',p.x),selection:selection('points',point.id,'x',g.plotId)},{value:', '+figureCoordinateNumber(g.f,'y',p.y)+')'}]),selection:null}];
 }
 const value=a.kind==='region'?'X: '+figureCoordinateNumber(g.f,'x',a.xLower)+' - '+figureCoordinateNumber(g.f,'x',a.xUpper)+'; Y: '+figureCoordinateNumber(g.f,'y',a.yLower)+' - '+figureCoordinateNumber(g.f,'y',a.yUpper):(a.axis==='x'?preview(g.f.x.label):preview(g.f.y.label))+': '+figureCoordinateNumber(g.f,a.axis,a.start)+(a.kind==='interval'?' - '+figureCoordinateNumber(g.f,a.axis,a.end):'');
 return [{value,selection:null}];
}
async function keyHeight(reader,g){
 if(g.style.annotationLabels==='hidden')return 0;
 let height=g.style.fontSize+8;
 for await(const a of items(reader,'annotations',g.plotId,g.signal)){
  height+=await figureTextHeight(reader,a.value.label,selection('annotations',a.id,'label',g.plotId),g.width-76,g.style.fontSize)+8;
  for(const detail of await annotationDetails(reader,g,a))height+=await figureTextHeight(reader,detail.value,detail.selection,g.width-76,g.style.fontSize)+8;
  height+=8;
 }
 return height;
}
async function plotLayout(reader,options){
 check(options.signal);const opened=await reader.header({plotId:options.plotId}),f=opened.header,domains=opened.domains,style=figureStyle(f),plotId=f.plotId??f.id;
 if(!domains||!domains.x||!domains.y)throw new Error('Missing retained figure domains');
 const width=Math.max(320,options.width??style.width),height=options.height??Math.max(260,width*style.height/style.width),horizontal=f.kind==='bar-horizontal';
 const g={f,plotId,domains,counts:opened.counts,style,width,height,horizontal,signal:options.signal};
 g.legendPosition=style.legendPosition==='right'&&width<650?'bottom':style.legendPosition;
 g.legendWidth=f.legend&&g.legendPosition==='right'?Math.min(width*.28,220):0;
 g.legendHeight=0;for await(const entry of legends(reader,g))g.legendHeight=Math.max(g.legendHeight,entry.y+entry.height);
 g.titleHeight=style.showTitle?await figureTextHeight(reader,f.title,headerText(f,'title'),width-40,style.titleSize)+12:0;
 g.left=Math.min(width*.42,Math.max(80,horizontal&&f.x.kind==='category'?Math.min(220,(domains.maximumCategoryLength??0)*style.fontSize*.85+30):style.fontSize*7));
 g.right=g.legendWidth?g.legendWidth+24:28;
 g.plotW=width-g.left-g.right;
 g.axisHorizontal=horizontal?'y':'x';g.axisVertical=horizontal?'x':'y';
 g.horizontalLabelHeight=await figureTextHeight(reader,axisName(f,g.axisHorizontal),headerText(f,g.axisHorizontal+'.label'),g.plotW,style.fontSize+2);
 g.verticalLabelHeight=await figureTextHeight(reader,axisName(f,g.axisVertical),headerText(f,g.axisVertical+'.label'),g.plotW,style.fontSize+2);
 g.tickHeight=style.fontSize*1.3;
 const provisionalHeight=Math.max(110,height-160);
 g.categoryStep=style.labelStep||Math.max(1,Math.ceil(domains.categoryCount*style.fontSize*6/(horizontal?provisionalHeight:g.plotW)));
 if(f.x.kind==='category'&&!horizontal)for await(const c of items(reader,'categories',plotId,g.signal))if(c.position%g.categoryStep===0)g.tickHeight=Math.max(g.tickHeight,await figureTextHeight(reader,c.value,selection('categories',c.id,'value',plotId),Math.max(24,g.plotW*g.categoryStep/Math.max(1,domains.categoryCount)),style.fontSize));
 for await(const tick of items(reader,'ticks',plotId,g.signal))if(tick.value.axis===g.axisHorizontal)g.tickHeight=Math.max(g.tickHeight,await figureTextHeight(reader,tick.value.label,selection('ticks',tick.id,'label',plotId),Math.min(180,g.plotW),style.fontSize));
 g.verticalLabelY=20+g.titleHeight+(f.legend&&g.legendPosition==='top'?g.legendHeight+12:0)+style.fontSize;
 g.top=g.verticalLabelY+g.verticalLabelHeight+12;
 g.bottom=g.tickHeight+g.horizontalLabelHeight+48+(f.legend&&g.legendPosition==='bottom'?g.legendHeight+12:0);
 g.height=Math.max(height,g.top+g.bottom+110,g.legendWidth?g.top+g.legendHeight+g.bottom:0);
 g.plotH=g.height-g.top-g.bottom;
 g.horizontalLabelY=g.top+g.plotH+g.tickHeight+style.fontSize*1.6+16;
 g.bottomLegendY=g.horizontalLabelY+g.horizontalLabelHeight+style.legendSize+12;
 const bars=['bar','bar-horizontal','area'].includes(f.kind);
 g.x=options.shared?.x??figureDomain(summaryValue(domains.x,f.x.scale==='log'),f.x);
 g.y=options.shared?.y??figureDomain(summaryValue(domains.y,f.y.scale==='log'),f.y,bars);
 g.clip=(options.idPrefix??'retained')+'-'+plotId;
 g.keyHeight=await keyHeight(reader,g);
 g.footerLines=projectionLines(f);
 g.footerHeight=0;for(const line of g.footerLines)g.footerHeight+=await figureTextHeight(reader,line,null,width-40,style.fontSize)+8;
 if(f.markerArea){
  let minimum=Infinity,maximum=-Infinity;
  for await(const series of items(reader,'series',plotId,g.signal))if(seriesStyle(series.value).visible)for await(const point of items(reader,'points',plotId,g.signal,series.id))if(point.value.y!==null&&point.value.count>0){minimum=Math.min(minimum,point.value.count);maximum=Math.max(maximum,point.value.count);}
  g.markerSamples=Number.isFinite(minimum)?minimum===maximum?[minimum]:[minimum,maximum]:[];
  g.markerRule=markerMessages.legendRule.replace('{area}',figureDataNumber(f.markerArea.unitArea,style));
  g.footerHeight+=await figureTextHeight(reader,f.markerArea.label,headerText(f,'markerArea.label'),width-40,style.fontSize)+await figureTextHeight(reader,g.markerRule,null,width-40,style.fontSize)+await figureTextHeight(reader,markerMessages.zero,null,width-40,style.fontSize)+32;
  for(const count of g.markerSamples)g.footerHeight+=2*Math.sqrt(count*f.markerArea.unitArea/Math.PI)+style.fontSize*2+16;
 }
 g.total=g.height+g.keyHeight+g.footerHeight;n(g.total);
 return g;
}
function transforms(g,categoryPosition){
 const {f,left,top,plotW,plotH}=g;
 const coordinate=v=>axisFraction(f.x.kind==='category'?(categoryPosition+.5)/Math.max(1,g.domains.categoryCount):figureFraction(xValue(v,f.x.kind),g.x,f.x.scale==='log'),f.x);
 const magnitude=v=>axisFraction(figureFraction(v,g.y,f.y.scale==='log'),f.y);
 return {cx:v=>left+coordinate(v)*plotW,cy:v=>top+coordinate(v)*plotH,vx:v=>left+magnitude(v)*plotW,vy:v=>top+(1-magnitude(v))*plotH};
}
async function pointTransforms(reader,g,p,rank){
 const index=g.f.x.kind==='category'?(rank??p._retainedCategoryPosition??await reader.categoryPosition({plotId:g.plotId,value:p.x})):null;
 if(g.f.x.kind==='category'&&!Number.isSafeInteger(index))throw new Error('Missing retained category');
 return transforms(g,index);
}
function validPoint(p,f){return p.y!==null&&Number.isFinite(p.y)&&(f.x.kind==='category'?typeof p.x==='string'||retainedFigureText(p.x):xValue(p.x,f.x.kind)!==null)&&(f.y.scale!=='log'||p.y-(p.error??0)>0)&&(f.x.scale!=='log'||xValue(p.x,f.x.kind)>0);}
async function* axes(reader,g){
 const {f,style,left,top,plotW,plotH,horizontal}=g,t=transforms(g,null),custom={x:0,y:0};
 for await(const row of items(reader,'ticks',g.plotId,g.signal)){
  const tick=row.value,axis=tick.axis,isHorizontal=axis==='x'?!horizontal:horizontal;
  custom[axis]++;const value=axis==='x'&&f.x.kind==='date'?new Date(tick.value).toISOString():tick.value;
  const position=(axis==='x'?(horizontal?t.cy:t.cx):(horizontal?t.vx:t.vy))(value);
  if(position<(isHorizontal?left:top)||position>(isHorizontal?left+plotW:top+plotH))continue;
  yield '<g class="figure-custom-tick" data-value="'+tick.value+'">';
  yield* tickLine(g,position,isHorizontal,axis);
  yield* figureSVGText(reader,tick.label,selection('ticks',row.id,'label',g.plotId),isHorizontal?position:left-12,isHorizontal?top+plotH+style.fontSize*1.6:position,{anchor:isHorizontal?'middle':'end',width:isHorizontal?Math.min(180,plotW):left-24,size:style.fontSize,cls:'figure-custom-tick-label'});yield '</g>';
 }
 for(const axis of ['x','y']){
  if(custom[axis])continue;
  const isHorizontal=axis==='x'?!horizontal:horizontal;
  if(axis==='x'&&f.x.kind==='category'){
   const space=isHorizontal?plotW:plotH,step=g.categoryStep;
   for await(const row of items(reader,'categories',g.plotId,g.signal)){
    if(row.position%step)continue;const frac=axisFraction((row.position+.5)/Math.max(1,g.domains.categoryCount),f.x),pos=(isHorizontal?left:top)+frac*space;
    yield* tickLine(g,pos,isHorizontal,axis);
    yield* figureSVGText(reader,row.value,selection('categories',row.id,'value',g.plotId),isHorizontal?pos:left-12,isHorizontal?top+plotH+style.fontSize*1.6:pos,{anchor:isHorizontal?'middle':'end',width:isHorizontal?Math.max(24,space*step/g.domains.categoryCount):left-24,size:style.fontSize});
   }
   continue;
  }
  const values=figureTicks(g[axis],f[axis].scale==='log',Math.max(2,Math.floor((isHorizontal?plotW:plotH)/(style.fontSize*7)))),labels=figureTickLabels(values,style);
  for(let i=0;i<values.length;i++){
   const raw=axis==='x'&&f.x.kind==='date'?new Date(values[i]).toISOString():values[i],pos=(axis==='x'?(horizontal?t.cy:t.cx):(horizontal?t.vx:t.vy))(raw);
   const label=axis==='x'&&f.x.kind==='date'?raw.slice(0,style.dateFormat==='year'?4:style.dateFormat==='month'?7:style.dateFormat==='datetime'?16:10):labels[i];
   yield* tickLine(g,pos,isHorizontal,axis);
   const tickWidth=isHorizontal?plotW/Math.max(1,values.length):left-24;let tickSize=style.fontSize;
   // Generated numeric/date tokens must stay intact. Fit against the same
   // bounded line metric used by SVG text, without changing their spelling.
   while(await figureTextHeight(reader,label,null,tickWidth,tickSize)>tickSize*1.3)tickSize*=.9;
   yield* figureSVGText(reader,label,null,isHorizontal?pos:left-12,isHorizontal?top+plotH+style.fontSize*1.6:pos+tickSize*.35,{anchor:isHorizontal?(i===0?'start':i===values.length-1?'end':'middle'):'end',width:tickWidth,size:tickSize,cls:'figure-generated-tick-label'});
  }
 }
 yield '<path d="M'+left+','+top+' V'+(top+plotH)+' H'+(left+plotW)+'" fill="none" stroke="'+style.axisColor+'"/>';
 for(const axis of ['x','y']){
  const isHorizontal=axis===g.axisHorizontal;
  yield* figureSVGText(reader,axisName(f,axis),headerText(f,axis+'.label'),isHorizontal?left+plotW/2:left,isHorizontal?g.horizontalLabelY:g.verticalLabelY,{anchor:isHorizontal?'middle':'start',width:plotW,size:style.fontSize+2,cls:'figure-axis-label'});
 }

}
function* tickLine(g,pos,horizontal,axis){
 if(g.style.grid==='none'||axis==='x'&&g.style.grid!=='both')return;
 yield horizontal?'<line x1="'+n(pos)+'" x2="'+n(pos)+'" y1="'+g.top+'" y2="'+(g.top+g.plotH)+'" stroke="'+g.style.gridColor+'"/>':'<line x1="'+g.left+'" x2="'+(g.left+g.plotW)+'" y1="'+n(pos)+'" y2="'+n(pos)+'" stroke="'+g.style.gridColor+'"/>';
}
async function* seriesGraphic(reader,g,row,index){
 const {f,style,plotId}=g,s={...row.value,id:row.id},line=seriesStyle(s),color=s.color,base=Math.max(g.y.min,Math.min(g.y.max,0)),bars=f.kind==='bar'||g.horizontal;
 yield '<g class="figure-series-graphic" data-series-id="'+row.id+'" clip-path="url(#'+g.clip+')" fill="'+color+'" stroke="'+color+'"><title>';yield* escaped(reader,s.name,selection('series',row.id,'name',plotId));yield '</title>';
 if(['line','area'].includes(f.kind)){
  // A path attribute itself is streamed: no array or growing path string.
  if(f.kind==='area'){
   let first=null,last=null,open=false;
   for await(const point of items(reader,'points',plotId,g.signal,row.id)){
    const p=point.value;
    if(!validPoint(p,f)){if(open){yield ' L'+n(last.x)+','+n(last.base)+' L'+n(first.x)+','+n(first.base)+' Z" fill-opacity=".14" stroke="none"/>';open=false;}continue;}
    const t=await pointTransforms(reader,g,p,point.categoryPosition),v={x:t.cx(p.x),y:t.vy(p.y),base:t.vy(base)};
    if(!open){yield '<path d="M'+n(v.x)+','+n(v.y);first=v;open=true;}else yield ' L'+n(v.x)+','+n(v.y);last=v;
   }
   if(open)yield ' L'+n(last.x)+','+n(last.base)+' L'+n(first.x)+','+n(first.base)+' Z" fill-opacity=".14" stroke="none"/>';
  }
  yield '<path class="figure-line" d="';let pen=false;
  for await(const point of items(reader,'points',plotId,g.signal,row.id)){
   const p=point.value;if(!validPoint(p,f)){pen=false;continue;}const t=await pointTransforms(reader,g,p,point.categoryPosition);yield (pen?' L':' M')+n(t.cx(p.x))+','+n(t.vy(p.y));pen=true;
  }
  yield '" fill="none" stroke-width="'+line.lineWidth+'" stroke-linejoin="round"'+(line.dash==='solid'?'':' stroke-dasharray="'+(line.dash==='dashed'?'8 5':'2 4')+'"')+'/>';
 }
 for await(const point of items(reader,'points',plotId,g.signal,row.id)){
  const p=point.value;if(!validPoint(p,f))continue;
  const t=await pointTransforms(reader,g,p,point.categoryPosition);let px=g.horizontal?t.vx(p.y):t.cx(p.x),py=g.horizontal?t.cy(p.x):t.vy(p.y);
  const number=v=>figureDataNumber(v,style),hint=number(p.y)+(p.error!=null?' \u00b1 '+number(p.error):'')+' '+intervalHint(p,(value,key)=>key[0]==='x'&&f.x.kind!=='number'?value:number(value));
  yield '<g class="figure-observation" data-point-id="'+point.id+'"><title>';
  yield* escaped(reader,f.x.kind==='category'?p.x:figureCoordinateNumber(f,'x',p.x),selection('points',point.id,'x',plotId));yield ' \u2192 '+esc(hint)+'</title>';
  const title='';
  if(bars){
   const extent=g.horizontal?g.plotH:g.plotW,gap=f.x.kind==='category'?1/Math.max(1,g.domains.categoryCount):f.x.scale==='log'?g.domains.minimumLogXGap/(Math.log(g.x.max)-Math.log(g.x.min)):g.domains.minimumXGap/(g.x.max-g.x.min);
   const slot=Number.isFinite(gap)&&gap>0?extent*gap:extent/2,barW=Math.max(1,Math.min(80,slot*.75/Math.max(1,g.domains.visibleSeriesCount))),offset=barW*(index-(g.domains.visibleSeriesCount-1)/2);
   if(g.horizontal)py+=offset;else px+=offset;
   yield g.horizontal?'<rect class="figure-bar" x="'+n(Math.min(px,t.vx(base)))+'" y="'+n(py-barW*.46)+'" width="'+n(Math.abs(px-t.vx(base)))+'" height="'+n(barW*.92)+'">'+title+'</rect>':'<rect class="figure-bar" x="'+n(px-barW*.46)+'" y="'+n(Math.min(py,t.vy(base)))+'" width="'+n(barW*.92)+'" height="'+n(Math.abs(py-t.vy(base)))+'">'+title+'</rect>';
  }else if(f.markerArea)yield areaMarker({area:p.count*f.markerArea.unitArea,x:px,y:py,shape:line.marker,color,hint:'',esc,numeric:n});
  else if(line.marker!=='none'||f.kind==='scatter'){
   const r=line.radius;
   if(line.marker==='square')yield '<rect x="'+n(px-r)+'" y="'+n(py-r)+'" width="'+(r*2)+'" height="'+(r*2)+'" stroke="'+style.background+'">'+title+'</rect>';
   else if(line.marker==='diamond')yield '<path d="M'+n(px)+','+n(py-r*1.3)+' l'+r*1.3+','+r*1.3+' l'+(-r*1.3)+','+r*1.3+' l'+(-r*1.3)+','+(-r*1.3)+' Z" stroke="'+style.background+'">'+title+'</path>';
   else yield '<circle cx="'+n(px)+'" cy="'+n(py)+'" r="'+r+'" stroke="'+style.background+'" stroke-width="1">'+title+'</circle>';
  }
  yield renderIntervals(p,{px,py,horizontal:g.horizontal,...t,numeric:n});yield '</g>';
 }
 yield '</g>';
}
async function* annotations(reader,g,part){
 for await(const row of items(reader,'annotations',g.plotId,g.signal)){
  const f=await annotationFigure(reader,g,row),a=f.annotations[0],point=a.kind==='callout'?f.series[0].points[a.pointIndex]:{x:a.start??a.xLower,y:a.yLower};
  const t=a.kind==='callout'?await pointTransforms(reader,g,point):transforms(g,0);
  const drawing=renderAnnotations(f,{...g,...t,esc});
  yield '<g data-annotation-id="'+row.id+'"><title>';yield* escaped(reader,row.value.label,selection('annotations',row.id,'label',g.plotId));yield '</title>';
  yield drawing[part].replace(/(class="figure-observation-key-marker"[^>]*>)1(<\/text>)/g,(_,before,after)=>before+(row.position+1)+after);yield '</g>';
 }
}
async function* annotationKey(reader,g){
 if(g.style.annotationLabels==='hidden')return;
 let y=g.height+g.style.fontSize+8;
 for await(const row of items(reader,'annotations',g.plotId,g.signal)){
  const a=row.value;yield '<g class="figure-annotation-key-item" data-annotation-id="'+row.id+'">';
  yield* figureSVGText(reader,String(row.position+1)+'.',null,20,y,{size:g.style.fontSize,width:36});
  yield* figureSVGText(reader,a.label,selection('annotations',row.id,'label',g.plotId),56,y,{size:g.style.fontSize,width:g.width-76});
  y+=await figureTextHeight(reader,a.label,selection('annotations',row.id,'label',g.plotId),g.width-76,g.style.fontSize)+8;
  for(const detail of await annotationDetails(reader,g,row)){
   yield* figureSVGText(reader,detail.value,detail.selection,56,y,{size:g.style.fontSize,width:g.width-76});
   y+=await figureTextHeight(reader,detail.value,detail.selection,g.width-76,g.style.fontSize)+8;
  }
  y+=8;yield '</g>';
 }
}
async function* footer(reader,g){
 let y=g.height+g.keyHeight+g.style.fontSize+8;
 if(g.f.markerArea){
  yield* figureSVGText(reader,g.f.markerArea.label,headerText(g.f,'markerArea.label'),20,y,{width:g.width-40,size:g.style.fontSize});
  y+=await figureTextHeight(reader,g.f.markerArea.label,headerText(g.f,'markerArea.label'),g.width-40,g.style.fontSize);
  yield* figureSVGText(reader,g.markerRule,null,20,y,{width:g.width-40,size:g.style.fontSize});y+=await figureTextHeight(reader,g.markerRule,null,g.width-40,g.style.fontSize)+12;
  for(const count of g.markerSamples){const area=count*g.f.markerArea.unitArea,r=Math.sqrt(area/Math.PI);yield areaMarker({area,x:g.width/2,y:y+r,color:'#667085',hint:figureDataNumber(count,g.style),esc,cls:'figure-count-example'});y+=2*r+g.style.fontSize+8;yield* figureSVGText(reader,figureDataNumber(count,g.style),null,g.width/2,y,{width:g.width-40,size:g.style.fontSize,anchor:'middle'});y+=g.style.fontSize+8;}
  yield* figureSVGText(reader,markerMessages.zero,null,20,y,{width:g.width-40,size:g.style.fontSize,cls:'figure-zero-count'});y+=await figureTextHeight(reader,markerMessages.zero,null,g.width-40,g.style.fontSize)+20;
 }
 for(const line of g.footerLines){yield* figureSVGText(reader,line,null,20,y,{width:g.width-40,size:g.style.fontSize,cls:'figure-projection-description'});y+=await figureTextHeight(reader,line,null,g.width-40,g.style.fontSize)+8;}
}
async function* renderPlot(reader,g){
 yield '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+n(g.width)+' '+n(g.total)+'" width="'+n(g.width)+'" height="'+n(g.total)+'" role="img"><title>';
 yield* escaped(reader,g.f.title,headerText(g.f,'title'));yield '</title><desc>'+esc(figureNumeralHelp(g.style))+'</desc><rect width="100%" height="100%" fill="'+g.style.background+'"/><g font-family="'+FONT_FAMILIES[g.style.font]+'" fill="'+g.style.textColor+'">';
 if(g.style.showTitle)yield* figureSVGText(reader,g.f.title,headerText(g.f,'title'),g.width/2,g.style.titleSize+8,{width:g.width-40,size:g.style.titleSize,anchor:'middle',weight:'600',cls:'figure-title'});
 yield '<defs><clipPath id="'+g.clip+'"><rect x="'+g.left+'" y="'+g.top+'" width="'+g.plotW+'" height="'+g.plotH+'"/></clipPath></defs>';
 yield* axes(reader,g);yield* annotations(reader,g,'background');let visible=0;
 for await(const row of items(reader,'series',g.plotId,g.signal))if(seriesStyle(row.value).visible)yield* seriesGraphic(reader,g,row,row.visiblePosition??visible++);
 yield* annotations(reader,g,'foreground');
 for await(const entry of legends(reader,g)){
  const x=g.legendPosition==='right'?g.width-g.legendWidth:20+entry.x,y=(g.legendPosition==='top'?g.titleHeight+g.style.legendSize+16:g.legendPosition==='bottom'?g.bottomLegendY:g.top+g.style.legendSize)+entry.y;
  yield '<g opacity="'+(seriesStyle(entry.item.value).visible?1:.4)+'"><circle cx="'+(x+4)+'" cy="'+(y-4)+'" r="4" fill="'+entry.item.value.color+'"/>';
  yield* figureSVGText(reader,entry.item.value.name,selection('series',entry.item.id,'name',g.plotId),x+16,y,{width:entry.cellWidth-26,size:g.style.legendSize,cls:'figure-legend-label'});yield '</g>';
 }
 yield* annotationKey(reader,g);yield* footer(reader,g);yield '</g></svg>';
}
async function* escaped(reader,value,sel){for await(const text of figureTextChunks(reader,value,sel))yield esc(text);}

const foreground=color=>{const c=color.slice(1).match(/../g).map(v=>{const n=parseInt(v,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722>.179?'#000000':'#ffffff';};
async function heatmapLayout(reader,g){
 const {style,f,domains}=g;
 g.left=Math.min(g.width*.35,Math.max(90,domains.maximumSeriesNameLength*style.fontSize*.85+16));
 g.cellW=Math.max(50,(g.width-g.left-24)/Math.max(1,domains.categoryCount));g.width=Math.max(g.width,g.left+g.cellW*domains.categoryCount+24);
 let columnsHeight=style.fontSize,rowsHeight=style.fontSize;
 for await(const c of items(reader,'categories',g.plotId,g.signal))columnsHeight=Math.max(columnsHeight,await figureTextHeight(reader,c.value,selection('categories',c.id,'value',g.plotId),g.cellW-8,style.fontSize));
 for await(const r of items(reader,'series',g.plotId,g.signal))if(seriesStyle(r.value).visible)rowsHeight=Math.max(rowsHeight,await figureTextHeight(reader,r.value.name,selection('series',r.id,'name',g.plotId),g.left-24,style.fontSize));
 g.titleHeight=style.showTitle?await figureTextHeight(reader,f.title,headerText(f,'title'),g.width-40,style.titleSize):0;
 g.columnsHeight=columnsHeight;g.top=28+g.titleHeight+style.fontSize*3+columnsHeight;g.cellH=Math.max(38,rowsHeight+style.fontSize);
 g.height=g.top+domains.visibleSeriesCount*g.cellH;let keys=style.fontSize*6;
 for(let i=0;i<f.heatmap.thresholds.length;i++)keys+=await figureTextHeight(reader,f.heatmap.thresholds[i].label,headerText(f,'heatmap.thresholds.'+i+'.label'),g.width-g.left-36,style.fontSize)+style.fontSize*3;
 g.total=g.height+keys+g.footerHeight;n(g.total);g.keysHeight=keys;return g;
}
async function* heatmap(reader,g){
 const {style,f,plotId}=g,settings=f.heatmap;
 yield '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+n(g.width)+' '+n(g.total)+'" width="'+n(g.width)+'" height="'+n(g.total)+'" role="img"><title>';yield* escaped(reader,f.title,headerText(f,'title'));
 yield '</title><desc>'+esc(heatmapMessages.help+' '+figureNumeralHelp(style))+'</desc><rect width="100%" height="100%" fill="'+style.background+'"/><g font-family="'+FONT_FAMILIES[style.font]+'" fill="'+style.textColor+'">';
 if(style.showTitle)yield* figureSVGText(reader,f.title,headerText(f,'title'),g.width/2,style.titleSize+8,{width:g.width-40,size:style.titleSize,anchor:'middle',weight:'600'});
 yield* figureSVGText(reader,f.x.label,headerText(f,'x.label'),g.left+g.cellW*g.domains.categoryCount/2,g.top-g.columnsHeight-style.fontSize*1.5,{width:g.width-g.left-24,size:style.fontSize,anchor:'middle'});
 yield* figureSVGText(reader,f.y.label,headerText(f,'y.label'),8,g.top-style.fontSize*.5,{width:g.left-16,size:style.fontSize});
 for await(const c of items(reader,'categories',plotId,g.signal))yield* figureSVGText(reader,c.value,selection('categories',c.id,'value',plotId),g.left+((c.windowPosition??c.position)+.5)*g.cellW,g.top-g.columnsHeight,{width:g.cellW-8,size:style.fontSize,anchor:'middle'});
 let rowIndex=0;
 for await(const r of items(reader,'series',plotId,g.signal)){
  if(!seriesStyle(r.value).visible)continue;
  yield* figureSVGText(reader,r.value.name,selection('series',r.id,'name',plotId),g.left-12,g.top+rowIndex*g.cellH+style.fontSize*1.5,{width:g.left-24,size:style.fontSize,anchor:'end'});
  for await(const c of items(reader,'categories',plotId,g.signal)){
   const member=await reader.pointAtCategory({plotId,seriesId:r.id,categoryId:c.id}),value=member?.value.y??null,band=value===null?null:heatmapBand(value,settings),fill=band?.color??settings.missingColor,x=g.left+(c.windowPosition??c.position)*g.cellW,y=g.top+rowIndex*g.cellH,label=value===null?'\u2014':figureDataNumber(value,style);
   yield '<g class="figure-heatmap-cell" data-series-id="'+r.id+'" data-column="'+c.position+'" data-value="'+(value??'')+'"><title>';
   yield* escaped(reader,r.value.name,selection('series',r.id,'name',plotId));yield ' / ';yield* escaped(reader,c.value,selection('categories',c.id,'value',plotId));yield ': '+esc(label)+'</title><rect x="'+n(x)+'" y="'+n(y)+'" width="'+n(g.cellW)+'" height="'+n(g.cellH)+'" fill="'+fill+'" stroke="'+style.background+'"/>';
   if(settings.showValues)yield* figureSVGText(reader,label,null,x+g.cellW/2,y+g.cellH*.62,{width:g.cellW-8,size:Math.min(style.fontSize,(g.cellW-8)/Math.max(1,label.length)*1.5),anchor:'middle',fill:foreground(fill)});
   yield '</g>';
  }
  rowIndex++;
 }
 let y=g.height+style.fontSize*2.5;
 yield* figureSVGText(reader,retainedFigureText(settings.valueLabel)?settings.valueLabel:projectionAxisLabel(f,'y')||heatmapMessages.value,headerText(f,'heatmap.valueLabel'),g.left,y,{width:g.width-g.left-24,size:style.fontSize});y+=style.fontSize*2;
 for(let i=0;i<settings.thresholds.length;i++){
  const b=settings.thresholds[i];yield '<rect x="'+g.left+'" y="'+(y-style.fontSize)+'" width="18" height="'+style.fontSize+'" fill="'+b.color+'"/>';
  yield* figureSVGText(reader,b.label,headerText(f,'heatmap.thresholds.'+i+'.label'),g.left+28,y,{width:g.width-g.left-36,size:style.fontSize});
  y+=await figureTextHeight(reader,b.label,headerText(f,'heatmap.thresholds.'+i+'.label'),g.width-g.left-36,style.fontSize);
  yield* figureSVGText(reader,heatmapThresholdText(settings,i,v=>figureDataNumber(v,style)),null,g.left+28,y,{width:g.width-g.left-36,size:style.fontSize});y+=style.fontSize*3;
 }
 yield '<rect x="'+g.left+'" y="'+(y-style.fontSize)+'" width="18" height="'+style.fontSize+'" fill="'+settings.missingColor+'"/>';
 yield* figureSVGText(reader,heatmapMessages.missing,null,g.left+28,y,{width:g.width-g.left-36,size:style.fontSize});
 yield* footer(reader,{...g,height:g.height+g.keysHeight,keyHeight:0});yield '</g></svg>';
}
async function layout(reader,options){const g=await plotLayout(reader,options);return g.f.kind==='heatmap'?heatmapLayout(reader,g):g;}
async function* panelRows(reader,header,options,shared){
 const width=Math.max(320,options.width??1000),columns=Math.max(1,Math.min(header.layout.columns,Math.floor(width/360))),gap=16,panelWidth=(width-gap*(columns-1))/columns;
 let row=[];
 for await(const item of reader.items({collection:'panels'})){
  check(options.signal);const g=await layout(reader,{...options,plotId:item.value.plotId,width:panelWidth,shared,idPrefix:(options.idPrefix??'retained')+'-'+item.id});
  const labelHeight=await figureTextHeight(reader,item.value.label,selection('panels',item.id,'label'),g.width-16,14)+12;
  row.push({item,g,labelHeight});if(row.length===columns){yield row;row=[];}
 }
 if(row.length)yield row;
}
async function* composition(reader,header,options){
 const shared={};
 if(header.layout.linkX||header.layout.linkY)for await(const item of reader.items({collection:'panels'})){
  const opened=await reader.header({plotId:item.value.plotId}),f=opened.header;
  for(const axis of ['x','y'])if(header.layout[axis==='x'?'linkX':'linkY']){
   const range=figureDomain(summaryValue(opened.domains[axis],f[axis].scale==='log'),f[axis],axis==='y'&&['bar','bar-horizontal','area'].includes(f.kind));
   shared[axis]=shared[axis]?{min:Math.min(shared[axis].min,range.min),max:Math.max(shared[axis].max,range.max)}:range;
  }
 }
 const width=Math.max(320,options.width??1000),columns=Math.max(1,Math.min(header.layout.columns,Math.floor(width/360))),cellWidth=(width-16*(columns-1))/columns,titleHeight=await figureTextHeight(reader,header.title,headerText(header,'title'),width-40,22)+24;
 let total=titleHeight;
 for await(const row of panelRows(reader,header,options,shared))total+=Math.max(...row.map(p=>p.g.total*Math.min(1,cellWidth/p.g.width)+p.labelHeight))+16;
 yield '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+n(total)+'" width="'+width+'" height="'+n(total)+'" role="img"><title>';yield* escaped(reader,header.title,headerText(header,'title'));yield '</title>';
 yield* figureSVGText(reader,header.title,headerText(header,'title'),width/2,26,{width:width-40,size:22,anchor:'middle',weight:'600'});
 let y=titleHeight;
 for await(const row of panelRows(reader,header,options,shared)){
  const columns=Math.max(1,Math.min(header.layout.columns,Math.floor(width/360))),cellW=(width-16*(columns-1))/columns;let height=0;
  for(let col=0;col<row.length;col++){
   const p=row[col],scale=Math.min(1,cellW/p.g.width);height=Math.max(height,p.g.total*scale+p.labelHeight);
   yield '<g class="figure-panel" data-panel-id="'+p.item.id+'" transform="translate('+(col*(cellW+16))+' '+n(y)+')">';
   yield* figureSVGText(reader,p.item.value.label,selection('panels',p.item.id,'label'),8,16,{width:cellW-16,size:14,weight:'600'});
   yield '<g transform="translate(0 '+n(p.labelHeight)+') scale('+scale+')">';yield* (p.g.f.kind==='heatmap'?heatmap(reader,p.g):renderPlot(reader,p.g));yield '</g></g>';
  }
  y+=height+16;
 }
 yield '</svg>';
}
export async function* retainedFigureSVG(reader,options={}){
 if(options.window){reader=await retainedFigureWindow(reader,options.window,options);options={...options,plotId:options.window.plotId};}
 const {header}=await reader.header();check(options.signal);
 if(header.kind==='panels'){yield* composition(reader,header,options);return;}
 const g=await layout(reader,options);yield* (header.kind==='heatmap'?heatmap(reader,g):renderPlot(reader,g));
}
