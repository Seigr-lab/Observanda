import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {contentBuffer} from '../src/file-content.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {pageInclusion} from '../src/website-page-inclusion.js';
import {omitPrivateStyleURLs} from '../src/website-page-dependencies.js';
import {componentOperation} from '../src/website-component-storage.js';
import {saveWebsiteFeed} from '../src/website-dynamic-feeds.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-inclusion-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Research was opened by the website editor');
 return {store:new WebsiteFileStore(workspace),id:randomUUID()};
}
test('creating and saving standalone drafts keeps every page stylesheet and private media out of publication',async t=>{
 const {store,id}=await fixture(t);
 const first=await store.create({id,name:'Laboratory'});
 let working=await store.createPage(id,{expectedRevision:first.site.revision,path:'protocols/pending.html',title:'Internal findings'});
 const privateStyle=working.site.cssPath,picture='pictures/'+randomUUID()+'.png';
 await assert.rejects(store.save(id,{expectedRevision:working.site.revision,path:'unexpected.html',html:working.html,css:''}),{code:'NOT_FOUND'});
 assert.equal(working.site.pages.find(p=>p.path===working.path).draft,true);
 assert.ok(working.html.includes('href="../style.css"')&&working.html.includes('href="../'+privateStyle+'"'));
 const styles='main{background-image:url("'+picture+'")}';
 working=await store.save(id,{...working,expectedRevision:working.site.revision,css:styles,receivePictures:async function*(){yield {name:picture,bytes:Buffer.from('draft figure')};}});
 const privateTwo=await store.createPage(id,{expectedRevision:working.site.revision,title:'Independent draft',path:'notes.html'});
 assert.notEqual(privateTwo.site.cssPath,privateStyle);assert.equal(privateTwo.css,'');
 assert.equal((await store.open(id,{path:working.path})).css,styles);
 const publicOne=await store.createPage(id,{expectedRevision:privateTwo.site.revision,title:'Published methods',path:'methods.html',inclusion:'included'});
 const candidate=await WebsiteFilesCandidate.open(store,id,publicOne.site.revision);
 assert.deepEqual([...candidate.files.keys()].sort(),['index.html','methods.html',publicOne.site.cssPath,'publication.json','style.css'].sort());
 assert.ok((await contentBuffer(candidate.files.get('style.css'))).equals(Buffer.from(first.css)));
 for(const part of [privateStyle,picture,working.path,privateTwo.path]){
  await assert.rejects(store.file(id,part),{code:'NOT_FOUND'});
  assert.ok(await store.file(id,part,{editor:true}));
 }
 await assert.rejects(store.createPage(id,{expectedRevision:publicOne.site.revision,path:'Methods.html',title:'Another'}),{code:'CONFLICT'});
});

test('reviewed inclusion updates navigation, nested media and styles together and can be reversed',async t=>{
 const {store,id}=await fixture(t);
 const first=await store.create({id,name:'Study'});
 let draft=await store.createPage(id,{expectedRevision:first.site.revision,path:'notes/report.html',title:'Research notes'});
 const picture='pictures/'+randomUUID()+'.png',ownStyle=draft.site.cssPath;
 const privateText='Unreleased colony trials',privateLabel='Read unreleased results';
 draft=await store.save(id,{...draft,expectedRevision:draft.site.revision,html:draft.html.replace('</main>','<p>'+privateText+'</p></main>'),css:'article{background:url('+picture+')}',receivePictures:async function*(){yield {name:picture,bytes:Buffer.from('private chart')};}});
 const home=await store.open(id),links='<nav><a href="notes/report.html#results">'+privateLabel+'</a></nav><a href="notes/report.html">Open study</a>';
 let current=await store.save(id,{...home,expectedRevision:home.site.revision,html:home.html.replace('</body>',links+'</body>')});
 const output=async()=>{const candidate=await WebsiteFilesCandidate.open(store,id,current.site.revision);await candidate.verify();return candidate.files;};
 let files=await output();assert.ok(!files.has(picture));
 assert.doesNotMatch((await contentBuffer(files.get('index.html'))).toString(),/Read unreleased|Open study|notes\/report/);
 assert.ok((await store.open(id)).html.includes(privateLabel));
 const args=(inclusion)=>({expectedRevision:current.site.revision,path:draft.path,inclusion});
 const promote=await pageInclusion(store,id,args('included'));
 for(const kind of ['menu','link','asset','page'])assert.ok(promote.counts[kind]);
 assert.ok(promote.items.some(i=>i.name===picture)&&promote.items.some(i=>i.name===ownStyle));
 await assert.rejects(pageInclusion(store,id,{...args('included'),reviewId:'a'.repeat(64)},true),{code:'CONFLICT'});
 current=await pageInclusion(store,id,{...args('included'),reviewId:promote.reviewId},true);
 files=await output();
 assert.ok(files.has(picture)&&files.has(ownStyle));
 assert.ok((await contentBuffer(files.get(draft.path))).toString().includes(privateText));
 assert.ok((await contentBuffer(files.get('index.html'))).toString().includes(privateLabel));
 const demote=await pageInclusion(store,id,args('private'));
 const changed=await store.save(id,{...current,expectedRevision:current.site.revision,html:current.html.replace('Research notes','Revised title')});
 await assert.rejects(pageInclusion(store,id,{...args('private'),reviewId:demote.reviewId},true),{code:'CONFLICT'});
 current=changed;const latest=await pageInclusion(store,id,args('private'));
 current=await pageInclusion(store,id,{...args('private'),reviewId:latest.reviewId},true);
 files=await output();
 for(const name of [picture,ownStyle,draft.path])assert.ok(!files.has(name));
 assert.doesNotMatch((await contentBuffer(files.get('index.html'))).toString(),/Read unreleased|Open study|notes\/report/);
 assert.ok((await store.open(id,{path:draft.path})).html.includes(privateText));
});

test('private resource URL removal preserves surrounding authored CSS and resolves escaped URL tokens',()=>{
 const path='assets/lab.png',blocked=new Set([path]);
 const css=String.raw`p{font-family:"A; B";background:u/**/\72 l("assets/lab.png");color:blue}/* keep */ a{color:navy}`;
 assert.equal(omitPrivateStyleURLs(css,'style.css',blocked),'p{font-family:"A; B";background:none;color:blue}/* keep */ a{color:navy}');
});

test('saving an unrelated page stylesheet leaves the current editor mounted and directly referenced styles still invalidate it',async t=>{
 const {store,id}=await fixture(t),home=await store.create({id,name:'Study'});
 const other=await store.createPage(id,{expectedRevision:home.site.revision,path:'notes.html',title:'Notes'});
 const style=other.site.cssPath,updated=await store.save(id,{...other,expectedRevision:other.site.revision,css:'p{color:green}'});
 assert.equal((await store.versionStatus(id,{path:home.path,expectedRevision:home.site.revision})).surfaceStamp,home.surfaceStamp);
 await store.file(id,home.site.cssPath,{editor:true,revision:home.assetStamp});
 await assert.rejects(store.file(id,style,{editor:true,revision:other.assetStamp}),{code:'CONFLICT'});
 const linked=await store.save(id,{...home,expectedRevision:updated.site.revision,html:home.html.replace('</head>','<link rel="stylesheet" href="'+style+'"></head>')});
 await store.file(id,style,{editor:true,revision:linked.assetStamp});
 const latest=await store.save(id,{...updated,expectedRevision:linked.site.revision,css:'p{color:purple}'});
 assert.notEqual((await store.versionStatus(id,{path:home.path,expectedRevision:linked.site.revision})).surfaceStamp,linked.surfaceStamp);
 await assert.rejects(store.file(id,style,{editor:true,revision:linked.assetStamp}),{code:'CONFLICT'});
 assert.equal((await store.open(id)).site.revision,latest.site.revision);
});

test('withdrawing a page withdraws exclusive media even when its incoming link also contained that media',async t=>{
 const {store,id}=await fixture(t),target='field.html',image='assets/field-only.png';
 const html=body=>'<html><head><title>Study</title></head><body><main>'+body+'</main></body></html>';
 const home=await store.importFiles(id,{name:'Study',files:new Map([['index.html',html('<a href="'+target+'"><img src="'+image+'">Open</a>')],[target,html('<img src="'+image+'">')],[image,Buffer.from('Field-only photograph')],['style.css','']])});
 const options={expectedRevision:home.site.revision,path:target,inclusion:'private'},review=await pageInclusion(store,id,options);
 assert.equal(review.items.find(item=>item.name===image).shared,false);
 await pageInclusion(store,id,{...options,reviewId:review.reviewId},true);
 const output=(await store.export(id)).files;
 assert.ok(!output.has(image)&&!output.has(target));
 assert.doesNotMatch((await contentBuffer(output.get('index.html'))).toString(),/field-only|field\.html/);
});

test('a component owned by a promoted page keeps its withdrawal ownership after ordinary shared edits',async t=>{
 const {store,id}=await fixture(t);
 let opened=await store.create({id,name:'Study'});
 opened=await store.createPage(id,{expectedRevision:opened.site.revision,path:'notes.html',title:'Private notes'});
 opened=await store.save(id,{...opened,expectedRevision:opened.site.revision,html:opened.html.replace('</main>','<section><h2>Field legend</h2></section></main>')});
 const comp=(action,args={})=>componentOperation(store,action,id,{path:opened.path,expectedRevision:opened.site.revision,...args});
 opened=await comp('create',{name:'Field legend',blockPath:'0/1'});
 const component=(await comp('list')).items[0].id;
 const change=async(inclusion)=>{
  const args={expectedRevision:opened.site.revision,path:opened.path,inclusion},review=await pageInclusion(store,id,args);
  opened=await pageInclusion(store,id,{...args,reviewId:review.reviewId},true);
 };
 await change('included');
 const main=await comp('main',{component});assert.equal(main.editable,true);
 opened=await comp('update',{component,name:main.name,html:main.html.replace('Field legend','Field symbols')});
 await change('private');
 assert.ok((await comp('list')).items.some(item=>item.id===component&&item.draft));
 assert.ok(!(await comp('list',{path:'index.html'})).items.some(item=>item.id===component));
});

test('paging an unchanged large inclusion review reads no page bodies and reopening a stale review is refused',async t=>{
 const {store,id}=await fixture(t),target='field.html',draft='private.html';
 const wrap=content=>'<html><head><title>Field</title></head><body><main>'+content+'</main></body></html>';
 const links=wrap(('<a href="'+draft+'">Private material</a><a href="'+target+'">Field results</a>').repeat(25));
 const files=new Map([['index.html',links],[target,wrap('Field results')],['style.css','']]);
 for(let i=0;i<127;i++)files.set('study-'+i+'.html',links);
 const home=await store.importFiles(id,{name:'Laboratory',files,draftFiles:new Map([[draft,wrap('Private notes')],['draft-styles.css','']])});
 const pin={expectedRevision:home.site.revision,path:target,inclusion:'private'};
 const reads=[],reader=new WebsiteFileStore(store.workspace),read=reader.readText.bind(reader);
 reader.readText=async(file,options)=>{reads.push(file.name);return read(file,options);};
 const first=await pageInclusion(reader,id,pin);assert.ok(reads.length>0);
 assert.equal(first.counts.link,128);assert.equal(first.items.length,40);
 reads.length=0;let result=first;
 while(result.next!==null)result=await pageInclusion(reader,id,{...pin,offset:result.next});
 result=await pageInclusion(reader,id,{...pin,offset:result.previous});
 assert.equal(result.reviewId,first.reviewId);assert.deepEqual(reads,[]);
 const other=await store.createPage(id,{expectedRevision:home.site.revision,path:'more.html',title:'More'});
 await assert.rejects(pageInclusion(reader,id,{...pin,offset:40}),{code:'CONFLICT'});
 await assert.rejects(pageInclusion(reader,id,{...pin,reviewId:first.reviewId},true),{code:'CONFLICT'});
 assert.equal((await store.open(id,{path:target})).site.revision,other.site.revision);
});

test('reviewing an imported draft never promotes another private page stylesheet or media nested in a withheld link',async t=>{
 const {store,id}=await fixture(t),a='work.html',b='other.html',styles='draft-styles.css',secret='private/font.woff2',photo='private/inside.png';
 const doc=(body,style)=>'<html><head><title>Pages</title><link rel="stylesheet" href="'+style+'"></head><body><main>'+body+'</main></body></html>';
 const home=await store.importFiles(id,{name:'Site',files:new Map([['index.html',doc('Home','style.css')],['style.css','body{color:blue}']]),
  draftFiles:new Map([[a,doc('<a href="'+b+'"><img src="'+photo+'">Another private page</a>',styles)],[b,doc('Other private',styles)],[styles,'@font-face{font-family:secret;src:url('+secret+')}'],[secret,Buffer.from('private typeface')],[photo,Buffer.from('private area')]])});
 const options={expectedRevision:home.site.revision,path:a,inclusion:'included'},review=await pageInclusion(store,id,options);
 assert.equal(review.counts.sharedStyle,1);assert.ok(!review.items.some(r=>[photo,secret].includes(r.name)));
 const promoted=await pageInclusion(store,id,{...options,reviewId:review.reviewId},true);
 const out=(await store.export(id)).files;
 for(const name of [b,styles,secret,photo])assert.equal(out.has(name),false);
 assert.doesNotMatch((await contentBuffer(out.get(a))).toString(),/Another private|other\.html|inside\.png|draft-styles/);
 const edited=await store.save(id,{...promoted,expectedRevision:promoted.site.revision,css:'p{padding:10px}'});
 const back={...options,expectedRevision:edited.site.revision,inclusion:'private'};
 const demoted=await pageInclusion(store,id,{...back,reviewId:(await pageInclusion(store,id,back)).reviewId},true);
 assert.match(demoted.html,/draft-styles\.css/);assert.ok(demoted.html.includes(photo));assert.equal(demoted.css,'p{padding:10px}');
});

test('an included component and feed remain protected through private edits, review, grant withdrawal and demotion',async t=>{
 const {store,id}=await fixture(t);
 let open=await store.create({id,name:'Atlas',html:'<html><head><title>Atlas</title></head><body><main><section><h2>Public legend</h2></section></main></body></html>',css:''});
 const comp=(op,args)=>componentOperation(store,op,id,{expectedRevision:open.site.revision,path:open.path,...args});
 open=await comp('create',{blockPath:'0/0',name:'Repeated legend'});
 const item=(await comp('list',{})).items[0].id;
 open=await store.createPage(id,{expectedRevision:open.site.revision,path:'study.html',title:'Study'});
 open=await comp('insert',{component:item,position:'end'});
 const main=await comp('main',{component:item});
 assert.equal(main.editable,false);
 await assert.rejects(comp('update',{component:item,name:'Repeated legend',html:main.html.replace('Public legend','PRIVATE DRAFT WORDS')}),{code:'WEBSITE_PUBLIC_COMPONENT'});
 assert.ok(!(await store.open(id)).html.includes('PRIVATE DRAFT WORDS'));
 const owners=[1,2].map(()=>({workspaceId:store.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}));
 async function grant(owner,title,visible){
  const sourceId=websiteSourceId(owner),token=await store.beginSourceUpdate({sourceId,target:'website'});
  return store.putSource({sourceId,provenance:owner,title,visible,html:visible?'<p>'+title+'</p>':''},{token});
 }
 await grant(owners[0],'First field result',true);await grant(owners[1],'Result to withdraw',true);
 open=await saveWebsiteFeed(store,id,{expectedRevision:open.site.revision,path:'study.html',heading:'Recent results',layout:'grid',template:'full',pageSize:1,criteria:{sort:'title-asc'}});
 const continuation=open.site.feedPages[0].path;
 assert.ok(!(await store.export(id)).files.has(continuation));
 const before={path:open.path,expectedRevision:open.site.revision,inclusion:'included'};
 const started=await pageInclusion(store,id,before),sourceId=websiteSourceId(owners[0]);
 const pending=await store.beginSourceUpdate({sourceId,target:'website'});
 try{
  await assert.rejects(pageInclusion(store,id,{...before,offset:40}),{code:'CONFLICT'});
  await assert.rejects(pageInclusion(store,id,{...before,reviewId:started.reviewId},true),{code:'CONFLICT'});
 }finally{await store.cancelSourceUpdate({sourceId,token:pending});}
 const update=async inclusion=>{
  const opts={path:'study.html',expectedRevision:await store.siteVersion(id),inclusion};
  const review=await pageInclusion(store,id,opts);
  assert.equal(review.counts.component,1);assert.equal(review.counts.feed,1);
  return pageInclusion(store,id,{...opts,reviewId:review.reviewId},true);
 };
 open=await update('included');
 const files=(await store.export(id)).files;
 assert.ok(files.has(continuation));
 assert.match((await contentBuffer(files.get(continuation))).toString(),/Result to withdraw/);
 await grant(owners[1],'Withdrawn',false);
 const after=(await store.export(id)).files;
 for(const [name,file] of after)if(name.endsWith('.html'))assert.doesNotMatch((await contentBuffer(file)).toString(),/Result to withdraw/);
 open=await update('private');assert.ok(!(await store.export(id)).files.has(open.path));
 await assert.rejects(pageInclusion(store,id,{expectedRevision:open.site.revision,path:'index.html',inclusion:'private'}),{code:'WEBSITE_HOME_REQUIRED'});
});
