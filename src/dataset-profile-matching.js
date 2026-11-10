import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {jsonPointerParts} from './web/dataset-preparation-model.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const same=(left,right)=>revisionText(left)===revisionText(right);

// The display name can be trimmed, suffixed or synthesized by the reader.
// Preserve the physical identity on which the author reviewed the rule.
export function profileColumnIdentity(field,index){
 if(field?.sourceField){
  const {source='row',path}=field.sourceField;
  if(typeof source!=='string'||jsonPointerParts(path)===null)invalid();
  return {kind:'pointer',source,path};
 }
 if(field?.sourceHeader===null)return {kind:'position',index};
 if(typeof field?.sourceHeader==='string')return {kind:'header',text:field.sourceHeader};
 invalid();
}

// An explicit header position disambiguates repeated spellings. An alias is
// an authored replacement spelling; it never overrides an original match.
function identityKey(identity,index=null){
 return revisionText([identity,index]);
}
async function addMatch(scratch,key,profileIndex){
 const previous=await scratch.get(key);
 if(previous===undefined)await scratch.put(key,profileIndex);
 else if(previous!==profileIndex&&previous!==null)await scratch.put(key,null);
}
async function increment(scratch,key){
 const next=(await scratch.get(key)??0)+1;
 if(!Number.isSafeInteger(next))invalid();
 await scratch.put(key,next);
}
function mappingIdentity(mapping){
 const {fields,...declaration}=mapping;
 // The qualified pointer on each column participates individually in the
 // ordered signature. The surrounding row/lookup mapping participates once.
 return declaration;
}
function hashField(hash,identity){
 hash.update(revisionText(identity)).update('\n');
}
function useRule(rule,identity,index){
 if(rule===undefined)return {required:true,at:null,aliases:[]};
 if(!rule||typeof rule!=='object'||Array.isArray(rule)||
  Object.keys(rule).some(key=>!['required','at','aliases'].includes(key))||
  typeof rule.required!=='boolean'||rule.at!==null&&rule.at!==index||
  !Array.isArray(rule.aliases)||rule.aliases.length>32||new Set(rule.aliases).size!==rule.aliases.length||
  rule.aliases.some(alias=>typeof alias!=='string'||alias.length>200||alias===identity.text)||
  identity.kind!=='header'&&(rule.at!==null||rule.aliases.length))invalid();
 return rule;
}

// One scratch scope per comparison. The caller supplies source headers and
// immutable template rules lazily, including on schemas wider than a UI page.
// The result functions live only as long as that encrypted scratch scope.
export async function compileProfileColumns(scratch,template,expectedMapping,signal){
 const expectedHash=createHash('sha256'),expectedShape=mappingIdentity(expectedMapping);
 hashField(expectedHash,expectedShape);let expectedCount=0;
 for await(const field of template){
  signal?.throwIfAborted();
  const index=expectedCount++,identity=profileColumnIdentity(field,index),rule=useRule(field.rule,identity,index);
  hashField(expectedHash,identity);
  await scratch.put('expected:'+index,{identity,required:rule.required});
  await addMatch(scratch,'match:'+identityKey(identity,rule.at),index);
  for(const alias of rule.aliases)await addMatch(scratch,'alias:'+identityKey({kind:'header',text:alias},rule.at),index);
 }
 return {scratch,expectedShape,expectedCount,expectedSignature:expectedHash.digest('hex')};
}
export async function compareProfileColumns(scratch,{template,source,expectedMapping,actualMapping,signal,compiled}){
 const {scratch:expected,expectedShape,expectedCount,expectedSignature}=compiled??await compileProfileColumns(scratch,template,expectedMapping,signal);
 const sourceHash=createHash('sha256'),actualShape=mappingIdentity(actualMapping);
 hashField(sourceHash,actualShape);let sourceCount=0;
 for await(const field of source){
  signal?.throwIfAborted();
  const index=sourceCount++,identity=profileColumnIdentity(field,index);
  const general=identityKey(identity),positioned=identityKey(identity,index);
  const present=field.sourcePresent!==false;
  if(present){hashField(sourceHash,identity);await increment(scratch,'occurrences:'+general);}
  let profileIndex,qualified=false,alias=false;
  for(const prefix of ['match:','alias:']){
   const at=await expected.get(prefix+positioned),any=await expected.get(prefix+general);
   if(at===undefined&&any===undefined)continue;
   qualified=at!==undefined&&any===undefined;
   profileIndex=at===undefined?any:any===undefined||at===any?at:null;
   alias=prefix==='alias:';break;
  }
  if(present&&Number.isSafeInteger(profileIndex))await increment(scratch,'uses:'+profileIndex);
  await scratch.put('source:'+index,{identity,profileIndex:profileIndex??null,ambiguous:profileIndex===null,qualified,alias,present});
 }
 const sourceAt=async index=>{
  if(!Number.isSafeInteger(index)||index<0||index>=sourceCount)invalid();
  const {identity,profileIndex,ambiguous,qualified,alias,present}=await scratch.get('source:'+index);
  const occurrences=await scratch.get('occurrences:'+identityKey(identity));
  let status;
  if(!present)status='absent-path';
  else if(ambiguous)status='ambiguous-rule';
  else if(occurrences>1&&!qualified)status='duplicate-source';
  else if(profileIndex===null)status='unrecognized';
  else if(await scratch.get('uses:'+profileIndex)>1)status='multiple-sources';
  else status=alias?'renamed':index===profileIndex?'matched':'reordered';
  return {sourceIndex:index,profileIndex,identity,status};
 };
 const missingAt=async index=>{
  if(!Number.isSafeInteger(index)||index<0||index>=expectedCount)invalid();
  if(await scratch.get('uses:'+index))return null;
  const {identity,required}=await expected.get('expected:'+index);
  return {profileIndex:index,identity,status:required?'missing-required':'missing-optional'};
 };
 return {sourceCount,expectedCount,sourceSignature:sourceHash.digest('hex'),expectedSignature,
  sameMapping:same(expectedShape,actualShape),sourceAt,missingAt};
}
