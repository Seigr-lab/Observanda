// Complete exports traverse authenticated retained collections to exhaustion.
// Labels are streamed independently: a short preview is never exported as data.
import {computationLabel} from './measurement-computation.js';
import {figureTextChunks,retainedFigureText,composeFigureText,escapeFigureText as esc} from './retained-figure-text.js';
import {retainedProjectionLines} from './retained-figure-projection.js';
import {figureStyle} from './figure-style.js';
import {figureDataNumber} from './figure-number-labels.js';
import {figureNumeralHelp} from './figure-radix-labels.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
import {heatmapThresholdText} from './figure-heatmap.js';
import projectionMessages from './locales/en/measurementTransform.json' with {type:'json'};
import messages from './locales/en/retainedFigureData.json' with {type:'json'};
const check=signal=>signal?.throwIfAborted();
const at=(selection,field)=>({...selection,field});
const headerSelection=header=>({collection:'header',id:header.id,...(header.plotId?{plotId:header.plotId}:{})});
const itemSelection=(collection,row)=>({collection,id:row.id,...(row.plotId?{plotId:row.plotId}:{}),...(row.seriesId?{seriesId:row.seriesId}:{})});
async function* text(reader,value,selection,signal){for await(const chunk of figureTextChunks(reader,value,selection)){check(signal);yield chunk;}check(signal);}
async function* htmlText(reader,value,selection,signal){for await(const chunk of text(reader,value,selection,signal))yield esc(chunk);}
// Metadata objects are bounded scalar documents. Collections are handled only
// by the outer iterators, never recursively collected into these JSON cells.
async function* jsonValue(reader,value,selection,signal,path=''){
 check(signal);
 if(typeof value==='string'||retainedFigureText(value)){yield '"';for await(const chunk of text(reader,value,at(selection,path),signal))yield JSON.stringify(chunk).slice(1,-1);yield '"';return;}
 if(value===null||typeof value==='number'||typeof value==='boolean'){yield JSON.stringify(value);return;}
 if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield* jsonValue(reader,value[i],selection,signal,path?path+'.'+i:String(i));}yield ']';return;}
 if(!value||typeof value!=='object')throw Error('Invalid retained figure metadata');
 yield '{';let first=true;for(const key of Object.keys(value)){if(value[key]===undefined)continue;if(!first)yield ',';first=false;yield JSON.stringify(key)+':';yield* jsonValue(reader,value[key],selection,signal,path?path+'.'+key:key);}yield '}';
}
async function* encoded(chunks,escape){for await(const chunk of chunks)yield escape(chunk);}
async function* metadata(reader,value,selection,signal,heading){yield '<details class="figure-retained-settings"><summary>'+esc(heading)+'</summary><pre>';yield* encoded(jsonValue(reader,value,selection,signal),esc);yield '</pre></details>';}
async function* coordinate(reader,plot,value,selection,signal,{missing='',axis=null}={}){
 if(value==null){yield esc(missing);return;}
 if(typeof value==='number'){yield esc(axis==='x'&&plot.x.kind!=='number'?String(value):figureDataNumber(value,figureStyle(plot)));return;}
 yield* htmlText(reader,value,selection,signal);
}
async function* axisLabel(reader,plot,axis,selection,signal){
 const path=axis==='y'&&plot.kind==='heatmap'?'heatmap.valueLabel':axis+'.label',value=axis==='y'&&plot.kind==='heatmap'?plot.heatmap.valueLabel:plot[axis].label;
 const projected=plot.projection?.[axis],parts=projectionMessages.projectedAxis.split('{label}');if(projected)yield esc(parts[0]);
 yield* htmlText(reader,value||messages[axis==='x'?'coordinate':'value'],at(selection,path),signal);if(projected)yield esc(parts[1]);
}
async function* projection(reader,plot,selection,signal){
 const label=computationLabel(plot);if(label)yield '<p class="figure-computation-description">'+esc(label)+'</p>';
 if(!plot.projection)return;
 const axisName=axis=>{
  const field=axis==='y'&&plot.kind==='heatmap'?'heatmap.valueLabel':axis+'.label',value=axis==='y'&&plot.kind==='heatmap'?plot.heatmap.valueLabel:plot[axis].label;
  return composeFigureText(projectionMessages.projectedAxis.split(/(\{label\})/).map(part=>part==='{label}'?{value:value||messages[axis==='x'?'coordinate':'value'],selection:at(selection,field)}:{value:part}));
 };
 yield '<aside class="figure-projection-description"><h4>'+esc(projectionMessages.retained)+'</h4>';
 for(const line of retainedProjectionLines(plot,{axisName,selection:field=>at(selection,field)})){yield '<p>';yield* htmlText(reader,line,null,signal);yield '</p>';}
 yield '<p>'+esc(projectionMessages.coordinateValues)+'</p></aside>';
}
function totals(){return {panels:0,series:0,points:0,annotations:0,ticks:0};}
function complete(actual,expected){for(const key of Object.keys(actual))if(actual[key]!==expected[key])throw Error('Incomplete retained figure collection: '+key);}
async function* annotationPosition(reader,plot,row,signal){
 const a=row.value,s=itemSelection('annotations',row),h=headerSelection(plot);
 const range=async function*(axis,lo,hi){yield* axisLabel(reader,plot,axis,h,signal);yield ': ';yield* coordinate(reader,plot,a[lo],at(s,lo),signal,{axis});if(hi){yield ' \u2013 ';yield* coordinate(reader,plot,a[hi],at(s,hi),signal,{axis});}};
 if(a.kind==='boundary'||a.kind==='interval'){yield* range(a.axis,'start',a.kind==='interval'?'end':null);return;}
 if(a.kind==='region'){yield* range('x','xLower','xUpper');yield '; ';yield* range('y','yLower','yUpper');return;}
 if(a.kind!=='callout')throw Error('Invalid retained figure annotation');
 const series=await reader.item({collection:'series',plotId:row.plotId,id:a.seriesId}),page=await reader.window({collection:'points',plotId:row.plotId,seriesId:a.seriesId,offset:a.pointIndex,limit:1});check(signal);
 const point=page.items[0];if(!series||!point||point.position!==a.pointIndex)throw Error('Missing retained figure observation');
 yield* htmlText(reader,series.value.name,at(itemSelection('series',series),'name'),signal);yield ' \u00b7 '+esc(messages.observation)+' '+String(a.pointIndex+1)+': (';yield* coordinate(reader,plot,point.value.x,at(itemSelection('points',point),'x'),signal,{axis:'x'});yield ', ';yield* coordinate(reader,plot,point.value.y,at(itemSelection('points',point),'y'),signal);yield ')';
}
export async function* retainedFigureTable(reader,{signal}={}){
 check(signal);const root=await reader.header();check(signal);const actual=totals();yield '<div class="figure-retained-data">';yield* metadata(reader,root.header,headerSelection(root.header),signal,messages.figureSettings);if(root.source!==undefined)yield* metadata(reader,root.source,{},signal,messages.source);
 for await(const panel of reader.items({collection:'panels'})){
  check(signal);actual.panels++;const {header:plot}=await reader.header({plotId:panel.plotId}),h=headerSelection(plot);check(signal);
  yield '<section class="figure-panel-data" data-plot-id="'+esc(panel.plotId)+'"><h4>';yield* htmlText(reader,panel.value.label,at(itemSelection('panels',panel),'label'),signal);yield ' \u00b7 ';yield* htmlText(reader,plot.title,at(h,'title'),signal);yield '</h4>';yield* projection(reader,plot,h,signal);yield* metadata(reader,plot,h,signal,messages.plotSettings);
  const style=figureStyle(plot);if(style.numberFormat==='radix')yield '<p>'+esc(figureNumeralHelp(style))+'</p>';
  for await(const series of reader.items({collection:'series',plotId:panel.plotId})){
   check(signal);actual.series++;const s=itemSelection('series',series);yield '<section class="figure-series-data" data-series-id="'+esc(series.id)+'"><h5>';yield* htmlText(reader,series.value.name,at(s,'name'),signal);yield '</h5>';yield* metadata(reader,series.value,s,signal,messages.seriesSettings);
   yield '<table><thead><tr><th scope="col">'+esc(messages.observation)+'</th><th scope="col">';yield* axisLabel(reader,plot,'x',h,signal);yield '</th><th scope="col">';yield* axisLabel(reader,plot,'y',h,signal);yield '</th>'+['uncertainty',...INTERVAL_FIELDS,'count','source'].map(key=>'<th scope="col">'+esc(messages[key])+'</th>').join('')+'</tr></thead><tbody>';
   let points=0;for await(const row of reader.items({collection:'points',plotId:panel.plotId,seriesId:series.id})){
    check(signal);actual.points++;points++;const p=row.value,selection=itemSelection('points',row);yield '<tr data-point-id="'+esc(row.id)+'"><th scope="row">'+String(row.position+1)+'</th>';
    for(const key of ['x','y','error',...INTERVAL_FIELDS,'count']){yield '<td>';yield* coordinate(reader,plot,p[key],at(selection,key),signal,{missing:key==='y'?messages.gap:key==='x'?'':'\u2014',axis:key[0]==='x'?'x':'y'});yield '</td>';}
    yield '<td>';if(p.source!==undefined){yield '<details><summary>'+esc(messages.source)+'</summary><pre>';yield* encoded(jsonValue(reader,p.source,selection,signal,'source'),esc);yield '</pre></details>';}yield '</td></tr>';
   }
   if(points!==series.points)throw Error('Incomplete retained figure series');yield '</tbody></table></section>';
  }
  let annotations=false;const annotationsStart='<table class="figure-annotations-table"><caption>'+esc(messages.annotations)+'</caption><thead><tr>'+['label','kind','position','details'].map(key=>'<th scope="col">'+esc(messages[key])+'</th>').join('')+'</tr></thead><tbody>';
  for await(const row of reader.items({collection:'annotations',plotId:panel.plotId})){check(signal);actual.annotations++;if(!annotations){yield annotationsStart;annotations=true;}const a=row.value,s=itemSelection('annotations',row);yield '<tr data-annotation-id="'+esc(row.id)+'"><th scope="row">';yield* htmlText(reader,a.label,at(s,'label'),signal);yield '</th><td>'+esc(a.kind)+'</td><td>';yield* annotationPosition(reader,plot,row,signal);yield '</td><td>';yield* metadata(reader,a,s,signal,messages.details);yield '</td></tr>';}if(annotations)yield '</tbody></table>';
  let ticks=false;const ticksStart='<table class="figure-axis-settings-table"><caption>'+esc(messages.ticks)+'</caption><thead><tr>'+['axis','direction','value','label'].map(key=>'<th scope="col">'+esc(messages[key])+'</th>').join('')+'</tr></thead><tbody>';
  for await(const row of reader.items({collection:'ticks',plotId:panel.plotId})){check(signal);actual.ticks++;if(!ticks){yield ticksStart;ticks=true;}const tick=row.value,s=itemSelection('ticks',row);yield '<tr data-tick-id="'+esc(row.id)+'"><th scope="row">';yield* axisLabel(reader,plot,tick.axis,h,signal);yield '</th><td>'+esc(messages[plot[tick.axis].reversed?'reversed':'normal'])+'</td><td>';yield* coordinate(reader,plot,tick.value,at(s,'value'),signal,{axis:tick.axis});yield '</td><td>';yield* htmlText(reader,tick.label,at(s,'label'),signal);yield '</td></tr>';}if(ticks)yield '</tbody></table>';
  if(plot.kind==='heatmap'){yield '<table class="figure-thresholds"><caption>'+esc(messages.thresholds)+'</caption><thead><tr>'+['label','value','color'].map(key=>'<th scope="col">'+esc(messages[key])+'</th>').join('')+'</tr></thead><tbody>';for(const [i,threshold] of plot.heatmap.thresholds.entries()){yield '<tr><th scope="row">';yield* htmlText(reader,threshold.label,at(h,'heatmap.thresholds.'+i+'.label'),signal);yield '</th><td>'+esc(heatmapThresholdText(plot.heatmap,i,value=>figureDataNumber(value,style)))+'</td><td>'+esc(threshold.color)+'</td></tr>';}yield '</tbody></table>';}
  yield '</section>';
 }
 complete(actual,root.counts);check(signal);yield '</div>';
}
const cell=(value,selection={},json=false)=>({value,selection,json});
async function* csvRow(reader,cells,signal){
 for(let i=0;i<cells.length;i++){check(signal);if(i)yield ',';yield '"';const entry=cells[i]??cell(null),value=entry.value;
  const chunks=entry.chunks?entry.chunks():entry.json?jsonValue(reader,value,entry.selection,signal):typeof value==='number'||typeof value==='boolean'?[String(value)]:text(reader,value,entry.selection,signal);
  yield* encoded(chunks,chunk=>chunk.replaceAll('"','""'));yield '"';
 }yield '\r\n';
}
async function* rootEncoding(reader,root,signal){yield '{"format":"observanda-retained-figure-csv","version":1,"meaning":"complete retained plot values; source values only when an explicit source receipt is retained","header":';yield* jsonValue(reader,root.header,headerSelection(root.header),signal);yield ',"counts":'+JSON.stringify(root.counts)+',"document":'+JSON.stringify(root.document);if(root.source!==undefined)yield ',"source":'+JSON.stringify(root.source);yield '}';}
export async function* retainedFigureCSV(reader,{signal}={}){
 check(signal);const root=await reader.header();check(signal);const actual=totals(),columns=['dataKind','plotId','seriesId','itemId','position','label','coordinate','value','uncertainty',...INTERVAL_FIELDS,'count','encoding'];
 yield* csvRow(reader,columns.map(key=>cell(messages[key])),signal);
 const row=(kind,plotId,seriesId,id,position,label={},values={},detail=null)=>[cell(kind),cell(plotId),cell(seriesId),cell(id),cell(position),label,cell(values.x,values.selection?at(values.selection,'x'):{}),cell(values.y),cell(values.error),...INTERVAL_FIELDS.map(key=>cell(values[key],values.selection?at(values.selection,key):{})),cell(values.count),detail];
 yield* csvRow(reader,row('figure settings',null,null,root.header.id,null,cell(root.header.title,at(headerSelection(root.header),'title')),{}, {chunks:()=>rootEncoding(reader,root,signal)}),signal);
 for await(const panel of reader.items({collection:'panels'})){
  check(signal);actual.panels++;const {header:plot}=await reader.header({plotId:panel.plotId}),h=headerSelection(plot);check(signal);
  yield* csvRow(reader,row('plot settings',panel.plotId,null,panel.id,panel.position,cell(panel.value.label,at(itemSelection('panels',panel),'label')),{},cell(plot,h,true)),signal);
  for await(const series of reader.items({collection:'series',plotId:panel.plotId})){
   check(signal);actual.series++;const s=itemSelection('series',series);yield* csvRow(reader,row('series settings',panel.plotId,series.id,series.id,series.position,cell(series.value.name,at(s,'name')),{},cell(series.value,s,true)),signal);let points=0;
   for await(const point of reader.items({collection:'points',plotId:panel.plotId,seriesId:series.id})){check(signal);actual.points++;points++;const p=point.value,s=itemSelection('points',point);yield* csvRow(reader,row('measurement',panel.plotId,series.id,point.id,point.position,cell(null),{...p,selection:s},cell(p,s,true)),signal);}if(points!==series.points)throw Error('Incomplete retained figure series');
  }
  for(const collection of ['annotations','ticks'])for await(const item of reader.items({collection,plotId:panel.plotId})){check(signal);actual[collection]++;const s=itemSelection(collection,item);yield* csvRow(reader,row(collection==='ticks'?'tick':item.value.kind,panel.plotId,item.value.seriesId??null,item.id,item.position,cell(item.value.label,at(s,'label')),{},cell(item.value,s,true)),signal);}
 }
 complete(actual,root.counts);check(signal);
}
