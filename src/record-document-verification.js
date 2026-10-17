import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {validateRecordDocument} from './record-document-validation.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {retainedQueryProjection} from './record-query-projection.js';
import {withQueryValue} from './record-query-storage.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {validateFigureSources} from './figure-provenance.js';
import {revisionText} from './web/revision-model.js';
import {RecordMemberCollections,memberCollectionFields,memberCollectionCount} from './record-member-collections.js';
import {RecordResultIndex} from './record-result-index.js';
import {RecordAttemptIndex} from './record-attempt-index.js';
import {retainSearchVocabulary,verifySearchVocabulary} from './record-search-vocabulary.js';
import {retainReferenceIndex,verifyReferenceIndex} from './record-reference-index.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
async function fieldDigest(tree,root,name,{signal}={}){
 const selected=await tree.select(root,[name]);if(!selected)fail();
 if(selected.inline)return digest(revisionText(selected.value));
 const hash=createHash('sha256');for await(const text of tree.json(selected.revision,{canonical:true,signal}))hash.update(text);return hash.digest('hex');
}
export async function verifyRecordDocument(store,row,metadata,summaries,media,{signal}={}){
 return withRecordDocument(store,row.id,row.revision,async document=>{
  const header=await validateRecordDocument(document,metadata,{summaries,signal}),encoding=await document.encoding({signal});
  await (await RecordResultIndex.open(document,{signal}))?.verify({signal});
  await (await RecordAttemptIndex.open(document,{signal}))?.verify({signal});
  if(row.collections){
   const membership=new RecordMemberCollections(store);
   for(const field of memberCollectionFields){
    if(memberCollectionCount(row,field)!==await document.tree.arrayLength(document.root,[field]))fail();let position=0;
    for await(const id of membership.ids(row,field)){signal?.throwIfAborted();if((await document.field([field,String(position++),'id'],{signal})).value!==id)fail();}
   }
  }
  const expected=await recordDocumentSummary(document,header,encoding,{signal,collections:row.collections}),{position,queryRevision,summaryRevision,...stored}=row;
  void position;void queryRevision;void summaryRevision;
  for(const key of ['notebookId','share','updatedAt','occurredOn','template','cardItems'])if(row[key]===undefined)delete expected[key];
  if(digest(revisionText(stored))!==digest(revisionText(expected)))fail();
  for await(const ref of document.items(['figures'],{signal}))await validateFigureSources(store.workspace,{figures:[await document.tree.read(ref.value)]});
  if(media)for await(const ref of document.items(['attachments'],{signal}))await media.record({attachments:[await document.tree.read(ref.value)]});
  await withRecordProjectionScratch(document,async projection=>{
   const expected=await retainedQueryProjection(projection,encoding.contentRevision,{signal});
   for(const [kind,revision] of [['record-query',row.queryRevision],['record-summary',row.summaryRevision]]){
    if(!revision)continue;const source={revision,slot:kind+':'+row.id+':'+revision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
    await withQueryValue(store,store.decode('state',source.slot,found?.payload),source,row,async({value,tree})=>{
     if(tree&&value.vocabulary)await verifySearchVocabulary(tree.storage,value.vocabulary,projection.blocks,await retainSearchVocabulary(projection,{signal,version:value.vocabulary.version}),{signal});
     if(tree&&value.referenceIndex)await verifyReferenceIndex(tree.storage,value.referenceIndex,projection.blocks,await retainReferenceIndex(projection,{signal,version:value.referenceIndex.version}),{signal});
     const names=tree?await tree.propertyNames(value.root):Object.keys(value);
     const required=Object.keys(expected.browse).filter(key=>key!=='recordRevision');if(kind==='record-query')required.push('searchText');
     if(required.some(name=>!names.includes(name)))fail();
     for(const name of names){
      signal?.throwIfAborted();
      if(kind==='record-summary'&&name==='searchText')fail();
      const actual=tree?await fieldDigest(tree,value.root,name,{signal}):digest(revisionText(value[name]));
      if(actual!==await fieldDigest(projection.tree,expected.root,name,{signal}))fail();
     }
    });
   }
  },{signal});
 });
}
// Small originals retain their existing direct verification path. Their newer
// query descriptor may still own a vocabulary that must be independently read.
export async function verifyRecordVocabulary(store,row,{signal}={}){
 if(!row.queryRevision)return;
 const source={revision:row.queryRevision,slot:'record-query:'+row.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot),descriptor=store.decode('state',source.slot,found?.payload);
 if(descriptor?.format!=='observanda-record-query-blocks'||![2,3,4,5,6].includes(descriptor.version))return;
 await withQueryValue(store,descriptor,source,row,({value,tree})=>withRecordDocument(store,row.id,row.revision,document=>withRecordProjectionScratch(document,async projected=>{
  await verifySearchVocabulary(tree.storage,value.vocabulary,projected.blocks,await retainSearchVocabulary(projected,{signal,version:value.vocabulary.version}),{signal});
  if(value.referenceIndex)await verifyReferenceIndex(tree.storage,value.referenceIndex,projected.blocks,await retainReferenceIndex(projected,{signal,version:value.referenceIndex.version}),{signal});
 },{signal})));
}
