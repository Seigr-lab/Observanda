import {AppError} from './errors.js';
import {WebsiteFileContent} from './website-file-store.js';
import {websiteLocalURL} from './website-file-policy.js';
import {replaceWebsiteStyleURLs} from './website-page-dependencies.js';
import {portablePageDesign} from './website-page-designs.js';
import {REGION_SLOTS} from './website-region-model.js';
import {designMemberName} from './website-design-archive.js';
import {assertPublicFields} from './privacy.js';
import {websiteRecordingKind} from './website-recordings.js';
import {operationAdvance,operationTotal} from './operation-progress.js';

// A website design package carries how a site looks, never what it says: the
// site stylesheet, scoped themes, page styles with their fonts, layout ranges,
// components, the site's region slots and page designs, with the pictures and
// files they use. Nothing from a lab book enters it: files bound to a source
// or a feed, research markup and entry bindings stay out, and private (draft)
// components only travel when the author includes them.
export const designFormat='observanda-design',designVersion=1;
export const designPicture=/^pictures\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.png$/;
export const designResource=/\.(?:png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i;
export const designRecording=/^recordings\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:wav|mp4|vtt)$/;
export const researchMarkup=/data-observanda-|data-website-feed|data-website-source-gallery|data-website-entry-field|data-public-record|data-record-id/i;
const invalid=()=>{throw new AppError('INVALID');};
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function exportWebsiteDesign(store,siteId,{expectedRevision,includeDrafts=false,labels,blockedValues=[],signal}={}){
 if(!revision(expectedRevision)||typeof includeDrafts!=='boolean')invalid();
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision),files=new Map(manifest.files.map(f=>[f.name,f]));
  const resources=new Map(),omitted=[],texts=new Map();
  // Recordings and their captions travel only with the components that play them.
  const exportable=(name,draft,media=false)=>{
   const f=files.get(name);
   if(!f||f.sourceId||f.feedAsset||f.feedPage||f.themeSheet||f.tokenSheet||f.tokenFont||f.draft&&!draft&&!includeDrafts||!designMemberName('files/'+name))return null;
   if(f.recording)return media&&designRecording.test(name)&&websiteRecordingKind(f)?f:null;
   return (f.picture?designPicture.test(name):designResource.test(name)&&!name.startsWith('pictures/')&&!name.startsWith('recordings/'))?f:null;
  };
  const take=(names,draft=false,media=false)=>{
   const found=names.map(name=>exportable(name,draft,media));if(found.some(f=>!f))return false;
   for(const f of found)resources.set(f.name,f);return true;
  };
  // Components with their pictures, recordings and captions; without those that
  // hold research markup, private ones not chosen (named in the package so the
  // importer knows they exist) or a nested component that cannot travel.
  const mains=manifest.components??[],kept=new Map();
  for(const main of mains){
   if(main.draft&&!includeDrafts){omitted.push({kind:'component',name:main.name,reason:'private'});continue;}
   if(researchMarkup.test(main.html)||main.pictures.some(p=>!exportable(p.name,main.draft))||(main.recordings??[]).some(r=>!exportable(r.name,main.draft,true))){omitted.push({kind:'component',name:main.name,reason:'research'});continue;}
   kept.set(main.id,main);
  }
  for(let changed=true;changed;){
   changed=false;
   for(const main of kept.values())if((main.slots??[]).some(s=>s.type==='component'&&!kept.has(s.component))){
    kept.delete(main.id);changed=true;omitted.push({kind:'component',name:main.name,reason:'dependency'});
   }
  }
  const components=[...kept.values()].map(main=>{
   take(main.pictures.map(p=>p.name),main.draft);take((main.recordings??[]).map(r=>r.name),main.draft,true);
   return {id:main.id,name:main.name,html:main.html,...(main.css?{css:main.css}:{}),...(main.slots?.length?{slots:main.slots}:{}),...(main.variants?.length?{variants:main.variants}:{}),...(main.draft?{draft:true}:{})};
  });
  // Page styles and the custom fonts they use, with their rights and notices.
  const book=manifest.styleBook,fonts=[],fontIds=new Set();
  for(const font of book?.fonts??[]){
   const name='fonts/'+font.faces[0].file,file=files.get(name);
   if(!file?.tokenFont||file.sourceId||!designMemberName('files/'+name))continue;
   resources.set(name,file);fontIds.add(font.id);
   fonts.push({id:font.id,label:font.label,embed:font.embed,rights:font.rights,notice:font.notice,file:name});
  }
  const tokens=(book?.tokens??[]).filter(token=>{
   const ok=Object.values(token.rules).every(state=>!state['font-family']?.startsWith('custom-')||fontIds.has(state['font-family']));
   if(!ok)omitted.push({kind:'style',name:token.name,reason:'resource'});return ok;
  }).map(({id,classId,group,name,rules})=>({id,classId,group,name,rules}));
  const tokenIds=new Set(tokens.map(t=>t.id));
  const styles={tokens,site:(book?.site??[]).filter(id=>tokenIds.has(id))};
  // Page designs, live ones in the portable form a stored design keeps.
  const pageDesigns=[];
  for(const design of manifest.pageDesigns??[]){
   signal?.throwIfAborted();
   let portable;
   try{portable=await portablePageDesign(store,manifest,design,labels,signal);}
   catch(error){if(['NOT_FOUND','CONFLICT'].includes(error.code)&&!design.template)continue;throw error;}
   const {template,css,pictures}=portable;
   if(researchMarkup.test(template.content)||template.components.some(id=>!kept.has(id))||!take(pictures,true)){omitted.push({kind:'design',name:design.name,reason:researchMarkup.test(template.content)?'research':'dependency'});continue;}
   const member='page-designs/'+design.id+'.css';texts.set(member,css);
   pageDesigns.push({id:design.id,name:design.name,template:{...template,styleTokens:template.styleTokens.filter(id=>tokenIds.has(id))},stylesheet:member});
  }
  // The site stylesheet, with references to anything that cannot travel removed.
  const sheet=files.get(manifest.cssPath);let stylesheet=null;
  if(sheet&&!sheet.sourceId&&!sheet.feedAsset){
   const css=replaceWebsiteStyleURLs(await store.readText(sheet,{signal}),value=>{
    const name=websiteLocalURL(value,manifest.cssPath);
    if(name===null||!name)return undefined;
    return take([name])?undefined:'none';
   });
   texts.set('stylesheet.css',css);stylesheet={path:manifest.cssPath,file:'stylesheet.css'};
  }
  // Region slots that show a component in the package.
  const regions={};
  for(const slot of REGION_SLOTS){
   const entry=manifest.regions?.slots?.[slot];if(!entry)continue;
   if(kept.has(entry.component))regions[slot]={component:entry.component,settings:entry.settings};
   else omitted.push({kind:'region',name:slot,reason:'dependency'});
  }
  const design={format:designFormat,version:designVersion,name:manifest.name,created:new Date().toISOString(),
   stylesheet,breakpoints:manifest.breakpoints??null,themes:(manifest.themeBook?.items??[]).map(({id,name,values})=>({id,name,values})),
   styles,fonts,components,regions,pageDesigns,
   resources:[...resources.values()].map(f=>({name:f.name,file:'files/'+f.name,...(f.picture?{picture:true}:{}),...(f.recording?{recording:true,...(f.label?{label:f.label}:{})}:{})})).sort((a,b)=>a.name<b.name?-1:1),omitted};
  const json=JSON.stringify(design,null,1);
  // The canary: no research markup and no local paths or private values.
  for(const text of [json,...texts.values()])if(researchMarkup.test(text))throw new AppError('PRIVACY');
  assertPublicFields([{field:'design',value:design},...[...texts].map(([field,value])=>({field,value}))],blockedValues);
  const members=new Map([['design.json',Buffer.from(json)]]);
  for(const [name,text] of texts)members.set(name,Buffer.from(text));
  operationTotal(resources.size);
  for(const f of resources.values()){members.set('files/'+f.name,new WebsiteFileContent(store,siteId,manifest.revision,f));operationAdvance();}
  return {name:manifest.name,revision:manifest.revision,members};
 },{signal});
}
