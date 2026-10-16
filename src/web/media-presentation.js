import {safeLink} from './website-model.js';
// Presentation belongs to a use of a file, not the preserved research original.
export const presentationDefaults=()=>({media:[],covers:[]});
export const mediaStyle=(site,scope,id)=>({width:100,ratio:'original',fit:'contain',link:'',target:'_self',...site.presentation?.media.find(m=>m.scope===scope&&m.id===id)});
export function validPresentation(p){
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v),exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
 const id=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
 return exact(p,['media','covers'])&&Array.isArray(p.media)&&Array.isArray(p.covers)&&p.media.length<=10000&&p.covers.length<=10000&&
 new Set(p.media.map(m=>m?.scope+':'+m?.id)).size===p.media.length&&new Set(p.covers.map(c=>c?.entryId)).size===p.covers.length&&
 p.media.every(m=>exact(m,['scope','id','width','ratio','fit','link','target','caption','alt'])&&id(m.id)&&typeof m.scope==='string'&&/^((?:home|(?:page|entry|project|notebook|template|region):[a-f0-9-]{36})#[a-zA-Z0-9_-]{1,80}|entry:[a-f0-9-]{36}|cover:[a-f0-9-]{36})$/.test(m.scope)&&Number.isInteger(m.width)&&m.width>=10&&m.width<=100&&['original','square','landscape','portrait','wide'].includes(m.ratio)&&['contain','cover'].includes(m.fit)&&typeof m.link==='string'&&(m.link===''||safeLink(m.link))&&['_self','_blank'].includes(m.target)&&['caption','alt'].every(k=>m[k]===undefined||typeof m[k]==='string'&&m[k].length<=1500&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(m[k])))&&
 p.covers.every(c=>exact(c,['entryId','attachmentId'])&&id(c.entryId)&&(c.attachmentId===null||id(c.attachmentId)));
}

// Reusing a section copies its per-use image settings without sharing mutable state.
export function copySectionPresentation(site,from,source,to,destination,{replace=false}={}) {
 const scopes=new Map(source.map((s,i)=>[from+'#'+s.id,to+'#'+destination[i].id]));
 const copies=site.presentation.media.filter(m=>scopes.has(m.scope)).map(m=>({...structuredClone(m),scope:scopes.get(m.scope)}));
 const overwritten=new Set(destination.map(s=>to+'#'+s.id));
 site.presentation.media=site.presentation.media.filter(m=>replace?!m.scope.startsWith(to+'#'):!overwritten.has(m.scope)).concat(copies);
}
export function clearSectionPresentation(site,target,sections) {
 const scopes=sections&&new Set(sections.map(s=>target+'#'+s.id));
 site.presentation.media=site.presentation.media.filter(m=>scopes?!scopes.has(m.scope):!m.scope.startsWith(target+'#'));
}
