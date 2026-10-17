import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {hasHomepage} from './web/website-layouts.js';
import {homeIntroduction} from './web/website-model.js';
import {publicationExcerpt} from './web/publication-card.js';
import {parseResearchReference,researchReference} from './web/research-reference.js';
import {publicationTargetSelector,publicationRecordText} from './publication-prose.js';
import {selectorAnchor} from './web/book-selectors.js';
import {PublicationLinks} from './publication-links.js';
import {PUBLIC_INDEX_ROWS,publicIndexPage} from './web/public-browse-pages.js';
import {PUBLIC_COLLECTION_ROWS,collectionPageFromPath} from './web/public-collection-pages.js';
import {publicationInputState,openPublicationInput,finishPublicationInput,publicationRecordIndexes} from './publication-input-reader.js';
import {publicationInputPlan,publicationPlanMedia} from './publication-edition-projection.js';
const ordinal=value=>String(value).padStart(16,'0');

// An encrypted temporary AVL tree preserves the existing locale comparator.
// Only a logarithmic traversal stack and one title row are live at a time.
async function titleOrder(rows,consume,{signal}={}){
 return withScratch(async work=>{
  let root=null;
  const height=async key=>key?(await work.get(key)).height:0;
  async function save(node){node.height=1+Math.max(await height(node.left),await height(node.right));await work.put(node.id,node);return node.id;}
  async function left(node){const next=await work.get(node.right);node.right=next.left;next.left=await save(node);return save(next);}
  async function right(node){const next=await work.get(node.left);node.left=next.right;next.right=await save(node);return save(next);}
  async function insert(key,value){
   signal?.throwIfAborted();if(!key){await work.put(value.id,{...value,left:null,right:null,height:1});return value.id;}
   const node=await work.get(key),cmp=value.title.localeCompare(node.title,'en')||(value.id<node.id?-1:value.id>node.id?1:0);
   if(!cmp)throw new AppError('PUBLICATION_IDENTITY');node[cmp<0?'left':'right']=await insert(node[cmp<0?'left':'right'],value);
   await save(node);const balance=await height(node.left)-await height(node.right);
   if(balance>1){const child=await work.get(node.left);if(await height(child.left)<await height(child.right))node.left=await left(child);return right(node);}
   if(balance< -1){const child=await work.get(node.right);if(await height(child.right)<await height(child.left))node.right=await right(child);return left(node);}return node.id;
  }
  for await(const row of rows)root=await insert(root,{id:row.id,title:row.title});
  let position=0;async function visit(key){if(!key)return;signal?.throwIfAborted();const node=await work.get(key);await visit(node.left);await consume(node.id,position++);await visit(node.right);}await visit(root);
 },{signal});
}
export async function publicationInputLink(input,href){
 const metadata=await input.metadata(),target=parseResearchReference(href);
 if(!target){if(typeof href!=='string')return null;if(href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href))return href;return await input.target(href.split('#')[0])?href:null;}
 if(target.kind==='workspace')return target.workspaceId===metadata.id&&target.id===metadata.id&&hasHomepage(metadata)?'home':null;
 const row=target.kind==='record'?await input.recordTarget(target):await input.collectionTarget(target);if(!row||target.revision&&row.revision!==target.revision)return null;
 const selector=publicationTargetSelector(row,target.selector);if(target.selector&&!selector)return null;
 return (target.kind==='record'?'entry':target.kind)+':'+row.id+(selector?'#'+selectorAnchor(selector):'');
}
async function retainLinks(workspace,input,builder,{signal}){
 const {config}=await new PublicationLinks(workspace).read(),issues=[],paths=new Set();
 for(const page of config.pages){
  signal?.throwIfAborted();const canonical=page.path.toLowerCase(),anchors=[],fragments=new Set(),match=/^(projects|notebooks|pages|entries)\/([a-f0-9-]{36})\.html$/.exec(canonical);
  let generated=canonical==='index.html'&&!!await input.target('home')||canonical==='browse.html'&&await input.recordCount()>0;
  if(match)generated=!!await input.target(({projects:'project',notebooks:'notebook',pages:'page',entries:'entry'}[match[1]])+':'+match[2]);
  const browse=publicIndexPage(canonical);if(browse!==null&&browse<Math.ceil(await input.recordCount()/PUBLIC_INDEX_ROWS))generated=true;
  const collection=collectionPageFromPath(canonical);if(collection?.page){const [kind,id]=collection.target.split(':');if(collection.page<Math.ceil(await input.recordCount({[kind+'Id']:id,historical:false})/PUBLIC_COLLECTION_ROWS))generated=true;}
  if(generated)issues.push({path:page.path,reason:'generatedPath'});
  if(paths.has(canonical))issues.push({path:page.path,reason:'ambiguousPath'});paths.add(canonical);
  for(const anchor of page.anchors){
   if(fragments.has(anchor.fragment))issues.push({path:page.path,fragment:anchor.fragment,reason:'ambiguousFragment'});fragments.add(anchor.fragment);
   const href=anchor.target?await publicationInputLink(input,researchReference(anchor.target)):null;
   if(!href)issues.push({path:page.path,fragment:anchor.fragment,reason:'unmappedTarget'});else anchors.push({fragment:anchor.fragment,label:anchor.label,href});
  }
  await builder.append('legacyPages',page.id,{id:page.id,path:page.path,title:page.title,anchors});
 }
 if(issues.length)throw new AppError('PUBLICATION_LINKS',issues.slice(0,100));
}
export async function finalizePublicationInput(workspace,id,input,{signal}={}){
 const state=publicationInputState(input),builder=state.builder,reader=await openPublicationInput(workspace,input,{signal}),metadata=await reader.metadata();
 // Title indexes contain only included destinations. Project-scoped title
 // order shares the global rank and therefore keeps the exact same comparator.
 for(const name of ['projects','notebooks','pages']){
  async function* rows(){for await(const {value} of builder.items(name)){if(name==='pages'&&!value.share||name==='notebooks'&&!await reader.recordCount({notebookId:value.id}))continue;yield value;}}
  await titleOrder(rows(),async(key,position)=>{
   const row=await builder.get(name,key),title=ordinal(position),indexes={title};
   if(name==='pages')indexes.shared='yes/';
   if(name==='notebooks'){indexes.included='yes/';indexes.project=row.projectId+'/';indexes.projectTitle=row.projectId+'/'+title;}
   await builder.upsert(name,key,row,{indexes});
  },{signal});
 }
 async function target(kind,row){const value={target:kind==='home'?'home':kind+':'+row.id,title:row.title,path:kind==='home'?'index.html':({entry:'entries',project:'projects',notebook:'notebooks',page:'pages'}[kind])+'/'+row.id+'.html',kind,id:kind==='home'?null:row.id};await builder.append('targets',value.target,value,{indexes:{kind:kind+'/'}});}
 if(hasHomepage(metadata))await target('home',{title:'Home'});
 for(const [name,kind] of [['projects','project'],['pages','page'],['notebooks','notebook']])for await(const row of reader.items(name))await target(kind,row);
 for await(const row of reader.records())await target('entry',row);
 async function menu(value){await builder.append('menu',value.target,value);}
 for await(const {value:setting} of builder.items('navigation')){const selected=await reader.target(setting.target);if(selected&&setting.show)await menu({target:selected.target,title:setting.label||selected.title,path:selected.path,parent:setting.parent??null});}
 for(const [name,kind] of [['home','home'],['projects','project'],['notebooks','notebook'],['pages','page']]){
  if(name==='home'){const row=await reader.target('home');if(row&&!await builder.get('navigation','home'))await menu({target:'home',title:row.title,path:row.path,parent:null});continue;}
  if(kind==='notebook')continue;for await(const row of reader.items(name)){const key=kind+':'+row.id;if(!await builder.get('navigation',key)){const selected=await reader.target(key);await menu({target:key,title:row.title,path:selected.path,parent:null});}}
 }
 let menuPosition=0;for await(const {key,value} of builder.items('menu')){const parent=value.parent&&await builder.get('menu',value.parent)?value.parent:null;await builder.upsert('menu',key,{...value,parent},{indexes:{parent:(parent??'root')+'/'+ordinal(menuPosition++)}});}
 let missing=0,missingRecords=0;
 for await(const {key,value:row} of builder.items('records')){
  signal?.throwIfAborted();const targets=[...row.relations.map(relation=>relation.target),...(row.references??[])],links=new Map();
  for(const reference of targets){const href=researchReference(reference);if(!links.has(href))links.set(href,await publicationInputLink(reader,href));}
  const count=[...links.values()].filter(value=>!value).length;
  if(count){missing+=count;missingRecords++;await builder.append('referenceReviews',row.id,{recordId:row.id,title:row.title,count});}
  for(const relation of row.relations){
   if(relation.target.kind!=='record'||!links.get(researchReference(relation.target)))continue;
   const selected=await reader.recordTarget(relation.target);if(!selected)continue;
   const backlinkKey=selected.id+'/'+row.id,prior=await builder.get('backlinks',backlinkKey),value={role:relation.role??'related',id:selected.id},relations=prior?.relations??[];
   if(!relations.some(item=>item.role===value.role&&item.id===value.id))relations.push(value);
   await builder.upsert('backlinks',backlinkKey,{recordId:row.id,relations},{indexes:{target:selected.id+'/'+ordinal((await builder.get('recordPositions',row.id)).position)}});
  }
  if(await builder.get('linkedCards',row.id)){
   const record=await reader.record(row.id),resolve=href=>links.get(href)??(/^(#|https?:|mailto:|tel:)/.test(href)?href:null),notebook=await builder.get('notebooks',row.notebookId),position=(await builder.get('recordPositions',row.id)).position;
   await builder.upsert('records',key,{...row,excerpt:publicationExcerpt(publicationRecordText(record.body,record,resolve))},{indexes:publicationRecordIndexes(row,position,notebook.projectId)});
  }
 }
 const projects=await reader.count('projects'),notebooks=await reader.count('notebooks'),pages=await reader.count('pages'),records=await reader.recordCount();
 const home=hasHomepage(metadata)?await publicationInputPlan(reader,'home',{signal}):null;
 if(!projects&&!pages&&!(home&&(homeIntroduction(metadata).trim()||home.groups.some(group=>group.sections.length))))throw new AppError('PUBLICATION_EMPTY');
 await retainLinks(workspace,reader,builder,{signal});
 for await(const row of reader.items('targets')){
  signal?.throwIfAborted();const plan=row.target==='home'?home:await publicationInputPlan(reader,row.target,{signal});
  for await(const media of publicationPlanMedia(reader,plan,{signal})){const prior=await builder.get('media',media.id);if(prior&&prior.kind!==media.kind)throw new AppError('MEDIA_INVALID');if(!prior)await builder.append('media',media.id,media);}
 }
 const hasSources=builder.count('sourceGroups')>1,hash=createHash('sha256');hash.update('[');let groupPosition=0,analysisCount=0,host=null;
 for await(const {value:group} of builder.items('sourceGroups')){if(groupPosition++)hash.update(',');hash.update(JSON.stringify([group.workspaceId,group.analysis.fingerprint]));analysisCount+=group.analysis.count;host??=group;}
 hash.update(']');const analysis={fingerprint:hasSources?hash.digest('hex'):host.analysis.fingerprint,count:analysisCount};
 if(hasSources!==state.header.hasSources)throw new AppError('JOB_DAMAGED');
 const researchReview={...state.header.researchReview,analysis,references:{count:missing,records:missingRecords}},summary={projects,notebooks,records,pages:pages+builder.count('legacyPages'),media:builder.count('media')};
 return finishPublicationInput(input,{summary,researchReview,hasSources},{signal});
}
