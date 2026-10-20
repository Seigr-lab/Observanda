import {randomUUID,randomBytes} from 'node:crypto';
import {AppError} from './errors.js';
import {customFontId} from './web/font-catalogue.js';
import {themeReferences} from './web/website-theme-model.js';
export function websiteThemeRemapper({assetIds=new Map(),fontIds=new Map(),makeId=randomUUID}={}){
 const owners=new Map(),sections=new Map();
 const owner=id=>{if(!owners.has(id))owners.set(id,makeId());return owners.get(id);};
 const section=(scope,id)=>{const key=scope+'#'+id;if(!sections.has(key))sections.set(key,makeId());return sections.get(key);};
 const asset=id=>{if(!assetIds.has(id))assetIds.set(id,makeId());return assetIds.get(id);};
 const font=id=>{if(!customFontId(id))return id;if(!fontIds.has(id))fontIds.set(id,'custom-'+randomBytes(32).toString('hex'));return fontIds.get(id);};
 function values(value,scope){
  if(Array.isArray(value))return value.map(v=>values(v,scope));
  if(!value||typeof value!=='object')return value;
  const out={};for(const [key,v] of Object.entries(value)){
   if(['font','headingFont'].includes(key)&&typeof v==='string')out[key]=font(v);
   else if(key==='assetId')out[key]=v===null?null:asset(v);
   else if(key==='assetIds')out[key]=v.map(asset);
   else if(['href','link'].includes(key)&&typeof v==='string'&&/^#record-section-/.test(v))out[key]='#record-section-'+section(scope,v.slice(16));
   else if(key==='attrs'&&value.type==='heading'&&v?.id)out[key]={...values(v,scope),id:section(scope,v.id)};
   else out[key]=values(v,scope);
  }return out;
 }
 const blocks=(list,scope)=>list.map(s=>({...values(s,scope),id:section(scope,s.id),...(s.parentId?{parentId:section(scope,s.parentId)}:{})}));
 const media=(list,scope)=>list.map(m=>{const {sectionId,...rest}=m;return {...values(rest,scope),id:asset(m.id),sectionId:section(scope,sectionId)};});
 function template(t){
  const next={id:owner(t.id),name:t.name,sections:blocks(t.sections,t.id)};
  if(t.binding){const b=t.binding;next.binding={templateId:owner(b.templateId),sectionIds:b.sectionIds.map(r=>({templateId:section(b.templateId,r.templateId),pageId:section(t.id,r.pageId)})),baseline:{sections:blocks(b.baseline.sections,b.templateId),media:media(b.baseline.media,b.templateId)}};}return next;
 }
 function remap(pkg){
  const result={...structuredClone(pkg),appearance:values(pkg.appearance,''),typography:values(pkg.typography,''),templates:pkg.templates.map(template),design:values(pkg.design,'')};
  if(pkg.design.regions)result.design.regions={definitions:pkg.design.regions.definitions.map(r=>({...values(r,r.id),id:owner(r.id),sections:blocks(r.sections,r.id)})),assignments:pkg.design.regions.assignments.map(a=>({...a,regionId:a.regionId===null?null:owner(a.regionId)}))};
  result.presentation={covers:[],media:pkg.presentation.media.map(m=>{const [scope,id]=m.scope.split('#'),[kind,own]=scope.split(':');return {...values(m,own),id:asset(m.id),scope:kind+':'+owner(own)+'#'+section(own,id)};})};
  result.assets=pkg.assets.map(a=>({...a,id:asset(a.id)}));
  result.fonts=pkg.fonts.map(f=>({...f,id:font(f.id),resources:f.resources.map(id=>pkg.assets.some(a=>a.id===id)?asset(id):owner(id))}));
  result.resources=pkg.resources.map(r=>({...r,id:pkg.assets.some(a=>a.id===r.id)?asset(r.id):owner(r.id)}));return result;
 }
 return {owner,section,asset,font,values,blocks,remap,assetIds,fontIds};
}
export async function captureWebsiteTheme(header,{name,templateIds=[],regionIds=[]},readBaseline){
 const site=header.document.website,templates=site.templates??[],regions=site.design.regions??{definitions:[],assignments:[]};
 if(typeof name!=='string'||!name.trim()||name.length>160||!Array.isArray(templateIds)||!Array.isArray(regionIds)||new Set(templateIds).size!==templateIds.length||new Set(regionIds).size!==regionIds.length)throw new AppError('INVALID');
 const selected=new Map(),visiting=new Set();
 async function include(id){if(visiting.has(id))throw new AppError('INVALID');if(selected.has(id))return;const t=templates.find(v=>v.id===id);if(!t)throw new AppError('NOT_FOUND');visiting.add(id);const copy={id:t.id,name:t.name,sections:structuredClone(t.sections)};
  if(t.templateLink){await include(t.templateLink.templateId);copy.binding={templateId:t.templateLink.templateId,sectionIds:structuredClone(t.templateLink.sectionIds),baseline:await readBaseline(t.templateLink)};}
  visiting.delete(id);selected.set(id,copy);
 }
 for(const id of templateIds)await include(id);
 const chosen=regionIds.map(id=>{const region=regions.definitions.find(r=>r.id===id);if(!region)throw new AppError('NOT_FOUND');return structuredClone(region);});
 const design={...structuredClone(site.design),regions:{definitions:chosen,assignments:regions.assignments.filter(a=>['*','home'].includes(a.target)&&a.regionId!==null&&regionIds.includes(a.regionId))}};
 const scopes=new Set([...selected.keys()].map(id=>'template:'+id).concat(regionIds.map(id=>'region:'+id)));
 const value={format:'observanda-website-theme',version:1,name:name.trim(),appearance:structuredClone(header.document.appearance),palette:structuredClone(site.palette??{}),typography:structuredClone(site.typography??{}),design,templates:[...selected.values()],presentation:{media:(site.presentation?.media??[]).filter(m=>scopes.has(m.scope.split('#')[0])),covers:[]},assets:[],fonts:[],resources:[]};
 return {value,references:themeReferences(value)};
}
