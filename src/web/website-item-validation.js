// Individual authoring values share the legacy model's field rules. Collection
// membership, identity and hierarchy are checked by the complete document owner.
import {researchId} from './research-reference.js';
import {validSections} from './website-model.js';
import {validDownloadInfo} from './website-file.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const text=(value,max,required=false)=>typeof value==='string'&&value.length<=max&&(!required||value.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const sections=(value,version)=>validSections(value,true,version>=8,version>=9,version>=10,version>=12);
export function validWebsitePage(value,{formatVersion=21,draft=false}={}){
 return keys(value,['id','title','body','share',...(formatVersion>=7&&Object.hasOwn(value??{},'sections')?['sections']:[])])&&researchId(value.id)&&text(value.title,160,!draft)&&text(value.body,60000)&&typeof value.share==='boolean'&&(!Object.hasOwn(value,'sections')||sections(value.sections,formatVersion));
}
export function validWebsiteNavigationItem(value,{formatVersion=21}={}){
 return keys(value,['target','label','show',...(formatVersion>=7&&Object.hasOwn(value??{},'parent')?['parent']:[])])&&text(value.target,100,true)&&text(value.label,160)&&typeof value.show==='boolean'&&(value.parent===undefined||value.parent===null||typeof value.parent==='string');
}
export function validWebsiteAsset(value){
 return keys(value,['id','kind','caption','alt','transcript',...(value?.kind==='file'?['name','size','sha256']:[])])&&researchId(value.id)&&['image','audio','video','file'].includes(value.kind)&&(value.kind!=='file'||validDownloadInfo(value))&&text(value.caption,1500)&&text(value.alt,1500)&&text(value.transcript,60000);
}
export function validWebsiteLayout(value,{formatVersion=21}={}){
 return keys(value,['target','showHeading','heading','description','placement','sections'])&&typeof value.target==='string'&&typeof value.showHeading==='boolean'&&text(value.heading,180)&&text(value.description,1500)&&['before','after','replace'].includes(value.placement)&&(!value.target.startsWith('entry:')||value.placement!=='replace')&&sections(value.sections,formatVersion);
}
export function validWebsiteBranding(value){
 return keys(value,['target','logos'])&&typeof value.target==='string'&&Array.isArray(value.logos)&&value.logos.length<=4&&value.logos.every(logo=>keys(logo,['id','alt'])&&researchId(logo.id)&&text(logo.alt,160));
}
