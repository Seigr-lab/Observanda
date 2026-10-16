import {researchId,validTarget} from './research-reference.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
export const emptyPublicationLinks=()=>({version:1,pages:[]});
// Deliberately excludes URL schemes, encoded traversal, reserved device names,
// query strings and server control files. Paths are relative to the site root.
export function legacyPagePath(value){
 return typeof value==='string'&&value.length<=500&&/^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.html$/.test(value)&&!value.split('/').some(p=>/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))&&!/^(?:fonts|media|figures)\//i.test(value);
}
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=300;
function validAnchor(a){
 return exact(a,['id','fragment','label','target'])&&researchId(a.id)&&typeof a.fragment==='string'&&a.fragment.length<=300&&!/[\s\x00-\x1f<>"']/.test(a.fragment)&&label(a.label)&&(a.target===null||validTarget(a.target)&&a.target.kind==='record');
}
function validPage(p){
 return exact(p,['id','path','title','anchors'])&&researchId(p.id)&&legacyPagePath(p.path)&&label(p.title)&&Array.isArray(p.anchors)&&p.anchors.length>0&&p.anchors.length<=1000&&p.anchors.every(validAnchor)&&new Set(p.anchors.map(a=>a.id)).size===p.anchors.length;
}
export function validPublicationLinks(value){
 if(!exact(value,['version','pages'])||value.version!==1||!Array.isArray(value.pages)||value.pages.length>1000||!value.pages.every(validPage))return false;
 return value.pages.reduce((n,p)=>n+p.anchors.length,0)<=10000&&new Set(value.pages.map(p=>p.id)).size===value.pages.length;
}
