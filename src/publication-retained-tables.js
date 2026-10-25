import {coordinateAlignmentPublicPage,alignmentContextSet} from './coordinate-alignment.js';
import {coordinateAlignmentHeading,coordinateAlignmentContextParts,coordinateAlignmentReceiptParts,publicCoordinateAlignmentContext} from './web/coordinate-alignment-context.js';
import {cusumContextParts,cusumText} from './web/dataset-cusum-context.js';
import {spectrumContextParts,spectrumText} from './web/dataset-spectrum-context.js';
import {coordinateFrameContextText,coordinateFrameAxisPageParts} from './web/coordinate-frame-context.js';
import {statisticalUncertaintyContextText} from './web/statistical-uncertainty-context.js';
import {measurementUnitContextParts} from './web/measurement-unit-context.js';
import {aggregationQuantileContextParts,aggregationPairContextText} from './web/dataset-aggregation-context.js';
import {clockSynchronizationContextParts} from './web/measurement-clock-context.js';
import {computationLabel,cellComputationLabel} from './web/measurement-computation.js';
import {domainDescription} from './web/measurement-domain-ui.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {retainedTableBlocks} from './retained-tables.js';
import {researchId} from './web/research-reference.js';
import messages from './web/locales/en/retainedTables.json' with {type:'json'};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const key=(recordId,resultId)=>recordId+'/'+resultId+'/';
export const retainedTableQueryHash=statement=>digest(serialize({source:statement.source,table:statement.table}));
async function* cellText(materials,value,{signal}){
 if(typeof value==='string'){for(let at=0;at<value.length;at+=4096)yield value.slice(at,at+4096);return;}
 let offset=0;for(;;){const page=await materials.readDatasetCell(value,{offset,limit:4096,signal});yield page.value??page.text;const next=page.next;if(next===null)return;if(!Number.isSafeInteger(next)||next<=offset)fail();offset=next;}
}
export async function* retainedTableHTML(materials,statement,{signal}={}){
 for await(const block of retainedTableBlocks(materials,{ref:statement.source,table:statement.table},{signal})){
  const table=block.table;
  yield '<section class="book-table retained-result-table"><p>'+esc('Rows '+(block.offset+1)+'-'+(block.offset+table.rows.length)+'; columns '+(block.columnOffset+1)+'-'+(block.columnOffset+table.headers.length))+'</p><div class="book-table-scroll" tabindex="0" role="region" aria-label="'+esc(messages.table)+'"><table><thead><tr>';
  for(let i=0;i<table.headers.length;i++){
   const format=table.formats[i],uncertainty=format.uncertainty;yield '<th scope="col">'+esc(table.headers[i]+(computationLabel(format)?' ['+computationLabel(format)+']':'')+(format.domain?' ('+domainDescription(format.domain)+')':''));
   if(uncertainty){yield esc(' [Interval method: '+uncertainty.method.name+'; version '+uncertainty.method.version+(uncertainty.method.reference?'; reference '+uncertainty.method.reference.revision:''));
    if(uncertainty.coverage){const level=uncertainty.coverage.level;yield esc('; '+uncertainty.coverage.kind+' ');for await(const text of cellText(materials,level.spelling,{signal}))yield esc(text);yield esc(' ('+level.representation+' base '+level.radix+')');}else yield esc('; no statistical coverage declared');yield ']';
   }
   if(format.coordinateAlignment){for(let offset=0;offset<format.coordinateAlignment.contextsIndex.count;offset+=16){const page=await alignmentContextSet(materials).page(format.coordinateAlignment.contextsIndex,{offset,limit:16});for(const context of page.items){yield '<details><summary>'+esc(coordinateAlignmentHeading)+'</summary><p>';for(const part of coordinateAlignmentContextParts(publicCoordinateAlignmentContext(context))){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}}}
   if(format.quantile){yield ' [';for(const part of aggregationQuantileContextParts(format.quantile)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(format.unitDefinition){yield ' [';for(const part of measurementUnitContextParts(format.unitDefinition)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(format.coordinateFrame)yield esc(' ['+coordinateFrameContextText(format.coordinateFrame)+']');
   if(format.pairedStatistic)yield esc(' ['+aggregationPairContextText(format.pairedStatistic)+']');
   if(format.spectrum){yield '<details class="retained-spectrum-context"><summary>'+esc(spectrumText('methodDetails'))+'</summary><p>';for(const part of spectrumContextParts(format.spectrum)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}
   if(format.cusum){yield '<details class="retained-cusum-context"><summary>'+esc(cusumText('methodDetails'))+'</summary><p>';for(const part of cusumContextParts(format.cusum)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</p></details>';}
   if(format.statisticalUncertainty)yield esc(' ['+statisticalUncertaintyContextText(format.statisticalUncertainty)+']');
   if(format.synchronization){yield ' [';for(const part of clockSynchronizationContextParts(format.synchronization)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield ']';}
   if(['radix','radix-fraction'].includes(format.representation))yield esc(' ('+messages.base.replace('{radix}',format.radix)+')');yield '</th>';
  }
  if(table.selection.includeExcluded)yield '<th scope="col">'+esc(messages.exclusion)+'</th>';yield '</tr></thead><tbody>';
  for(const row of table.rows){
   signal?.throwIfAborted();yield '<tr>';
   for(let i=0;i<row.cells.length;i++){yield '<td>';if(row.presence[i]!=='value')yield esc(messages[row.presence[i]]);else for await(const text of cellText(materials,row.cells[i],{signal}))yield esc(text);const computation=row.presence[i]==='value'?cellComputationLabel(table.formats[i],{computation:row.computations[i]}):'';if(row.presence[i]==='value'&&computation)yield '<small class="cell-computation">'+esc(computation)+'</small>';if(table.formats[i].coordinateAlignment){const marker=row.alignments[i];for(let offset=0;offset<marker.decisionsIndex.count;offset+=16){const page=await coordinateAlignmentPublicPage(materials,marker,{column:table.formats[i].coordinateAlignment,offset,signal});for(const item of page.items){yield '<small class="coordinate-selection">';for(const part of coordinateAlignmentReceiptParts(item.receipt,item.context)){if(typeof part==='string')yield esc(part);else for await(const text of cellText(materials,part.spelling,{signal}))yield esc(text);}yield '</small>';}}}yield '</td>';}
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
export async function retainPublicationTables(builder,materials,record,recordId,{signal}={}){
 for(const statement of record.results?.statements??[]){
  if(statement.table?.version!==3)continue;
  const prefix=key(recordId,statement.id),queryHash=retainedTableQueryHash(statement),checksum=createHash('sha256');let count=0,pending='';
  const append=async text=>{checksum.update(text);await builder.append('retainedTables',prefix+String(count).padStart(16,'0'),{recordId,resultId:statement.id,ordinal:count++,text},{indexes:{result:prefix}});};
  for await(const chunk of retainedTableHTML(materials,statement,{signal})){
   if(typeof chunk!=='string')fail();pending+=chunk;
   while(pending.length>=4096){let end=4096;if(/[\uD800-\uDBFF]/.test(pending[end-1]))end--;await append(pending.slice(0,end));pending=pending.slice(end);}
  }
  if(pending)await append(pending);
  await builder.append('retainedTables',prefix+'summary',{recordId,resultId:statement.id,queryHash,count,sha256:checksum.digest('hex')},{indexes:{result:prefix}});
 }
}
export function validRetainedTableChunk(identifier,value){
 if(!value||!researchId(value.recordId)||!researchId(value.resultId))return false;const prefix=key(value.recordId,value.resultId);
 return identifier===prefix+'summary'?Object.keys(value).sort().join()==='count,queryHash,recordId,resultId,sha256'&&natural(value.count)&&hash(value.queryHash)&&hash(value.sha256):Object.keys(value).sort().join()==='ordinal,recordId,resultId,text'&&natural(value.ordinal)&&identifier===prefix+String(value.ordinal).padStart(16,'0')&&typeof value.text==='string'&&value.text.length<=4096;
}
// Every chunk must belong to a selected statement, even when no record asks
// the renderer to consume it. Validate each summary once and point-check chunks.
export async function verifyRetainedTableEntry(input,identifier,value,{signal}={}){
 if(!validRetainedTableChunk(identifier,value))fail();
 const prefix=key(value.recordId,value.resultId);
 if(identifier===prefix+'summary'){
  if(!await input.document.get('records',value.recordId,{signal}))fail();
  const record=await input.record(value.recordId),statement=record.results?.statements.find(item=>item.id===value.resultId);
  if(statement?.table?.version!==3||retainedTableQueryHash(statement)!==value.queryHash)fail();
 }else{
  const summary=await input.document.get('retainedTables',prefix+'summary',{signal});
  if(!validRetainedTableChunk(prefix+'summary',summary)||value.ordinal>=summary.count)fail();
 }
}
export async function* publicationTableChunks(input,recordId,statement,{signal}={}){
 if(!input.native||!input.document.collectionNames().includes('retainedTables'))fail();
 const prefix=key(recordId,statement.id),summary=await input.document.get('retainedTables',prefix+'summary',{signal});
 if(!validRetainedTableChunk(prefix+'summary',summary)||summary.queryHash!==retainedTableQueryHash(statement))fail();
 const checksum=createHash('sha256');let count=0,seenSummary=false;
 for await(const {key:identifier,value} of input.document.items('retainedTables',{index:'result',prefix,signal})){
  if(!validRetainedTableChunk(identifier,value))fail();if(identifier.endsWith('/summary')){seenSummary=true;continue;}
  if(value.ordinal!==count++)fail();checksum.update(value.text);yield value.text;
 }
 if(!seenSummary||count!==summary.count||checksum.digest('hex')!==summary.sha256)fail();
}
export async function verifyPublicationTables(input,record,{signal}={}){
 for(const statement of record.results?.statements??[])if(statement.table?.version===3)for await(const chunk of publicationTableChunks(input,record.id,statement,{signal}))void chunk;
}
