import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {datasetMapping} from './dataset-reader.js';
import {readPagedDataset} from './dataset-paged-reader.js';
import {profileColumnIdentity} from './dataset-profile-matching.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {digest} from './storage-format.js';
import {describeRuleFile,readRuleFile,validRuleFile} from './dataset-profile-rule-file.js';
import {isIntakeAdapter} from './intake/adapter.js';

const tool='Observanda dataset interpretation profile';
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const changed=()=>{throw new AppError('MATERIAL_CHANGED');};
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
const location=(ref,kind)=>validMaterialReference(ref)&&ref.kind===kind;
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const valueKinds=['string','number','boolean','null','absent','object','array'];
export const isDatasetInterpretationProfile=doc=>doc?.kind==='analysis'&&doc.content?.tool===tool&&doc.content.version==='1';
const libraries=Object.freeze({'interpretation-profiles':isDatasetInterpretationProfile,'intake-adapters':isIntakeAdapter});

export async function indexDatasetProfile(workspace,doc){
 const library=isDatasetInterpretationProfile(doc)?'interpretation-profiles':isIntakeAdapter(doc)?'intake-adapters':null;
 if(!library)return;
 const file='.observanda/materials/index/'+library+'/'+doc.id+'.json',value=JSON.stringify({id:doc.id,recordId:doc.recordId});
 const previous=await workspace.readMetadata(file,2048);
 if(previous===null)await workspace.writeMetadata(file,value);
 else if(previous!==value)damaged();
}
export async function profileList(materials,{query,after},{signal,verify},library='interpretation-profiles'){
 if(!Object.hasOwn(libraries,library)||!text(query,200)||after!==null&&!researchId(after))invalid();
 const directory='.observanda/materials/index/'+library;
 const page=await materials.workspace.metadataPage(directory,{after:after?after+'.json':null,limit:32});
 const items=[],needle=query.trim().normalize('NFKC').toLowerCase();
 for(const row of page.items){
  signal?.throwIfAborted();const item=JSON.parse(row.text);
  if(!exact(item,['id','recordId'])||row.name!==item.id+'.json'||!researchId(item.id)||!researchId(item.recordId))damaged();
  const head=await materials.current(item.id);
  if(!head)continue;
  if(head.recordId!==item.recordId)damaged();
  await materials.assertOwner(item.recordId);
  if(!head.title.normalize('NFKC').toLowerCase().includes(needle))continue;
  const doc=await materials.read(head);
  if(libraries[library](doc))items.push({title:head.title,recordId:item.recordId,ref:materialReference(head)});
 }
 await verify?.();
 return {items,next:page.next?page.next.slice(0,-5):null};
}

function ruleChanges(rules,width){
 if(!Array.isArray(rules))invalid();
 let previous=-1;
 for(const item of rules){
  if(!exact(item,['index','at','required','aliases','kinds',...(item&&Object.hasOwn(item,'tokens')?['tokens']:[])])||!natural(item.index)||item.index<=previous||item.index>=width||
   item.at!==null&&item.at!==item.index||typeof item.required!=='boolean'||!Array.isArray(item.aliases)||
   item.aliases.length>32||new Set(item.aliases).size!==item.aliases.length||item.aliases.some(alias=>typeof alias!=='string'||alias.length>200)||
   item.kinds!==null&&(!Array.isArray(item.kinds)||!item.kinds.length||item.kinds.length>valueKinds.length||
    !item.kinds.every(kind=>valueKinds.includes(kind))||new Set(item.kinds).size!==item.kinds.length)||
   item.tokens!==undefined&&(!Array.isArray(item.tokens)||!item.tokens.length||item.tokens.length>128||new Set(item.tokens).size!==item.tokens.length||
    item.tokens.some(value=>typeof value!=='string'||value.length>256)))invalid();
  previous=item.index;
 }
 return rules;
}

// An ordinary analysis owns the two pinned inputs and the versioned matching
// rules. Unit, clock and missing-value declarations remain in the immutable
// template dataset. Very wide templates need no copy in the profile body.
export async function openProfileTemplate(materials,ref,{check,verify,signal}={}){
 if(!location(ref,'dataset'))invalid();
 await check?.(ref);signal?.throwIfAborted();
 const doc=await materials.read(ref),content=doc.content;
 await materials.assertOwner(doc.recordId);
 if(![1,2].includes(content.inputs?.length)||!location(content.inputs[0],'artifact')||content.calculation||content.aggregation||
  content.exchangeOrigin||content.calculatorResult||content.spectrum||content.cusum||content.uncertainty||!content.sourceMapping)invalid();
 if(content.inputs.length===2){
  const prior=content.inputs[1];
  if(!location(prior,'analysis'))invalid();
  await check?.(prior);
  if(!isDatasetInterpretationProfile(await materials.read(prior)))invalid();
 }
 const original=materialReference(content.inputs[0]);
 await check?.(original);
 const mapping=content.sourceMapping.format==='delimited'?datasetMapping(content.sourceMapping):
  datasetMapping({...content.sourceMapping,fields:'all'});
 const width=content.schemaIndex?.count??content.columns?.length;
 if(!natural(width)||!width)damaged();
 async function* fields(){
  for(let start=0;start<width;){
   signal?.throwIfAborted();await verify?.();await check?.(ref);
   const page=await materials.retainedSchemaPage(doc,{offset:start,limit:Math.min(32,width-start)});
   if(page.total!==width||page.items.length===0)damaged();
   for(const column of page.items){start++;yield column;}
  }
 }
 async function* identities(){
  if(mapping.format!=='delimited'){
   for await(const column of fields()){
    if(!column.sourceField)damaged();
    yield {name:column.sourceField.name,sourceField:column.sourceField};
   }
   return;
  }
  const {content:source}=await materials.artifact(original,{signal,verification:'descriptor'});
  for await(const header of readPagedDataset(source.readChunks(0,source.size-1,{signal}),mapping,{sourceIdentities:true,signal})){
   if(header.columnCount!==width)damaged();
   yield* header.columns();return;
  }
  damaged();
 }
 return {doc,original,mapping,width,fields,identities,column:index=>materials.datasetColumn(doc,index)};
}

export async function readDatasetProfile(materials,ref,options={}){
 if(!location(ref,'analysis'))invalid();
 await options.check?.(ref);const doc=await materials.read(ref);
 await materials.assertOwner(doc.recordId);
 if(!isDatasetInterpretationProfile(doc))invalid();
 const {inputsIndex,outputsIndex,parameters}=doc.content;
 if(inputsIndex?.kind!=='references'||![2,3].includes(inputsIndex.count)||outputsIndex?.kind!=='references'||outputsIndex.count!==0||typeof parameters!=='string')invalid();
 let model;try{model=JSON.parse(parameters);}catch{invalid();}
 if(!exact(model,['signature','rules'])||!revisionId(model.signature))invalid();
 const [template,original,ruleFile]=(await materials.sequences.page(inputsIndex,{limit:3})).items;
 const source=await openProfileTemplate(materials,template,options);
 if(!location(original,'artifact')||revisionText(materialReference(original))!==revisionText(source.original))damaged();
 if(Boolean(ruleFile)!==validRuleFile(model.rules))damaged();
 const rules=ruleFile?await readRuleFile(materials,ruleFile,model.rules,{recordId:doc.recordId,width:source.width,template},options):model.rules;
 return {doc,ref:materialReference(ref),template,source,signature:model.signature,rules:ruleChanges(rules,source.width),ruleFile};
}

export async function* profileExpectedFields(source,rules){
 let index=0,override=0;
 for await(const field of source.identities()){
  const change=rules[override]?.index===index?rules[override++]:null;
  if(change){
   const {at,required,aliases}=change,identity=profileColumnIdentity(field,index);
   if(identity.kind!=='header'&&(aliases.length||at!==null)||aliases.some(alias=>alias===identity.text))invalid();
   yield {...field,rule:{at,required,aliases}};
  }else yield field;
  index++;
 }
 if(index!==source.width||override!==rules.length)damaged();
}

export async function profileSignature(source,rules){
 const hash=createHash('sha256'),{fields,...mapping}=source.mapping;
 hash.update(revisionText(mapping)).update('\n');let index=0;
 for await(const field of profileExpectedFields(source,rules))hash.update(revisionText(profileColumnIdentity(field,index++))).update('\n');
 return hash.digest('hex');
}

export async function prepareProfileRevision(materials,command,options={}){
 if(!exact(command,['id','recordId','expectedRevision','title','template','rules'])||
  !researchId(command.id)||!researchId(command.recordId)||command.expectedRevision!==null&&!revisionId(command.expectedRevision)||
  !text(command.title,300,true)||command.title.trim()!==command.title)invalid();
 await materials.assertOwner(command.recordId,{write:true});
 const head=await materials.current(command.id,{includeStaged:true});
 if(head&&(head.kind!=='analysis'||head.recordId!==command.recordId))changed();
 const replay=(head?.revision??null)!==command.expectedRevision;
 if(replay&&(!options.replay||!head))changed();
 const previous=head?await readDatasetProfile(materials,head,options):null;
 const source=await openProfileTemplate(materials,command.template,options),rules=ruleChanges(command.rules,source.width);
 const signature=await profileSignature(source,rules);
 let file=null,parameters=revisionText({signature,rules});
 if(parameters.length>20000){file=describeRuleFile(rules);parameters=revisionText({signature,rules:file});}
 const proposal={recordId:command.recordId,id:command.id,expectedRevision:command.expectedRevision,title:command.title,tool,version:'1',
  parameters,inputs:[materialReference(command.template),source.original],outputs:[]};
 if(replay&&(previous.doc.previous!==command.expectedRevision||previous.doc.title!==command.title||previous.doc.content.parameters!==parameters||
   revisionText(previous.template)!==revisionText(proposal.inputs[0])))changed();
 return {source,previous,proposal,signature,rules,file,review:digest(revisionText(proposal))};
}
