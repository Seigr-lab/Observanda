import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {AppError} from '../src/errors.js';
import {digest,serialize} from '../src/storage-format.js';
import {createPublicationInput,publicationInputState,finishPublicationInput,openPublicationInput} from '../src/publication-input-reader.js';
import {retainWebsitePublicationCollections} from '../src/publication-capture-website.js';
const page=(title,share=true)=>({id:randomUUID(),title,share,body:'Exact '+title+' original',sections:[]});
function memory(){
 const files=new Map(),reads=[];
 return {websiteId:null,files,reads,async readMetadata(file,limit){reads.push(file);const raw=files.get(file)??null;if(raw!==null&&Buffer.byteLength(raw)>limit)throw new AppError('LIMIT');return raw;},async writeMetadata(file,raw){assert.equal(files.has(file),false);files.set(file,raw);}};
}
async function fixture({missingPage=false,foreignGroups=0,invalidGroup=false}={}){
 const workspace=memory(),book=createNotebook('Retained collection fixture'),{entries,...metadata}=book;void entries;
 metadata.website.home.enabled=false;const pages=[page('Zulu'),page('Alpha'),page('Private',false)];metadata.pages=pages;
 metadata.website.layouts=[{target:'page:'+pages[0].id,showHeading:true,heading:'Exact selected heading',description:'',placement:'before',sections:[]}];metadata.branding=[{target:'page:'+pages[0].id,logos:[]}];
 metadata.website.presentation.media=[{scope:'page:'+pages[0].id+'#picture',id:randomUUID(),caption:'Pinned caption',alt:'',link:''}];
 const id=randomUUID(),input=createPublicationInput(workspace,id,metadata),{builder}=publicationInputState(input);
 await retainWebsitePublicationCollections(workspace,builder,id,metadata);
 let rank=0;for(const value of [...pages.filter(row=>row.share)].sort((a,b)=>a.title.localeCompare(b.title,'en'))){const label=await builder.get('pages',value.id);await builder.upsert('pages',value.id,label,{indexes:{shared:'yes/',title:String(rank++).padStart(16,'0')}});}
 for(const value of pages.filter(row=>row.share))await builder.append('targets','page:'+value.id,{target:'page:'+value.id,title:value.title,path:'pages/'+value.id+'.html',kind:'page',id:value.id},{indexes:{kind:'page/'}});
 const fingerprint=digest('[]'),groups=[[metadata.id,fingerprint]];await builder.append('sourceGroups',metadata.id,{workspaceId:metadata.id,snapshotId:null,analysis:{fingerprint,count:0}});
 for(let index=0;index<foreignGroups;index++){const workspaceId=randomUUID();groups.push([workspaceId,fingerprint]);await builder.append('sourceGroups',workspaceId,{workspaceId,snapshotId:invalidGroup&&index===foreignGroups-1?null:digest(workspaceId),analysis:{fingerprint,count:0}});}
 const fields={hasSources:foreignGroups>0,summary:{projects:0,notebooks:0,records:0,pages:2,media:0},researchReview:{retainedFigures:0,changedInputs:0,editedFigures:0,analysis:{fingerprint:foreignGroups?digest(JSON.stringify(groups)):fingerprint,count:0},references:{count:0,records:0}}};
 if(missingPage)builder.collections.pageInputs.count=1;
 const retained=await finishPublicationInput(input,fields),source={version:6,id,reviewId:digest(id),workspaceId:metadata.id,websiteId:null,...retained};
 return {workspace,source,pages,metadata};
}
test('native publication input resolves selected page originals, title windows and explicit presentation overrides',async()=>{
 const {workspace,source,pages,metadata}=await fixture(),input=await openPublicationInput(workspace,source),header=await input.metadata();
 for(const name of ['projects','notebooks','pages','branding'])assert.deepEqual(header[name],[]);
 assert.deepEqual(header.website.assets,[]);assert.deepEqual(header.website.presentation.media,[]);assert.deepEqual(header.website.presentation.covers,[]);
 assert.deepEqual(await input.page(pages[0].id),pages[0]);assert.equal(await input.count('pages'),2);assert.equal(await input.count('pages',{shared:false}),3);
 const window=await input.window('pages',{index:'title',limit:1});assert.equal(window.items[0].title,'Alpha');assert.equal(window.items[0].excerpt,'Exact Alpha original');
 assert.equal((await input.target('page:'+pages[0].id)).share,true);assert.equal(await input.target('page:'+pages[2].id),null);
 assert.deepEqual(await input.get('layouts','page:'+pages[0].id),metadata.website.layouts[0]);assert.deepEqual(await input.get('branding','page:'+pages[0].id),{target:'page:'+pages[0].id,logos:[]});
 assert.equal(await input.get('branding','page:'+pages[1].id),null);
 const rows=[];for await(const row of input.presentationMedia({scopes:new Set([metadata.website.presentation.media[0].scope])}))rows.push(row);assert.deepEqual(rows,metadata.website.presentation.media);
 const writes=workspace.files.size;await input.verify();assert.equal(workspace.files.size,writes);
});
test('native source envelopes, missing refs, cancellation and later corruption fail closed',async()=>{
 const {workspace,source,pages}=await fixture();
 for(const changed of [{summary:{...source.summary,pages:0}},{hasSources:true},{researchReview:{...source.researchReview,analysis:{fingerprint:digest('other'),count:0}}}])await assert.rejects(openPublicationInput(workspace,{...source,...changed}),{code:'JOB_DAMAGED'});
 const omitted={...source};delete omitted.researchReview;await assert.rejects(openPublicationInput(workspace,omitted),{code:'JOB_DAMAGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(openPublicationInput(workspace,source,{signal:controller.signal}),{name:'AbortError'});
 const input=await openPublicationInput(workspace,source);await input.page(pages[0].id);const ref=await input.get('pageInputs',pages[0].id),file='.observanda/release-inputs/'+source.id+'/'+ref.fileId+'.json',raw=workspace.files.get(file);workspace.files.set(file,raw.replace('Exact Zulu original','Corrupt Zulu original'));
 await assert.rejects(input.verify(),{code:'JOB_DAMAGED'});workspace.files.set(file,raw);
 const missing=await fixture({missingPage:true});await assert.rejects(openPublicationInput(missing.workspace,missing.source),{code:'JOB_DAMAGED'});
});
test('legacy publication input retains inline and v5 presentation readers and iterable scope semantics',async()=>{
 const {workspace,source,pages,metadata}=await fixture(),native=await openPublicationInput(workspace,source),layoutInputs=[],brandingInputs=[];
 for await(const row of native.items('layoutInputs'))layoutInputs.push(row);for await(const row of native.items('brandingInputs'))brandingInputs.push(row);
 for(const version of [1,2,3,4,5]){
  const savedMetadata={...metadata,...(version>=4?{pages:pages.map(row=>({...row,body:'',sections:[]}))}:{}),...(version===5?{branding:[],website:{...metadata.website,layouts:[]}}:{})};
  const pageInputs=[];for await(const row of native.items('pageInputs'))pageInputs.push(row);
  const legacy={version,id:source.id,...(version===1?{book:{...savedMetadata,entries:[]}}:{metadata:savedMetadata,records:[]}),pageInputs,layoutInputs,brandingInputs};
  const input=await openPublicationInput(workspace,legacy);assert.deepEqual(await input.page(pages[0].id),pages[0]);assert.deepEqual(await input.get('layouts','page:'+pages[0].id),metadata.website.layouts[0]);
  const layouts=[];for await(const row of input.items('layouts'))layouts.push(row);assert.deepEqual(layouts,metadata.website.layouts);
  const media=[];for await(const row of input.presentationMedia({scopes:new Set([metadata.website.presentation.media[0].scope])}))media.push(row);assert.deepEqual(media,metadata.website.presentation.media);
 }
});


test('retained publication input reopens more than 100 foreign source groups with verified identities and fingerprints',async()=>{
 const {workspace,source}=await fixture({foreignGroups:101}),input=await openPublicationInput(workspace,source);
 assert.equal(await input.count('sourceGroups'),102);const late=await input.window('sourceGroups',{offset:100,limit:2});assert.equal(late.items.length,2);assert.notEqual(late.items[0].workspaceId,late.items[1].workspaceId);
 await input.verify();await assert.rejects(openPublicationInput(workspace,{...source,hasSources:false}),{code:'JOB_DAMAGED'});
 const malformed=await fixture({foreignGroups:101,invalidGroup:true}),bad=await openPublicationInput(malformed.workspace,malformed.source);await assert.rejects(bad.verify(),{code:'JOB_DAMAGED'});
});
