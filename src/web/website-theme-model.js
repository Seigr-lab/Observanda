import {researchId} from './research-reference.js';
import {validAppearance} from './themes.js';
import {validSections,validSiteLayout} from './website-model.js';
import {validPalette,validTypography} from './website-typography.js';
import {validPresentation} from './media-presentation.js';
import {validWebsiteAsset} from './website-item-validation.js';
import {customFontId,validFont} from './font-catalogue.js';
export const WEBSITE_THEME_MIME='application/vnd.observanda.website-theme';
export const WEBSITE_THEME_MAGIC='OBSERVANDA-WEBSITE-THEME/1\n';
export const WEBSITE_THEME_MANIFEST_LIMIT=64*1024*1024;
export const themeHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const name=v=>typeof v==='string'&&v.trim().length>0&&v.length<=160&&!/[\u0000-\u001f]/.test(v);
export const validWebsiteThemeOperation=v=>exact(v,['type','id','sha256'])&&v.type==='theme-apply'&&researchId(v.id)&&themeHash(v.sha256);
export function themeReferences(value){
 const assets=new Set(),fonts=new Set(),links=new Set(),blocked=[];
 function visit(v){
  if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(visit);return;}
  if(v.type?.startsWith('book_'))blocked.push('Selected rich text contains a research block.');
  if(v.kind==='media'||v.kind==='download')blocked.push('Research media and original downloads cannot be included in a theme.');
  if(v.filter&&(v.filter.projectId!==null||v.filter.tag))blocked.push('A selected element filters a particular research source.');
  for(const [key,part] of Object.entries(v)){
   if(key==='id'&&(v.scope||v.sectionId))assets.add(part);else if(key==='assetId'&&part)assets.add(part);else if(key==='assetIds')for(const id of part??[])assets.add(id);
   else if(['font','headingFont'].includes(key)&&typeof part==='string')fonts.add(part);
   else if(['href','link'].includes(key)&&typeof part==='string'&&part){if(/^(?:(?:project|notebook|entry|page):|observanda:)/i.test(part))blocked.push('A selected element links to content in this website or workspace.');else links.add(part);}
   else if(typeof part==='string'&&/(?:(?:project|notebook|entry|page):[a-f0-9-]{36}|observanda:\/\/)/i.test(part))blocked.push('Selected authored text contains a workspace or page reference.');
   else visit(part);
  }
 }
 visit(value);return {assets,fonts,links,blocked:[...new Set(blocked)]};
}
export function validWebsiteTheme(value){
 if(!exact(value,['format','version','name','appearance','palette','typography','design','templates','presentation','assets','fonts','resources'])||value.format!=='observanda-website-theme'||value.version!==1||!name(value.name)||!validAppearance(value.appearance)||!validPalette(value.palette)||!validTypography(value.typography)||!validSiteLayout(value.design)||!validPresentation(value.presentation)||value.presentation.covers.length)return false;
 if(!Array.isArray(value.templates)||value.templates.length>100||new Set(value.templates.map(t=>t?.id)).size!==value.templates.length)return false;
 const templates=new Map(value.templates.map(t=>[t?.id,t]));
 for(const t of value.templates){
  if(!exact(t,['id','name','sections',...(t?.binding?['binding']:[])])||!researchId(t.id)||!name(t.name)||!validSections(t.sections))return false;
  if(t.binding){const b=t.binding;if(!exact(b,['templateId','sectionIds','baseline'])||!templates.has(b.templateId)||!exact(b.baseline,['sections','media'])||!validSections(b.baseline.sections)||!Array.isArray(b.baseline.media)||!Array.isArray(b.sectionIds))return false;
   const ids=new Set(b.baseline.sections.map(s=>s.id));if(b.sectionIds.length!==ids.size||new Set(b.sectionIds.map(r=>r?.templateId)).size!==ids.size||new Set(b.sectionIds.map(r=>r?.pageId)).size!==ids.size||b.sectionIds.some(r=>!exact(r,['templateId','pageId'])||!ids.has(r.templateId)||typeof r.pageId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(r.pageId)))return false;
   if(!validPresentation({media:b.baseline.media.map(m=>{const {sectionId,...rest}=m;return {...rest,scope:'template:'+b.templateId+'#'+sectionId};}),covers:[]}))return false;
  }
  const seen=new Set([t.id]);let p=t.binding?.templateId;while(p){if(seen.has(p))return false;seen.add(p);p=templates.get(p)?.binding?.templateId;}
 }
 const regions=value.design.regions??{definitions:[],assignments:[]};if(regions.assignments.some(a=>!['*','home'].includes(a.target)))return false;
 if(!Array.isArray(value.assets)||value.assets.length>20000||value.assets.some(a=>!validWebsiteAsset(a)||a.kind==='file')||new Set(value.assets.map(a=>a.id)).size!==value.assets.length)return false;
 if(!Array.isArray(value.fonts)||value.fonts.length>256||value.fonts.some(f=>!exact(f,['id','resources'])||!validFont(f.id)||!Array.isArray(f.resources)||!f.resources.length||f.resources.some(r=>!researchId(r)))||new Set(value.fonts.map(f=>f.id)).size!==value.fonts.length)return false;
 if(!Array.isArray(value.resources)||value.resources.length>21000||new Set(value.resources.map(r=>r?.id)).size!==value.resources.length||value.resources.some(r=>!exact(r,['id','kind','name','size','sha256'])||!researchId(r.id)||!['image','audio','video','font','font-license'].includes(r.kind)||typeof r.name!=='string'||!r.name||r.name.length>160||/[\/\\\u0000-\u001f]/.test(r.name)||!Number.isSafeInteger(r.size)||r.size<1||!themeHash(r.sha256)))return false;
 const resources=new Map(value.resources.map(r=>[r.id,r])),assetIds=new Set(value.assets.map(a=>a.id)),refs=themeReferences(value);
 if(refs.blocked.length||[...refs.assets].some(id=>!assetIds.has(id))||value.assets.some(a=>!refs.assets.has(a.id)||resources.get(a.id)?.kind!==a.kind))return false;
 const used=new Set(assetIds);for(const font of value.fonts){if(!refs.fonts.has(font.id))return false;for(const id of font.resources){const r=resources.get(id);if(!r||!['font','font-license'].includes(r.kind))return false;used.add(id);}if(customFontId(font.id)&&(font.resources.length!==1||resources.get(font.resources[0]).kind!=='font'))return false;}
 if([...refs.fonts].some(id=>!['modern','editorial'].includes(id)&&!value.fonts.some(f=>f.id===id))||used.size!==resources.size)return false;
 const scopes=new Map([...value.templates.map(t=>['template:'+t.id,new Set(t.sections.map(s=>s.id))]),...regions.definitions.map(r=>['region:'+r.id,new Set(r.sections.map(s=>s.id))])]);
 return value.presentation.media.every(m=>{const [scope,sectionId]=m.scope.split('#');return scopes.get(scope)?.has(sectionId)&&assetIds.has(m.id);})&&value.templates.every(t=>!t.binding||t.binding.baseline.media.every(m=>assetIds.has(m.id)&&t.binding.baseline.sections.some(s=>s.id===m.sectionId)));
}
