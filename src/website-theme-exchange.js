import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {serialize,digest} from './storage-format.js';
import {WebsiteEditorStore} from './website-editor-store.js';
import {websiteDocumentHeader} from './website-document-validation.js';
import {sameWebsitePin,validWebsitePin} from './web/website-pin.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {MediaPolicy} from './media-policy.js';
import {MediaStore} from './media.js';
import {WorkspaceFonts,inspectUploadedFont} from './workspace-fonts.js';
import {MAX_FONT_BYTES} from './font-inspector.js';
import {BUNDLED_FONTS,customFontId,validCustomFont} from './web/font-catalogue.js';
import {bundledFonts,isBundledFont} from './fonts.js';
import {assertPublicFields,assertPublicFiles} from './privacy.js';
import {contentBuffer,contentStream,contentSize,contentHash} from './file-content.js';
import {validWebsiteTheme,validWebsiteThemeOperation,themeReferences,WEBSITE_THEME_MANIFEST_LIMIT} from './web/website-theme-model.js';
import {websiteThemeRemapper,captureWebsiteTheme} from './website-theme-package.js';
import {WebsiteThemeResources,themeDigest} from './website-theme-resources.js';
const invalid=()=>{throw new AppError('INVALID');},conflict=()=>{throw new AppError('CONFLICT');};
export const WEBSITE_THEME_STAGE_LIFETIME=24*60*60*1000;
const stagePrefix='website-theme-stage:',stageSlot=stage=>stagePrefix+String(stage.createdAt).padStart(16,'0')+':'+stage.id;
const appliedSlot=id=>'website-theme-applied:'+id;
const librarySlot='metadata:.observanda/fonts/library.json',fontSlot=id=>'metadata:.observanda/fonts/'+id+'.json';
function validTarget(v){return v&&[null,undefined].includes(v.websiteId)||researchId(v?.websiteId);}
function admission(v){if(!v||!validTarget(v)||!researchId(v.workspaceId)||!validWebsitePin(v.websitePin)||v.websitePin.websiteId!==(v.websiteId??null)||v.draftId!=null&&!researchId(v.draftId)||v.draftId!=null&&!revisionId(v.draftRevision)||v.draftId==null&&v.draftRevision!=null)invalid();}
function review(stage){
 const refs=themeReferences(stage.manifest),r=stage.manifest;
 return {id:stage.id,sha256:themeDigest(r),ready:true,name:r.name,templates:r.templates.map(t=>({id:t.id,name:t.name})),regions:(r.design.regions?.definitions??[]).map(v=>({id:v.id,name:v.name})),assets:r.assets.length,fonts:r.fonts.length,bytes:r.resources.reduce((n,v)=>n+v.size,0),links:[...refs.links],systemFonts:[...refs.fonts].filter(id=>['modern','editorial'].includes(id)),authoredContent:r.templates.length>0||Boolean(r.design.regions?.definitions.length),blockers:[]};
}
export class WebsiteThemeExchange{
 constructor(workspace,{blockedValues=[],check=async()=>{}}={}){this.workspace=workspace;this.blockedValues=blockedValues;this.check=check;this.resources=new WebsiteThemeResources(workspace);}
 async register(stage){return this.workspace.withLock(()=>this.workspace.catalogue(store=>store.putObject(stageSlot(stage),{version:1,id:stage.id,createdAt:stage.createdAt})));}
 async removeStage(stage,store){const applied=await store.object(appliedSlot(stage.id));await this.resources.remove(stage,{removeImported:!applied});await store.deleteObject(stageSlot(stage));await store.deleteObject(appliedSlot(stage.id));}
 async prune({now=Date.now(),signal}={}){await this.check();return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{const page=await store.objectPage(stagePrefix,{limit:8});let removed=0;for(const row of page.items){signal?.throwIfAborted();const value=row.value;if(value?.version!==1||!researchId(value.id)||!Number.isSafeInteger(value.createdAt)||row.id!==stageSlot(value))invalid();if(now-value.createdAt<WEBSITE_THEME_STAGE_LIFETIME)break;let stage;try{stage=await this.resources.read(value.id);}catch(error){if(error.code!=='ENOENT')throw error;stage={...value,resources:[]};}if(stage.createdAt!==value.createdAt)invalid();await this.check();await this.removeStage(stage,store);removed++;}return removed;}));}
 async target(value,{signal}={}){admission(value);await this.check();return this.workspace.catalogue(async store=>{const editor=new WebsiteEditorStore(store),registry=await editor.documents.registry();if(registry.workspaceId!==value.workspaceId)conflict();const context=await editor.context(value.websiteId??null,{websitePin:value.websitePin,draftId:value.draftId,draftRevision:value.draftRevision,signal});return {...value,root:context.document.root};});}
 async current(target,{signal}={}){const now=await this.target(target,{signal});if(now.root!==target.root)conflict();return now;}
 async prepare(value,{signal}={}){
  await this.prune({signal});const target=await this.target(value,{signal}),blockers=[],sources=new Map();
  const captured=await this.workspace.catalogue(async store=>{const editor=new WebsiteEditorStore(store),context=await editor.context(target.websiteId??null,{...target,signal}),header=await websiteDocumentHeader(context.document,{signal});const result=await captureWebsiteTheme(header,value,async link=>(await import('./website-template-inheritance.js')).exportWebsiteTemplateBinding(context.document,link,{signal}));
   for(const id of result.references.assets){const row=await editor.sourceItem(context,'assets',id,{signal});if(!row||row.value.kind==='file')blockers.push('A selected design asset is missing or is an original download.');else result.value.assets.push(row.value);}return result;});
  blockers.push(...themeReferences(captured.value).blocked);
  try{assertPublicFields([{field:'Theme design and selected authored content',value:captured.value}],this.blockedValues);}catch(error){if(error.code!=='PRIVACY')throw error;blockers.push('Selected authored content contains private information.');}
  for(const a of captured.value.assets){try{await this.check();const media=await new MediaStore(this.workspace).get(a.id,{streamed:true,signal});if(media.kind!==a.kind)invalid();assertPublicFiles(new Map([['media/'+a.id+'.'+media.extension,media.bytes]]),this.blockedValues);sources.set(a.id,{kind:a.kind,name:'asset.'+media.extension,content:media.bytes});}catch(error){signal?.throwIfAborted();if(!['NOT_FOUND','ENOENT','MEDIA_INVALID','INVALID'].includes(error.code))throw error;blockers.push('A selected design asset is unavailable or damaged.');}}
  const mapper=websiteThemeRemapper(),fontDefinitions=[];
  for(const id of captured.references.fonts){signal?.throwIfAborted();await this.check();if(['modern','editorial'].includes(id))continue;
   if(customFontId(id)){try{const font=await new WorkspaceFonts(this.workspace).get(id);if(!font.embed||font.restricted)throw new AppError('FONT_EMBED');const name=font.faces[0].file;assertPublicFiles(new Map([['fonts/'+name,font.bytes]]),this.blockedValues);const key=mapper.owner('font:'+id);sources.set(key,{kind:'font',name:'font.'+name.split('.').at(-1),content:font.bytes});fontDefinitions.push({id,resources:[key]});}catch(error){signal?.throwIfAborted();if(!['FONT_EMBED','FONT_INVALID','FONT_MISSING','PRIVACY','ENOENT'].includes(error.code))throw error;blockers.push('A required font is missing, cannot be embedded, or contains private metadata.');}}
   else{const font=BUNDLED_FONTS.find(f=>f.id===id);if(!font){blockers.push('A required font is unavailable.');continue;}const ids=[];for(const name of [...font.faces.map(f=>f.file),font.license]){const key=mapper.owner('bundled:'+name);ids.push(key);sources.set(key,{kind:name===font.license?'font-license':'font',name,content:Buffer.from(bundledFonts.get('fonts/'+name))});}fontDefinitions.push({id,resources:ids});}
  }
  if(blockers.length)return {ready:false,blockers:[...new Set(blockers)]};
  captured.value.fonts=fontDefinitions;captured.value.resources=[...sources].map(([id,r])=>({id,kind:r.kind,name:r.name,size:contentSize(r.content),sha256:contentHash(r.content)}));
  const manifest=mapper.remap(captured.value);if(!validWebsiteTheme(manifest))invalid();if(Buffer.byteLength(JSON.stringify(manifest))>WEBSITE_THEME_MANIFEST_LIMIT)throw new AppError('LIMIT');
  const stage=await this.resources.create({mode:'export',target,manifest},{register:stage=>this.register(stage)});
  try{for(const [id,r] of sources){const exported=captured.value.assets.some(a=>a.id===id)?mapper.asset(id):mapper.owner(id);await this.resources.add(stage,exported,contentStream(r.content),{size:contentSize(r.content),sha256:contentHash(r.content),signal,check:this.check});}await this.current(target,{signal});return review(stage);}
  catch(error){await this.discard({id:stage.id,sha256:themeDigest(manifest)});throw error;}
 }
 async export(value,{signal}={}){
  await this.check();const stage=await this.resources.read(value.id,value.sha256);if(stage.mode!=='export')invalid();
  // Authenticate the retained review, while requiring its website still exists.
  // Later draft edits do not change the staged design or its resources.
  await this.workspace.catalogue(async store=>{await new WebsiteEditorStore(store).documents.head(stage.target.websiteId??null);});
  await this.current(stage.target,{signal});return {name:stage.manifest.name,stream:this.resources.stream(stage,{signal,check:this.check})};
 }
 async import(source,target,{signal}={}){
  await this.prune({signal});const admitted=await this.target(target,{signal}),policy=(await new MediaPolicy(this.workspace).read()).policy,stage=await this.resources.receive(source,admitted,{signal,check:this.check,maxResourceBytes:policy.maxUploadBytes,reserveBytes:policy.reserveBytes,register:stage=>this.register(stage)});
  try{assertPublicFields([{field:'Theme design and selected authored content',value:stage.manifest}],this.blockedValues);await this.validateFonts(stage,{signal});await this.current(admitted,{signal});return review(stage);}
  catch(error){await this.discard({id:stage.id,sha256:themeDigest(stage.manifest)});if(['FONT_EMBED','FONT_INVALID','FONT_MISSING','PRIVACY'].includes(error.code))return {ready:false,blockers:['The package contains a font or authored content that cannot be shared safely.']};throw error;}
 }
 async validateFonts(stage,{signal}={}){
  stage.fonts=[];for(const font of stage.manifest.fonts){await this.check();const bundled=BUNDLED_FONTS.find(f=>f.id===font.id);
   if(bundled){const expected=[...bundled.faces.map(f=>f.file),bundled.license];if(font.resources.length!==expected.length)invalid();for(const id of font.resources){const r=stage.manifest.resources.find(v=>v.id===id);if(!expected.includes(r.name)||!isBundledFont('fonts/'+r.name,await contentBuffer(this.resources.content(stage,r))))throw new AppError('FONT_INVALID');expected.splice(expected.indexOf(r.name),1);}continue;}
   const r=stage.manifest.resources.find(v=>v.id===font.resources[0]);if(r.size>MAX_FONT_BYTES)throw new AppError('FONT_INVALID');const bytes=await contentBuffer(this.resources.content(stage,r)),info=await inspectUploadedFont(bytes,{signal});if(info.restricted)throw new AppError('FONT_EMBED');const id='custom-'+info.sha256;assertPublicFiles(new Map([['fonts/'+id+'.'+info.extension,bytes]]),this.blockedValues);
   const entry={id,label:info.label,embed:true,restricted:false,hidden:false,faces:[{file:id+'.'+info.extension,style:info.style,weight:info.weight,axes:info.axes}]};if(!validCustomFont(entry))throw new AppError('FONT_INVALID');stage.fonts.push({from:font.id,resourceId:r.id,entry});
  }await this.resources.save(stage);
 }
 async discard({id,sha256}){await this.check();return this.workspace.withLock(async()=>{const stage=await this.resources.read(id,sha256);await this.check();await this.workspace.catalogue(store=>this.removeStage(stage,store));});}
}
export async function applyWebsiteTheme(context,operation,{store,signal}={}){
 if(!validWebsiteThemeOperation(operation))invalid();const workspace=store.workspace,resources=new WebsiteThemeResources(workspace),stage=await resources.read(operation.id,operation.sha256);
 if(stage.mode!=='import'||!stage.manifest||stage.target.root!==context.document.root||!sameWebsitePin(stage.target.websitePin,context.websitePin)||stage.target.workspaceId!==context.head?.workspaceId||stage.target.draftId!=null&&(stage.target.draftId!==context.head?.id||stage.target.draftRevision!==digest(serialize(context.head)))||stage.target.draftId==null&&context.head?.generation!==0)conflict();
 const applied=await store.object(appliedSlot(stage.id));if(applied)conflict();
 const current=(await websiteDocumentHeader(context.document,{signal})).document.website,pkg=stage.manifest;
 if((current.templates?.length??0)+pkg.templates.length>100||(current.design.regions?.definitions.length??0)+(pkg.design.regions?.definitions.length??0)>100)throw new AppError('LIMIT');
 const fonts=JSON.parse((await store.object(librarySlot))?.text??'[]');if(!Array.isArray(fonts)||fonts.some(f=>!validCustomFont(f)))throw new AppError('FONT_INVALID');
 for(const f of stage.fonts??[]){const existing=fonts.find(v=>v.id===f.entry.id);if(existing&&(existing.restricted||!existing.embed||existing.hidden))throw new AppError('FONT_EMBED');if(!existing){if(fonts.length>=64)throw new AppError('FONT_LIMIT');fonts.push(f.entry);}}
 stage.imported??=[];
 for(const asset of pkg.assets){signal?.throwIfAborted();if(stage.imported.some(v=>v.from===asset.id))continue;const r=stage.resources.find(v=>v.id===asset.id),saved=await new MediaStore(workspace).import(resources.content(stage,r).stream(),asset.kind,{signal});stage.imported.push({from:asset.id,...saved});await resources.save(stage);}
 const mapper=websiteThemeRemapper({assetIds:new Map(stage.imported.map(a=>[a.from,a.id])),fontIds:new Map((stage.fonts??[]).map(f=>[f.from,f.entry.id]))}),mapped=mapper.remap(pkg);
 for(const f of stage.fonts??[]){const r=stage.resources.find(v=>v.id===f.resourceId),bytes=await contentBuffer(resources.content(stage,r));await store.putObject(fontSlot(f.entry.id),{text:JSON.stringify({bytes:bytes.toString('base64')})});}
 if(stage.fonts?.length)await store.putObject(librarySlot,{text:JSON.stringify(fonts)});
 const definitions=[...(current.design.regions?.definitions??[]),...(mapped.design.regions?.definitions??[])],replacing=new Set((mapped.design.regions?.assignments??[]).map(a=>a.target+'/'+a.kind));
 const design={...mapped.design,regions:{definitions,assignments:[...(current.design.regions?.assignments??[]).filter(a=>!replacing.has(a.target+'/'+a.kind)),...(mapped.design.regions?.assignments??[])]}};
 const presentation={...current.presentation,media:[...(current.presentation?.media??[]),...mapped.presentation.media],covers:current.presentation?.covers??[]},templates=[...(current.templates??[])];
 for(const t of mapped.templates){const {binding,...value}=t;if(binding)value.templateLink=await (await import('./website-template-inheritance.js')).retainImportedWebsiteTemplateBinding(context,binding,{signal});templates.push(value);}
 for(const [key,value] of Object.entries({design,presentation,templates,palette:mapped.palette,typography:mapped.typography}))context.document=await context.document.replace(['document','website',key],value,{signal});
 context.document=await context.document.replace(['document','appearance'],mapped.appearance,{signal});context.document=await context.document.replace(['document','activeThemeId'],null,{signal});
 if(mapped.assets.length){const at=await context.document.tree.arrayLength(context.document.root,['document','website','assets']);context.document=await context.document.splice(['document','website','assets'],at,0,mapped.assets,{signal});}
 await store.putObject(appliedSlot(stage.id),{version:1,websiteId:context.head.websiteId,sha256:operation.sha256});
}
