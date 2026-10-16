import {validProse} from './prose-model.js';
import {RECORD_TYPES} from './record-types.js';
export const STARTER_BYTES=512*1024;
export const STARTER_PACKAGE_BYTES=STARTER_BYTES+16384;
export const starterKeys=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const starterText=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
// A portable instruction has no dependency on another workspace's objects or
// fonts. External citations, equations, tables and ordinary formatting survive.
export function portableInstruction(value){
 if(!validProse(value))return false;
 if(typeof value==='string')return true;
 function visit(n){
  if(n.type==='book_figure')return false;
  for(const m of n.marks??[]){
   if(m.type==='font_family'&&m.attrs.font.startsWith('custom-'))return false;
   if(m.type==='link'&&!/^(https?:|mailto:|tel:)/.test(m.attrs.href))return false;
  }
  return (n.content??[]).every(visit);
 }
 return visit(value);
}
export function validStarter(value,{portable=true,legacy=false}={}){
 const instruction=portable?portableInstruction:validProse;
 return starterKeys(value,['name','type','title','body','sections','tags'])&&starterText(value.name,120,true)&&RECORD_TYPES.some(t=>t.id===value.type)&&starterText(value.title,180,true)&&instruction(value.body)&&Array.isArray(value.sections)&&value.sections.every(s=>starterKeys(s,['title','body'])&&starterText(s.title,160,true)&&instruction(s.body))&&Array.isArray(value.tags)&&value.tags.every(t=>starterText(t,40,true))&&new Set(value.tags).size===value.tags.length&&(!legacy||value.sections.length<=30&&new TextEncoder().encode(JSON.stringify(value)).length<=STARTER_BYTES);
}
export function starterRecord(blueprint,{id,notebookId,uuid,now}){
 const copy=value=>{
  const result=structuredClone(value);
  function visit(n){if(n?.attrs?.id)n.attrs.id=uuid();for(const c of n?.content??[])visit(c);}
  if(typeof result==='object')visit(result);return result;
 };
 return {id,notebookId,type:blueprint.type,title:blueprint.title,body:copy(blueprint.body),sections:blueprint.sections.map(s=>({id:uuid(),title:s.title,body:copy(s.body)})),tags:[...blueprint.tags],contributors:[],relations:[],occurredOn:{kind:'unknown'},createdAt:now,updatedAt:now,share:false,figures:[],attachments:[],status:'draft',outcome:''};
}
