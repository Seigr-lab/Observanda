import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {validMaterialReference,materialReference,materialReferenceKey} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {validatedExchangeFrames} from './dataset-exchange-reader.js';
import {retainDatasetCell} from './dataset-cell-storage.js';
import {retainDomainValue} from './measurement-domain-storage.js';
import {withDatasetPreparationWrites} from './dataset-preparation-writes.js';
import {CalculationLineage} from './calculation-lineage.js';
import {alignmentContextSet,alignmentDecisionSet} from './coordinate-alignment.js';
import {DATASET_LIMITS} from './dataset-reader.js';
import {withScratch} from './scratch-work.js';
import {digest} from './storage-format.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const direct=operation=>operation();

export async function validateExchangeImport(materials,command){
 const {id,recordId,title,expectedRevision,artifact}=command;
 const required=['exchangeImport','artifact','recordId','title'];
 if(!exact(command,[...required,...['id','expectedRevision'].filter(k=>Object.hasOwn(command,k))])||command.exchangeImport!==1||!text(title,300,true)||!researchId(recordId)||id!==undefined&&!researchId(id)||expectedRevision!=null||!validMaterialReference(artifact)||artifact.kind!=='artifact')invalid();
 await materials.assertOwner(recordId,{write:true});
 const source=await materials.read(artifact);
 if(source.recordId!==recordId)invalid();
 if(id&&await materials.current(id,{includeStaged:true}))throw new AppError('MATERIAL_CHANGED');
 return source;
}

// Material indexes are local capabilities. Only this decoder may create one,
// from checked logical items actually supplied by the retained exchange.
function rejectLocalIndexes(value,depth=0){
 if(value===null||typeof value!=='object')return;
 if(depth>DATASET_LIMITS.depth||Object.hasOwn(value,'root')&&Object.hasOwn(value,'chunkSize'))invalid();
 for(const child of Object.values(value))rejectLocalIndexes(child,depth+1);
}

// Only declarations that the destination will actually activate may bind to
// local material. The pinned source addresses in the original transfer remain
// independently readable as evidence, including in another workspace.
async function checkDeclarationReferences(value,materials,recent,namespace){
 if(value===null||typeof value!=='object')return;
 if(validMaterialReference(value)){
  const ref=materialReference(value),key=materialReferenceKey(ref);
  if(recent.has(key))return;
  if(ref.workspaceId!==namespace||await materials.externalReference(ref))throw new AppError('ANALYSIS_SOURCE_ACCESS');
  if(ref.kind==='record'){
   await materials.assertOwner(ref.id);
   await materials.checkReference(ref);
  }else{
   const doc=await materials.read(ref);
   await materials.assertOwner(doc.recordId);
  }
  if(recent.size>=256)recent.delete(recent.values().next().value);recent.add(key);
 }
 for(const member of Object.values(value))await checkDeclarationReferences(member,materials,recent,namespace);
}

function attachmentBuilder(m,kind){
 const ordered=kind==='calculation-lineage'?new CalculationLineage(m.sequences):kind==='coordinate-alignment-contexts'?alignmentContextSet(m,direct):kind==='coordinate-alignment-decisions'?alignmentDecisionSet(m,direct):null;
 if(!ordered)return m.sequences.builder(kind,direct);
 let ref=ordered.ref();
 return {async append(item){const next=await ordered.union(ref,await ordered.leaf(item));if(next.count!==ref.count+1)invalid();ref=next;},finish:()=>ref};
}

function exchangeCursor(chunks,materials,options){
 const it=validatedExchangeFrames(chunks,options)[Symbol.asyncIterator]();
 let current,offset=0;
 async function advance(){
  const item=await it.next();current=item.value;
  if(!item.done)rejectLocalIndexes(current);
 }
 async function take(){
  if(!current)invalid();const frame=current;
  offset+=Buffer.byteLength(JSON.stringify(frame))+1;
  if(!Number.isSafeInteger(offset))invalid();
  await advance();return frame;
 }
 async function object(admit){
  const frame=await take();
  if(admit)await admit(frame);
  for(const descriptor of frame.sequences??[]){
   const builder=attachmentBuilder(materials,descriptor.kind);
   for(let i=0;i<descriptor.count;i++){
    if(current?.type!=='sequence-item')invalid();
    const nested=await object(admit);await builder.append(nested.value);
   }
   const parent=descriptor.path.slice(0,-1).reduce((node,key)=>node[key],frame);
   Object.defineProperty(parent,descriptor.path.at(-1),{value:await builder.finish(),writable:true,enumerable:true,configurable:true});
  }
  delete frame.sequences;return frame;
 }
 return {advance,take,object,get current(){return current;},get offset(){return offset;},close:()=>it.return?.()};
}

export async function prepareExchangeImport(materials,command,{signal,progress=async()=>{},writePage}={}){
 const evidence=await validateExchangeImport(materials,command),original=await materials.originalContent(evidence);
 const namespace=(await materials.workspace.outline()).metadata.id,recent=new Set();
 const admit=frame=>checkDeclarationReferences(frame,materials,recent,namespace);
 return materials.workspace.withCatalogueConnections(()=>withScratch(rowIds=>withDatasetPreparationWrites(materials,{writePage,signal},async staged=>{
  const cursor=exchangeCursor(original.readStaged({signal}),staged,{signal});
  let header,receipt;
  async function* records(){
   await cursor.advance();header=await cursor.take();
   if(cursor.current?.type!=='interpretation')invalid();
   // The entire checked original stays available as evidence. Its declared
   // recipe, external source identities and exclusion decisions describe the
   // exported result. Import never runs computations found in an exchange.
   while(['interpretation','source','sequence-item'].includes(cursor.current?.type))await cursor.take();
   const width=header.selection.columns.reduce((sum,range)=>sum+range.count,0);
   async function* columns(){
    while(cursor.current?.type==='column'){
     const {column}=await cursor.object(admit);
     yield column;
    }
   }
   yield {columnCount:width,columns,retained:true,sourceMapping:{format:'dataset-exchange',version:1}};
   let ordinal=0;
   const ids=new Set();
   async function verifyRowIds(){
    const expected=rowIds.size+ids.size;
    await rowIds.putMany(Array.from(ids,id=>[id,true]));
    if(rowIds.size!==expected)invalid();
    ids.clear();
   }
   while(cursor.current?.type==='row'){
    const offset=cursor.offset,{index,metadata}=await cursor.take();
    const identity=digest(metadata.id);
    if(ids.has(identity))invalid();
    ids.add(identity);if(ids.size===32)await verifyRowIds();
    while(['member','sequence-item'].includes(cursor.current?.type))await cursor.take();
    const locator={format:'dataset-exchange',sourceRow:index,byteOffset:offset,byteLength:0};
    async function* cells(){
     while(cursor.current?.type==='cell'){
      const start=cursor.offset,frame=await cursor.object(cursor.current.properties.coordinateAlignment?admit:undefined);
      async function* spelling(){while(cursor.current?.type==='text')yield (await cursor.take()).text;}
      const cell=await retainDatasetCell(staged,{kind:frame.properties.kind,...(frame.parts?{read:spelling}:{value:frame.text})},direct);
      if(frame.domain){
       const value=await retainDomainValue(staged,cell,frame.domain.definition,direct,{signal});
       if(value.version!==frame.domain.version||value.complete!==frame.domain.complete||value.identity!==frame.domain.identity||value.count!==frame.domain.count)invalid();
       cell.value=value;
      }
      // These byte offsets address this exact immutable evidence file, even
      // when the source lab and its databases are unavailable to the recipient.
      cell.exchangeBytes=[start-offset,cursor.offset-start];
      if(Object.hasOwn(frame.properties,'computation'))cell.computation=frame.properties.computation;
      if(frame.properties.coordinateAlignment)cell.coordinateAlignment=frame.properties.coordinateAlignment;
      yield cell;
     }
     locator.byteLength=cursor.offset-offset;
    }
    yield {id:metadata.id,line:metadata.line,order:++ordinal,excluded:metadata.excluded,locator,cells};
    if(ordinal%64===0)await progress({stage:'validating dataset rows',done:ordinal,total:header.selection.count});
   }
   if(ids.size)await verifyRowIds();
   if(cursor.current?.type!=='complete')invalid();
   receipt=await cursor.take();if(cursor.current!==undefined)invalid();
  }
  try{
   const prepared=await staged.prepareDatasetRows(command,{source:{doc:evidence},rows:records(),preparedWrites:true,signal,progress});
   if(!receipt||receipt.rows!==prepared.content.rowCount||receipt.columns!==prepared.content.schemaIndex.count)invalid();
   // A foreign address describes the imported snapshot. It must never be
   // traversed as a live local research dependency when this record moves.
   const ref={datasetId:header.ref.id,workspaceId:header.ref.workspaceId,revision:header.ref.revision};
   prepared.content.exchangeOrigin={version:1,ref,selection:header.selection,frames:receipt.frames,sha256:receipt.sha256};
   return prepared;
  }finally{await cursor.close();}
 }),{signal}));
}
