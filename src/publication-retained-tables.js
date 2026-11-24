import {coordinateAlignmentPublicPage,alignmentContextSet} from './coordinate-alignment.js';
import {coordinateAlignmentHeading,coordinateAlignmentContextParts,coordinateAlignmentReceiptParts,publicCoordinateAlignmentContext} from './web/coordinate-alignment-context.js';
import {cusumContextParts,cusumText} from './web/dataset-cusum-context.js';
import {spectrumContextParts,spectrumText} from './web/dataset-spectrum-context.js';
import {coordinateFrameContextText,coordinateFrameAxisPageParts} from './web/coordinate-frame-context.js';
import {statisticalUncertaintyContextText} from './web/statistical-uncertainty-context.js';
import {measurementUnitContextParts} from './web/measurement-unit-context.js';
import {aggregationQuantileContextParts,aggregationPairContextText,aggregationWeightedFitContextParts} from './web/dataset-aggregation-context.js';
import {clockSynchronizationContextParts} from './web/measurement-clock-context.js';
import {computationLabel,cellComputationLabel} from './web/measurement-computation.js';
import {domainDescription} from './web/measurement-domain-ui.js';
import {AppError} from './errors.js';
import {retainedTableBlocks} from './retained-tables.js';
import messages from './web/locales/en/retainedTables.json' with {type:'json'};
import recordText from './web/locales/en/websiteRecordText.json' with {type:'json'};
import measurementText from './web/locales/en/measurements.json' with {type:'json'};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=()=>{throw new AppError('JOB_DAMAGED');};
// Words of a published table are written in English with the message they
// come from, so a website page relabels them in its own language
// (src/website-record-language.js); numbers follow the page's locale there.
const label=(catalogue,key,text)=>'<span data-observanda-label="'+catalogue+':'+key+'">'+esc(text)+'</span>';
const formatted=(catalogue,key,template,args,tag='span')=>'<'+tag+' data-observanda-format="'+catalogue+':'+key+'" data-observanda-args="'+esc(JSON.stringify(args))+'">'+esc(template.replace(/\{(\w+)\}/g,(whole,name)=>Object.hasOwn(args,name)?String(args[name]):whole))+'</'+tag+'>';
export function retainedTableWindowHTML(block,table){
 return formatted('websiteRecordText','tableWindow',recordText.tableWindow,{rowFrom:block.offset+1,rowTo:block.offset+table.rows.length,columnFrom:block.columnOffset+1,columnTo:block.columnOffset+table.headers.length},'p');
}
async function* cellText(materials,value,{signal}){
 if(typeof value==='string'){for(let at=0;at<value.length;at+=4096)yield value.slice(at,at+4096);return;}
 let offset=0;for(;;){const page=await materials.readDatasetCell(value,{offset,limit:4096,signal});yield page.value??page.text;const next=page.next;if(next===null)return;if(!Number.isSafeInteger(next)||next<=offset)fail();offset=next;}
}
export async function* retainedTableHTML(materials,statement,{signal}={}){
 for await(const block of retainedTableBlocks(materials,{ref:statement.source,table:statement.table},{signal})){
  const table=block.table;
  yield '<section class="book-table retained-result-table">'+retainedTableWindowHTML(block,table)+'<div class="book-table-scroll" tabindex="0" role="region" aria-label="'+esc(messages.table)+'" data-observanda-aria="retainedTables:table"><table><thead><tr>';
  for(let i=0;i<table.headers.length;i++){
   const format=table.formats[i],uncertainty=format.uncertainty;yield '<th scope="col">'+esc(table.headers[i]+(computationLabel(format)?' ['+computationLabel(format)+']':'')+(format.domain?' ('+domainDescription(format.domain)+')':''));
   if(uncertainty){yield ' ['+label('measurements','intervalMethod',measurementText.intervalMethod)+esc(': '+uncertainty.method.name+'; ')+label('measurements','intervalMethodVersion',measurementText.intervalMethodVersion)+esc(' '+uncertainty.method.version)+(uncertainty.method.reference?esc('; ')+label('measurements','intervalMethodReference',measurementText.intervalMethodReference)+esc(' '+uncertainty.method.reference.revision):'');
    if(uncertainty.coverage){const level=uncertainty.coverage.level;yield esc('; '+uncertainty.coverage.kind+' ');for await(const text of cellText(materials,level.spelling,{signal}))yield esc(text);yield esc(' ('+level.representation+' ')+formatted('retainedTables','base',messages.base,{radix:String(level.radix)})+')';}else yield esc('; ')+label('measurements','intervalNoCoverage',measurementText.intervalNoCoverage);yield ']';
   }
   if(format.coordinateAlignment){for(let offset=0;offset<format.coordinateAlignment.contextsIndex.count;offset+=16){const page=await alignmentContextSet(materials).page(format.coordinateAlignment.contextsIndex,{offset,limit:16});for(const context of page.items){yield '<details><summary>'+esc(coordinateAlignmentHeading)+'</summary><p>';for(const part of coordinateAlignmentContextParts(publicCoordinateAlignmentContext(context))){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}}}
   if(format.quantile){yield ' [';for(const part of aggregationQuantileContextParts(format.quantile)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(format.unitDefinition){yield ' [';for(const part of measurementUnitContextParts(format.unitDefinition)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(format.coordinateFrame)yield esc(' ['+coordinateFrameContextText(format.coordinateFrame)+']');
   if(format.weightedFit){yield ' [';for(const part of aggregationWeightedFitContextParts(format.weightedFit)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(format.pairedStatistic)yield esc(' ['+aggregationPairContextText(format.pairedStatistic)+']');
   if(format.spectrum){yield '<details class="retained-spectrum-context"><summary>'+esc(spectrumText('methodDetails'))+'</summary><p>';for(const part of spectrumContextParts(format.spectrum)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}
   if(format.cusum){yield '<details class="retained-cusum-context"><summary>'+esc(cusumText('methodDetails'))+'</summary><p>';for(const part of cusumContextParts(format.cusum)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}
   if(format.statisticalUncertainty)yield esc(' ['+statisticalUncertaintyContextText(format.statisticalUncertainty)+']');
   if(format.synchronization){yield ' [';for(const part of clockSynchronizationContextParts(format.synchronization)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(['radix','radix-fraction'].includes(format.representation))yield ' ('+formatted('retainedTables','base',messages.base,{radix:String(format.radix)})+')';yield '</th>';
  }
  if(table.selection.includeExcluded)yield '<th scope="col">'+label('retainedTables','exclusion',messages.exclusion)+'</th>';yield '</tr></thead><tbody>';
  for(const row of table.rows){
   signal?.throwIfAborted();yield '<tr>';
   for(let i=0;i<row.cells.length;i++){yield '<td>';if(row.presence[i]!=='value')yield label('retainedTables',row.presence[i],messages[row.presence[i]]);else for await(const text of cellText(materials,row.cells[i],{signal}))yield esc(text);const computation=row.presence[i]==='value'?cellComputationLabel(table.formats[i],{computation:row.computations[i]}):'';if(row.presence[i]==='value'&&computation)yield '<small class="cell-computation">'+esc(computation)+'</small>';if(table.formats[i].coordinateAlignment){const marker=row.alignments[i];for(let offset=0;offset<marker.decisionsIndex.count;offset+=16){const page=await coordinateAlignmentPublicPage(materials,marker,{column:table.formats[i].coordinateAlignment,offset,signal});for(const item of page.items){yield '<small class="coordinate-selection">';for(const part of coordinateAlignmentReceiptParts(item.receipt,item.context)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</small>';}}}yield '</td>';}
   if(table.selection.includeExcluded)yield '<td>'+esc(row.exclusion??'')+'</td>';yield '</tr>';
  }
  yield '</tbody></table></div>';
  for(let i=0;i<table.formats.length;i++){
   const format=table.formats[i],context=format.coordinateFrame,axes=format.coordinateFrameAxes;if(!context&&!axes)continue;
   if(!context||!axes||axes.kind!=='coordinate-frame-axes'||axes.count!==context.dimension||!coordinateFrameContextText(context))fail();
   // The retained column owns these axes. Publication never follows private
   // frame/model documents to reconstruct the meaning of a selected result.
   yield '<details class="retained-coordinate-axes"><summary>'+esc(table.headers[i]+' ['+coordinateFrameContextText(context)+']')+'</summary>';
   for(let offset=0;offset<axes.count;offset+=16){
    signal?.throwIfAborted();const page=await materials.sequences.page(axes,{offset,limit:16});
    if(page.items.length!==Math.min(16,axes.count-offset))fail();
    const parts=coordinateFrameAxisPageParts({...context,axes:{offset,total:axes.count,items:page.items.map(axis=>({name:axis.name}))}});if(parts.length!==page.items.length+1)fail();
    yield '<p>'+esc(parts[0])+'</p><ol start="'+(offset+1)+'">';for(const part of parts.slice(1))yield '<li>'+esc(part)+'</li>';yield '</ol>';
   }
   yield '</details>';
  }
  yield '</section>';
 }
}
