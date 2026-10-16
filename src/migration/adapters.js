import {migrationMessage} from './messages.js';
import {pointerParts} from './selector-contract.js';

// Adapters declare meaning; the engine never derives it from filenames.
export const INVENTORY_FORMAT='observanda-source-inventory';
export const INVENTORY_VERSION=1;
export const declarationAdapter=Object.freeze({id:'declared-logbook',version:1,label:'Declared logbook export'});
export const mappingKinds=Object.freeze(['record','concept','chapter','method','investigation','run','decision','comparison','artifact','dataset','analysis','figure','preparation','assessment']);
export const inventoryLimits=Object.freeze({manifestBytes:8*1024*1024,objects:10000,files:20000,links:50000,depth:32,totalBytes:64*1024**3});
const text=(v,max=512)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v);
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
export function relativeSourcePath(value){
 return text(value,2048)&&!value.includes('\\')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/[<>:"|?*]/.test(p)&&!/[ .]$/.test(p)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export const sourceKey=object=>JSON.stringify([object.id,object.revision]);
// Future adapters must produce this contract. Source input cannot install executable adapters.
export function validateInventoryManifest(value){
 const issues=[],issue=(field,message)=>issues.push({field,message});
 if(!keys(value,['format','version','adapter','source','objects'])||value.format!==INVENTORY_FORMAT||value.version!==INVENTORY_VERSION){issue('manifest',migrationMessage('invalidFormat'));return issues;}
 if(!keys(value.adapter,['id','version'])||value.adapter.id!==declarationAdapter.id||value.adapter.version!==declarationAdapter.version)issue('adapter',migrationMessage('invalidAdapter'));
 if(!keys(value.source,['namespace','revision','title'])||!text(value.source.namespace)||!text(value.source.revision)||!text(value.source.title,300))issue('source',migrationMessage('invalidSource'));
 if(!Array.isArray(value.objects)||value.objects.length>inventoryLimits.objects){issue('objects',migrationMessage('invalidObjects'));return issues;}
 let references=0,links=0;
 value.objects.forEach((o,i)=>{
  const at='objects['+i+']';
  if(!keys(o,['id','revision','kind','title','disposition','mapping','reason','audience','urls','dates','files','links','attributes'])){issue(at,migrationMessage('invalidObjectFields'));return;}
  if(!text(o.id)||!text(o.revision)||!text(o.kind,100)||!text(o.title,300))issue(at,migrationMessage('invalidIdentity'));
  if(!['map','exclude','unsupported'].includes(o.disposition)||!['private','public','undecided'].includes(o.audience))issue(at,migrationMessage('invalidDisposition'));
  if(o.disposition==='map'&&(!keys(o.mapping,['kind'])||!mappingKinds.includes(o.mapping.kind)))issue(at+'.mapping',migrationMessage('invalidMapping'));
  if(o.disposition!=='map'&&!text(o.reason,2000))issue(at+'.reason',migrationMessage('exclusionReason'));
  if(o.mapping!==undefined&&(!keys(o.mapping,['kind'])||!mappingKinds.includes(o.mapping.kind)))issue(at+'.mapping',migrationMessage('unknownMapping'));
  if(o.reason!==undefined&&!text(o.reason,2000))issue(at+'.reason',migrationMessage('invalidReason'));
  if(!Array.isArray(o.urls)||o.urls.length>100||o.urls.some(u=>!text(u,2048)||!/^https?:\/\//i.test(u)||(()=>{try{const url=new URL(u);return Boolean(url.username||url.password);}catch{return true;}})()))issue(at+'.urls',migrationMessage('invalidURLs'));
  if(!Array.isArray(o.dates)||o.dates.length>50||o.dates.some(d=>!keys(d,['meaning','value'])||!text(d.meaning,100)||!(d.value===null||text(d.value,200))))issue(at+'.dates',migrationMessage('invalidDates'));
  if(o.attributes!==undefined&&(!keys(o.attributes,Object.keys(o.attributes??{}))||JSON.stringify(o.attributes).length>16384))issue(at+'.attributes',migrationMessage('invalidAttributes'));
  if(!Array.isArray(o.files)||!o.files.length||o.files.length>inventoryLimits.files)issue(at+'.files',migrationMessage('invalidFiles'));
  else {
   references+=o.files.length;
   o.files.forEach((f,j)=>{
    const ft=at+'.files['+j+']';
    if(!keys(f,['path','sha256','bytes','selector'])||!relativeSourcePath(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0){issue(ft,migrationMessage('invalidOriginal'));return;}
    const s=f.selector;
    if(!keys(s,['kind','value','offset','length'])||!['whole','anchor','json-pointer','bytes'].includes(s.kind))issue(ft+'.selector',migrationMessage('declareBoundary'));
    else if(s.kind==='whole'&&Object.keys(s).length!==1||['anchor','json-pointer'].includes(s.kind)&&((s.kind==='json-pointer'?pointerParts(s.value)===null:!text(s.value,2048))||Object.keys(s).length!==2)||s.kind==='bytes'&&(!Number.isSafeInteger(s.offset)||!Number.isSafeInteger(s.length)||s.offset<0||s.length<=0||!Number.isSafeInteger(s.offset+s.length)||s.offset+s.length>f.bytes||Object.keys(s).length!==3))issue(ft+'.selector',migrationMessage('invalidBoundary'));
   });
  }
  if(!Array.isArray(o.links)||o.links.length>inventoryLimits.links)issue(at+'.links',migrationMessage('invalidLinks'));
  else {
   links+=o.links.length;
   o.links.forEach(l=>{if(!keys(l,['type','id','revision','required'])||!text(l.type,100)||!text(l.id)||!text(l.revision)||typeof l.required!=='boolean')issue(at+'.links',migrationMessage('invalidLink'));});
  }
 });
 if(references>inventoryLimits.files*4||links>inventoryLimits.links)issue('objects',migrationMessage('tooManyReferences'));
 return issues.slice(0,200);
}
