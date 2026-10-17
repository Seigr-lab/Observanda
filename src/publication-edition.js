import {buildIndexedPublicationEdition} from './publication-edition-renderer.js';
import {publicationPresentationReader,publicationBrandingTargets} from './publication-input-presentation.js';
import {readPublicationPage} from './publication-input-pages.js';
import {publicationPageRecord} from './publication-owner-projection.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {readPublicationRecord} from './publication-input.js';
import {projectPublication} from './publication-projection.js';
import {renderPublication} from './publication.js';
import {publicationPage} from './publication-page.js';
import {selectedContent,publicSections,sectionItems} from './web/website-model.js';
import {resolveRegion,REGION_SLOTS} from './web/website-regions.js';
import {compareRecordDates} from './web/record-date.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {publicationInputMedia} from './publication-input-media.js';
import {contentHash,contentSize} from './file-content.js';
import {selectEditionRecord} from './web/publication-selection.js';
import {publicationCollectionWindows} from './publication-collection-pages.js';

// Public selection has already been pinned. Only originals drawn on this page
// are loaded; cards, destinations and reverse links use selected descriptors.
async function pageContext(workspace,source,selection,target,{signal,bodyWindow,metadata}){
 const rows=source.records,needed=new Set(),cards=new Set(),[kind,id]=target.split(':');
 if(kind==='page'&&source.version>=4){
  const page=metadata.pages.find(value=>value.id===id);
  selection={...selection,pages:selection.pages.map(value=>value.id===id?page:value)};
 }
 const layout=metadata.website.layouts.find(l=>l.target===target),original=layout?.placement!=='replace';
 if(kind==='entry')needed.add(id);
 const sources=[layout?.sections??[],...REGION_SLOTS.map(kind=>resolveRegion(metadata.website,target,kind)?.sections??[]),
  original?(target==='home'?metadata.website.home.sections:kind==='page'?metadata.pages.find(p=>p.id===id).sections:[]):[]];
 for(const sections of sources)for(const section of publicSections(sections,selection)){
  if(section.kind==='media')needed.add(section.entryId);
  if(section.kind==='records')for(const record of sectionItems(section,selection))cards.add(record.id);
 }
 if(original&&['project','notebook'].includes(kind)){
  for(const id of bodyWindow.recordIds)cards.add(id);
 }
 const entries=[];
 for(const row of rows)if(needed.has(row.id)){signal.throwIfAborted();entries.push(publicationPageRecord(selectEditionRecord(await readPublicationRecord(workspace,source,row),row.selection),row));}
 const recordCards=rows.filter(r=>cards.has(r.id)).map(({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments})=>({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments}));
 return projectPublication(metadata,{...selection,entries,recordCards},{publicationTarget:target,entryDestinations:rows,...(bodyWindow?{collectionPages:[bodyWindow]}:{}),edition:{version:1,records:rows.flatMap(r=>r.selection?[{...r.selection,id:r.id}]:[]),availability:source.availability??[]}});
}

function* collectionWindows(source,selection,target,metadata){
 const [kind,id]=target.split(':'),layout=metadata.website.layouts.find(l=>l.target===target);
 if(!['project','notebook'].includes(kind)||layout?.placement==='replace'){yield null;return;}
 const notebooks=new Set(kind==='notebook'?[id]:selection.notebooks.filter(n=>n.projectId===id).map(n=>n.id));
 const rows=source.records.filter(row=>!row.historical&&notebooks.has(row.notebookId)).sort((a,b)=>compareRecordDates(a,b,{descending:true})||a.id.localeCompare(b.id,'en'));
 yield* publicationCollectionWindows(rows,target);
}

export async function buildPublicationEdition(workspace,source,{blockedValues=[],signal,progress,retain,writer}){
 if(source.version===6)return buildIndexedPublicationEdition(workspace,source,{blockedValues,signal,progress,writer});
 const presentation=source.version===5?publicationPresentationReader(workspace,source):null;
 const pageInputs=new Map((source.pageInputs??[]).map(row=>[row.id,row]));
 const selection=selectedContent({...source.metadata,entries:source.records.map(r=>({...r,attachments:r.media}))});
 if(source.version>=4)selection.pages=selection.pages.map(page=>{const row=pageInputs.get(page.id);return {...page,excerpt:row.excerpt,hasBody:row.hasBody};});
 // The descriptor's card contains only shared image captions and alt text.
 // Selection's attachment IDs also admit explicitly chosen research-media blocks.
 const targets=[...(selection.homeEnabled?['home']:[]),...selection.projects.map(p=>'project:'+p.id),...selection.pages.map(p=>'page:'+p.id),
  ...selection.notebooks.map(n=>'notebook:'+n.id),...[...source.records].sort((a,b)=>compareRecordDates(a,b,{descending:true})||a.id.localeCompare(b.id,'en')).map(r=>'entry:'+r.id)];
 const files=new Map(),pages=[],fontRules=new Set(),richRules=new Set(),blockRules=new Set();let commonStyles=null,completed=0;
 const keep=async(name,content)=>{
  if(files.has(name)){const existing=files.get(name);if(existing.sha256!==contentHash(content)||existing.bytes!==contentSize(content))throw new AppError('STALE');return;}
  await retain(name,content);files.set(name,{path:name,bytes:contentSize(content),sha256:contentHash(content)});
 };
 const media=publicationInputMedia(workspace,source),fonts=new WorkspaceFonts(workspace);
 for(const target of targets){
  // One target's originals survive only its continuation pages. Later targets
  // reopen their own immutable values; the source stays body-free.
  let metadata=source.metadata;
  if(source.version===5){const layout=await presentation.layout(target,{signal});metadata={...metadata,website:{...metadata.website,layouts:layout?[layout]:[]}};}
  if(source.version>=4&&target.startsWith('page:')){const page=await readPublicationPage(workspace,source,target.slice(5),{signal});metadata={...metadata,pages:metadata.pages.map(value=>value.id===page.id?page:value)};}
  if(source.version===5){const branding=[];for(const key of publicationBrandingTargets(metadata,target,selection)){const value=await presentation.branding(key,{signal});if(value)branding.push(value);}metadata={...metadata,branding};}
  for(const bodyWindow of collectionWindows(source,selection,target,metadata)){
   signal.throwIfAborted();const context=await pageContext(workspace,source,selection,target,{signal,bodyWindow,metadata}),plan=publicationPage(context,target),mediaFiles=new Map();
   for(const [id,kind] of plan.media){signal.throwIfAborted();const file=await media.get(id,{streamed:true});if(file.kind!==kind)throw new AppError('MEDIA_INVALID');mediaFiles.set(id,file);}
   if(completed===0&&!(bodyWindow?.staticPage.page))context.legacyPages=source.legacyPages??[];
   const fontFiles=await fonts.files(plan.fonts,{signal}),page=renderPublication(context,{blockedValues,mediaFiles,fontFiles,emitBrowse:pages.length===0});
   if(commonStyles!==null&&commonStyles!==page.styles.common)throw new AppError('JOB_DAMAGED');commonStyles=page.styles.common;
   fontRules.add(page.styles.fonts);richRules.add(page.styles.rich);for(const rule of page.styles.blocks)blockRules.add(rule);
   for(const [name,content] of page.files)if(!['styles.css','publication.json','.nojekyll'].includes(name)){signal.throwIfAborted();await keep(name,content);}
   // Continuation files and the record index are not additional authored page
   // choices. Report work within the target without exceeding the target total.
   pages.push(...page.pages);await progress({stage:'Building selected pages',done:completed,total:targets.length});
  }
  await progress({stage:'Building selected pages',done:++completed,total:targets.length});
 }
 pages.sort((a,b)=>Number(a.path==='browse.html')-Number(b.path==='browse.html'));
 await keep('styles.css',commonStyles+'\n'+[...fontRules,...richRules,...blockRules].join('\n'));
 await keep('.nojekyll','');
 const generator='Observanda 0.3.0-dev',payload=[...files.values()],id=digest(JSON.stringify({generator,files:payload}));
 const entries=source.records.map(({id,title})=>({id,title})),projects=selection.projects.map(({id,title})=>({id,title}));
 await keep('publication.json',serialize({formatVersion:2,generator,releaseId:id,projects:projects.map(p=>p.id),entries:entries.map(e=>e.id),files:payload}));
 return {id,pages,entries,projects,defaultPage:pages[0]?.path??null};
}
