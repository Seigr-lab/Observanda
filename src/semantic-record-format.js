import {requireSemanticRecordStyles,requireStarterDocuments} from './catalogue-format.js';

// Full validation already sees each writing field. Keep the result with the
// immutable document so a normal commit does not read all the sections again.
const scanned=new WeakMap();
export function rememberSemanticWriting(document,present){scanned.set(document,present);}
export function hasSemanticWriting(record){
 return !!record.body?.attrs?.semanticStyles||record.sections?.some(section=>!!section.body?.attrs?.semanticStyles)===true;
}
export function semanticDraftPart(part){
 if(part.kind==='field'&&part.name==='body')return !!part.value?.attrs?.semanticStyles;
 if(part.name!=='sections')return false;
 if(part.kind==='item')return !!part.value?.body?.attrs?.semanticStyles;
 return part.kind==='field'&&Array.isArray(part.value)&&hasSemanticWriting({sections:part.value});
}
export async function requireStarterWriting(db,blueprint){
 await requireStarterDocuments(db);
 if(hasSemanticWriting(blueprint))await requireSemanticRecordStyles(db);
}
export async function semanticWritingDocument(document,{signal}={}){
 if(scanned.has(document))return scanned.get(document);
 if((await document.field(['body','attrs','semanticStyles'],{signal})).value)return true;
 for await(const section of document.items(['sections'],{signal})){
  if((await document.tree.selected(section.value,['body','attrs','semanticStyles'])).value)return true;
 }
 return false;
}
