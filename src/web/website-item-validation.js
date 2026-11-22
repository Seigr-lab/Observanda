import {validTemplateLink} from './website-template-inheritance.js';
// Individual authoring values share the legacy model's field rules. Collection
// membership, identity and hierarchy are checked by the complete document owner.
import {researchId} from './research-reference.js';
import {validSections} from './website-model.js';
import {validDownloadInfo} from './website-file.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export function validWebsitePage(value,{draft=false}={}){
 return keys(value,['id','title','body','share',...(Object.hasOwn(value??{},'sections')?['sections']:[]),...(Object.hasOwn(value??{},'templateLink')?['templateLink']:[])])&&researchId(value.id)&&text(value.title,160,!draft)&&text(value.body,60000)&&typeof value.share==='boolean'&&(!Object.hasOwn(value,'sections')||validSections(value.sections))&&(!Object.hasOwn(value,'templateLink')||validTemplateLink(value.templateLink));
}
export function validWebsiteNavigationItem(value){
 return keys(value,['target','label','show',...(Object.hasOwn(value??{},'parent')?['parent']:[])])&&text(value.target,100,true)&&text(value.label,160)&&typeof value.show==='boolean'&&(value.parent===undefined||value.parent===null||typeof value.parent==='string');
}
export function validWebsiteAsset(value){
 return keys(value,['id','kind','caption','alt','transcript',...(value?.kind==='file'?['name','size','sha256']:[])])&&researchId(value.id)&&['image','audio','video','file'].includes(value.kind)&&(value.kind!=='file'||validDownloadInfo(value))&&text(value.caption,1500)&&text(value.alt,1500)&&text(value.transcript,60000);
}
export function validWebsiteLayout(value){
 return keys(value,['target','showHeading','heading','description','placement','sections',...(Object.hasOwn(value??{},'templateLink')?['templateLink']:[])])&&typeof value.target==='string'&&typeof value.showHeading==='boolean'&&text(value.heading,180)&&text(value.description,1500)&&['before','after','replace'].includes(value.placement)&&(!value.target.startsWith('entry:')||value.placement!=='replace')&&validSections(value.sections)&&(!Object.hasOwn(value,'templateLink')||validTemplateLink(value.templateLink));
}
export function validWebsiteBranding(value){
 return keys(value,['target','logos'])&&typeof value.target==='string'&&Array.isArray(value.logos)&&value.logos.length<=4&&value.logos.every(logo=>keys(logo,['id','alt'])&&researchId(logo.id)&&text(logo.alt,160));
}
