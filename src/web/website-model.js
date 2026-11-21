import {validTemplateLink} from './website-template-inheritance.js';
import {validActionStyle,validAction,ACTION_KINDS} from './website-action-style.js';
import {validPublicationSources} from './publication-sources-model.js';
import {websiteLink,safeWebsiteLink} from './website-links.js';
import {validFeed} from './website-feed-model.js';
import {validTree,MAX_ELEMENTS} from './composition-tree.js';
import {validRichText} from './rich-text-model.js';
import {validRegions} from './website-regions.js';
// Website composition is presentation data; it never grants access or changes research.
export const SECTION_KINDS = ['text', 'projects', 'records', 'pages', 'media', 'callout', 'link', 'divider', 'asset', 'hero', 'gallery', 'container', 'heading', 'contents', 'disclosure', 'popup', 'copy-text', 'download'];
export const websiteDefaults = () => ({title:null, description:null, home:{title:null, showTitle:true, sections:[
  {id:'projects',kind:'projects',title:'Projects',show:true,layout:'inherit'},
  {id:'records',kind:'records',title:'Recent records',show:true,layout:'inherit'},
  {id:'pages',kind:'pages',title:'Pages',show:true,layout:'inherit'}
]}});
export const emptyHomepage = () => ({enabled:false,title:'Home',introduction:'',showTitle:true,sections:[]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names)=>object(v)&&Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const siteLayoutDefaults = () => ({width:1200,navigation:'top',heading:'split',contents:true});
export const sectionStyle = s => ({width:'full',surface:'none',align:'start',space:'normal',...s.style});
export function validSiteLayout(v){return keys(v,['width','navigation','heading','contents',...['regions','browseLink','buttons','links'].filter(key=>Object.hasOwn(v??{},key))])&&Number.isInteger(v.width)&&v.width>=720&&v.width<=1600&&['top','side','none'].includes(v.navigation)&&['compact','split','center'].includes(v.heading)&&typeof v.contents==='boolean'&&(v.browseLink===undefined||typeof v.browseLink==='boolean')&&(v.regions===undefined||validRegions(v.regions,validSections))&&['buttons','links'].every(key=>v[key]===undefined||validActionStyle(v[key]));}
export const safeLink=safeWebsiteLink;
export function validSections(sections,extended=true,composed=true,rich=true,extendedText=true,tree=true){
  return Array.isArray(sections)&&sections.length<=(tree?MAX_ELEMENTS:50)&&new Set(sections.map(s=>s?.id)).size===sections.length&&(!tree||validTree(sections))&&sections.every(s=>{
    const extra=s?.kind==='download'?['assetId','label','body']:s?.kind==='popup'?['label','dialogWidth']:s?.kind==='copy-text'?['value','body','label']:s?.kind==='disclosure'?['open']:s?.kind==='container'?['layout','columns','gap']:s?.kind==='heading'?['level']:['text','callout'].includes(s?.kind)?['body']:s?.kind==='media'?['entryId','attachmentId']:s?.kind==='hero'?['body','assetId','href','label']:s?.kind==='gallery'?['assetIds','columns']:s?.kind==='asset'?['assetId']:s?.kind==='link'?['href','label','body']:['divider','contents'].includes(s?.kind)?[]:['layout'];
    const optional=extended?[...['action','close'].filter(k=>Object.hasOwn(s??{},k)),...(s?.kind==='gallery'?['viewer']:[]),...(tree?['parentId','feed']:[]),'style','filter',...(composed?['format']:[]),...(rich?['richText','linkTarget','linkTitle','linkNoFollow']:[])].filter(k=>Object.hasOwn(s??{},k)):[];
    if(!keys(s,['id','kind','title','show',...extra,...optional])||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||!(extended?(composed?(tree?SECTION_KINDS:SECTION_KINDS.slice(0,11)):SECTION_KINDS.slice(0,9)):SECTION_KINDS.slice(0,5)).includes(s.kind)||!text(s.title,160)||typeof s.show!=='boolean')return false;
    if(Object.hasOwn(s,'action')&&(!ACTION_KINDS.includes(s.kind)||!validAction(s.action)))return false;
    if(Object.hasOwn(s,'close')&&(s.kind!=='popup'||!validAction(s.close,{close:true})))return false;
    if(Object.hasOwn(s,'format')&&(!['text','callout','hero'].includes(s.kind)||!(rich?['plain','markdown','rich']:['plain','markdown']).includes(s.format)))return false;
    if((s.format==='rich')!==Object.hasOwn(s,'richText')||s.richText&&(!['text','callout','hero'].includes(s.kind)||!validRichText(s.richText,{extended:extendedText})))return false;
    if(['linkTarget','linkTitle','linkNoFollow'].some(k=>Object.hasOwn(s,k))&&(!['link','hero'].includes(s.kind)||(s.linkTarget!==undefined&&!['_self','_blank'].includes(s.linkTarget))||(s.linkTitle!==undefined&&!text(s.linkTitle,200))||(s.linkNoFollow!==undefined&&typeof s.linkNoFollow!=='boolean')))return false;
    if(Object.hasOwn(s,'style')&&(!keys(s.style,['width','surface','align','space',...(composed?['fontSize','padding','radius','background','color','fit','headingAlign','bodyAlign','itemHeadingAlign','detailsAlign','captionAlign','buttonAlign']:[]).filter(k=>Object.hasOwn(s.style??{},k))])||!['full','half','third','two-thirds'].includes(s.style.width)||!['none','card','tint'].includes(s.style.surface)||!['start','center'].includes(s.style.align)||!['compact','normal','roomy'].includes(s.style.space)))return false;
    if(s.style&&['headingAlign','bodyAlign','itemHeadingAlign','detailsAlign','captionAlign','buttonAlign'].some(key=>Object.hasOwn(s.style,key)&&!(key==='bodyAlign'?['start','center','end','justify']:['start','center','end']).includes(s.style[key])))return false;
    if(s.style&&(['fontSize','padding','radius'].some(k=>Object.hasOwn(s.style,k)&&(!Number.isInteger(s.style[k])||s.style[k]<(k==='fontSize'?14:0)||s.style[k]>(k==='fontSize'?48:k==='radius'?40:100)))||['background','color'].some(k=>Object.hasOwn(s.style,k)&&!/^#[0-9a-f]{6}$/i.test(s.style[k]))||Object.hasOwn(s.style,'fit')&&!['contain','cover'].includes(s.style.fit)))return false;
    if(Object.hasOwn(s,'feed')&&!validFeed(s.feed,s.kind))return false;
    if(Object.hasOwn(s,'filter')&&(!['projects','records','pages'].includes(s.kind)||!keys(s.filter,['projectId','tag','limit'])||!(s.filter.projectId===null||uuid(s.filter.projectId))||!text(s.filter.tag,40)||!Number.isSafeInteger(s.filter.limit)||s.filter.limit<0))return false;
    return s.kind==='download'?(s.assetId===null||uuid(s.assetId))&&text(s.label,160)&&text(s.body,60000):s.kind==='popup'?text(s.label,160)&&Number.isSafeInteger(s.dialogWidth)&&s.dialogWidth>0:s.kind==='copy-text'?text(s.value,Number.MAX_SAFE_INTEGER)&&text(s.body,60000)&&text(s.label,160):s.kind==='disclosure'?typeof s.open==='boolean':s.kind==='container'?['row','column','grid'].includes(s.layout)&&Number.isInteger(s.columns)&&s.columns>=1&&s.columns<=4&&Number.isInteger(s.gap)&&s.gap>=0&&s.gap<=120:s.kind==='heading'?Number.isInteger(s.level)&&s.level>=1&&s.level<=6:s.kind==='hero'?text(s.body,60000)&&(s.assetId===null||uuid(s.assetId))&&safeLink(s.href)&&text(s.label,160):s.kind==='gallery'?(s.viewer===undefined||typeof s.viewer==='boolean')&&Array.isArray(s.assetIds)&&s.assetIds.every(uuid)&&new Set(s.assetIds).size===s.assetIds.length&&[2,3,4].includes(s.columns):['text','callout'].includes(s.kind)?text(s.body,60000):s.kind==='link'?safeLink(s.href)&&text(s.label,160)&&text(s.body,60000):['divider','contents'].includes(s.kind)?true:s.kind==='asset'?(uuid(s.assetId)||tree&&s.assetId===null):s.kind==='media'?uuid(s.entryId)&&uuid(s.attachmentId):['inherit','grid','list','editorial'].includes(s.layout);
  });
}
export function validWebsiteComposition(site,extended=true,composed=true,rich=true,extendedText=true,tree=true,optionalHome=true){
  if(!object(site)||site.researchSources!==undefined&&!validPublicationSources(site.researchSources))return false;
  if(!(site.title===null||text(site.title,160))||!(site.description===null||text(site.description,1500)))return false;
  const h=site.home;
  return keys(h,['title','showTitle','sections',...(optionalHome?['enabled','introduction','templateLink'].filter(k=>Object.hasOwn(h??{},k)):[])])&&(!Object.hasOwn(h,'templateLink')||validTemplateLink(h.templateLink))&&(h.enabled===undefined||typeof h.enabled==='boolean')&&(h.introduction===undefined||text(h.introduction,1500))&&(h.title===null||text(h.title,160))&&typeof h.showTitle==='boolean'&&validSections(h.sections,extended,composed,rich,extendedText,tree);
}
export function linkAvailable(href,selection){
  const parsed=websiteLink(href);if(!parsed)return false;if(parsed.external||!parsed.target)return true;href=parsed.target;
  if(href==='home')return selection.homeEnabled!==false;
  if(/^https:\/\//i.test(href))return true;
  const [kind,id]=href.split(':');if(kind==='entry'&&selection.entryDestinations)return selection.entryDestinations.some(v=>v.id===id);return (selection[{project:'projects',notebook:'notebooks',page:'pages',entry:'entries'}[kind]]??[]).some(v=>v.id===id);
}
export function menuCanNest(items,target,parent){
  const seen=new Set([target]);let current=parent;
  while(current){if(seen.has(current)||seen.size>8)return false;seen.add(current);const item=items.find(i=>i?.target===current);if(!item)return false;current=item.parent;}return true;
}
export const validMenuParents=items=>items.every(item=>object(item)&&(item.parent===undefined||item.parent===null||typeof item.parent==='string')&&menuCanNest(items,item.target,item.parent));
