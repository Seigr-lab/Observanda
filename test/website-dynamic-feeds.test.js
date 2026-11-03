import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {readWebsiteFeed,saveWebsiteFeed,removeWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {initialGroups,changeGroups} from '../src/website-feed-groups.js';
import {contentBuffer} from '../src/file-content.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {maxPageBytes} from '../src/website-feed-render.js';
import {LocalExport} from '../src/local-export.js';
import {websitePublicationMetadata} from '../src/website-publication-metadata.js';

test('an insertion into ten thousand sorted entries splits only its own page and preserves other addresses',()=>{
 const rows=Array.from({length:10000},(_,i)=>({id:String(i*2).padStart(6,'0'),revision:String(i)}));
 const groups=initialGroups(rows,20),member={id:'000013',revision:'new'},feed={members:rows,groups,pageSize:20};
 const changed=changeGroups(feed,member.id,member,(a,b)=>a.id.localeCompare(b.id));
 assert.equal(changed.members.length,10001);assert.equal(changed.groups.length,501);
 assert.deepEqual(changed.groups.slice(2),groups.slice(1));assert.deepEqual(changed.groups.flatMap(g=>g.ids),changed.members.map(r=>r.id));
});

test('a previously unplaced grant refreshes subscribed feeds, scoped assets and continuation files through a failed update and retry',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-durable-'));
 await mkdir(path.join(root,'.observanda'));t.after(async()=>{await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-feed-durable-'))throw Error('Unexpected fixture');await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:120});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.openCatalogue=workspace.catalogue=()=>assert.fail('File feed opened research');
 const store=new WebsiteFileStore(workspace),a=randomUUID(),b=randomUUID(),unrelated=randomUUID(),host='logs/tides.html';
 const file=prefix=>'<html lang="es"><head><title>Coastal notes</title><link rel="stylesheet" href="'+prefix+'style.css"></head><body class="lab-theme"><header class="site-top"><a class="brand" href="'+prefix+'index.html">Coastal laboratory</a></header><main class="paper"><h1>Coastal notes</h1><p>Durable author introduction.</p></main><footer>Laboratory footer</footer></body></html>';
 const describe=(recordId= randomUUID())=>({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId});
 const first=describe(),second=describe(),third=describe(),assetBytes=Buffer.from('Granted current image'),assetName='assets/'+createHash('sha256').update(assetBytes).digest('hex')+'.png';
 const publish=async(provenance,title,visible=true)=>{
  const sourceId=websiteSourceId(provenance),token=await store.beginSourceUpdate({sourceId,target:'website'});
  return store.putSource({sourceId,title,visible,provenance,html:visible?'<section data-observanda-part="title"><h2>'+title+'</h2></section><article><p>'+title+' public body.</p>'+ (provenance===first?'<img src="'+assetName+'" alt="Field reading">':'')+'</article>':'',
   css:visible?'@scope ([data-observanda-source]) { p{color:#173c32} }':'',assets:visible&&provenance===first?[{path:assetName,bytes:assetBytes,contentType:'image/png'}]:[]},{token});
 };
 await publish(first,'A protocol');const beforeMenu=await publish(second,'C observations');
 const target='entries/approved.html',targetHTML='<html><head><title data-observanda-view="document-title" data-observanda-source="'+beforeMenu.id+'" data-observanda-source-revision="'+beforeMenu.revision+'">C observations</title></head><body><main>Target</main></body></html>';
 const papers=new Map([['index.html',file('')],[host,file('../')],[target,targetHTML],['style.css','body{font-family:sans-serif}']]);
 for(const id of [a,b,unrelated])await store.importFiles(id,{name:'Reports',files:papers});
 const menuItem=(label,href)=>({key:null,label,href,children:[]});
 await store.saveMenu(a,{expectedRevision:await store.siteVersion(a),items:[menuItem('Home','index.html'),menuItem('C observations',target)]});
 const config={path:host,heading:'Current results',layout:'grid',template:'full',pageSize:1,criteria:{sort:'title-asc'}};
 const add=async(id,extra)=>saveWebsiteFeed(store,id,{...config,...extra,expectedRevision:await store.siteVersion(id)});
 let one=await add(a),two=await add(b,{template:'custom',itemHTML:'<article><h3 data-feed-field="title"></h3></article>'});
 await add(unrelated,{criteria:{projectId:randomUUID()}});
 const status=(site,id)=>store.siteVersion(site).then(expectedRevision=>readWebsiteFeed(store,site,{expectedRevision,path:host,feedId:id}));
 assert.equal((await status(a,one.feedId)).feed.total,2);assert.ok(one.html.includes('A protocol public body.'));
 assert.ok(!two.html.includes('A protocol public body.'));assert.equal(one.site.feedPages.length,1);const continuation=one.site.feedPages[0].path;
 await assert.rejects(store.open(a,{path:continuation}),{code:'NOT_FOUND'});
 const old=await WebsiteFilesCandidate.open(store,a,one.site.revision);await old.verify({});
 assert.ok(old.files.has('feed-assets/'+assetName));assert.ok(!old.files.has(assetName));
 assert.ok((await contentBuffer(old.files.get(host))).toString().includes('../feed-assets/'+assetName));
 assert.ok(!(await store.export(b)).files.has('feed-assets/'+assetName));
 const editionText=async name=>(await contentBuffer((await store.export(a)).files.get(name))).toString();
 const shell=await editionText(continuation);
 assert.match(shell,/Coastal laboratory/);assert.match(shell,/Laboratory footer/);assert.match(shell,/class="paper"/);
 assert.ok(shell.includes('href="../../entries/approved.html"'));assert.ok(shell.includes('href="../../index.html"'));
 assert.ok(shell.includes('rel="up" href="../../logs/tides.html#website-feed-'+one.feedId+'"'));
 assert.doesNotMatch(shell,/Durable author introduction/);
 const extra=await add(a,{heading:'Other feed section do not copy',criteria:{search:'no-unrelated-record-matches'}});
 assert.doesNotMatch(await editionText(continuation),/Other feed section do not copy/);
 await removeWebsiteFeed(store,a,{expectedRevision:extra.site.revision,path:host,feedId:extra.feedId});
 const branded=await store.open(a,{path:host});
 await store.save(a,{...branded,expectedRevision:branded.site.revision,html:branded.html.replace('Coastal laboratory','New field station')});
 assert.match(await editionText(continuation),/New field station/);assert.doesNotMatch(await editionText(continuation),/Coastal laboratory/);
 const raw=store.raw.bind(store),read=store.readText.bind(store),openedSites=new Set(),fragments=[];
 store.raw=async(id,opts)=>{openedSites.add(id);return raw(id,opts);};
 store.readText=(descriptor,opts)=>{if(descriptor.name==='fragment.html')fragments.push(descriptor.blob);return read(descriptor,opts);};
 await publish(third,'D new grant');store.raw=raw;store.readText=read;
 assert.ok(!openedSites.has(unrelated));assert.deepEqual([...openedSites].sort(),[a,b].sort());assert.equal(fragments.length,1);assert.ok(fragments.every(p=>p.includes('/sources/'+websiteSourceId(third)+'/')));
 assert.equal((await status(a,one.feedId)).feed.total,3);
 assert.equal((await status(b,two.feedId)).feed.total,3);
 await assert.rejects(old.verify({}),{code:'CONFLICT'});
 assert.ok((await store.open(a,{path:host})).site.feedPages.some(p=>p.path===continuation));
 const before=await store.open(a,{path:host});await assert.rejects(store.save(a,{...before,expectedRevision:before.site.revision,html:before.html.replace('A protocol public body','Forged text')}),{code:'CONFLICT'});
 const write=store.writeControl.bind(store);let failed=false;
 store.writeControl=async(name,...rest)=>{
  if(!failed&&name==='.observanda/website-files/sites/'+b+'/head.json'){failed=true;throw Error('Simulated feed head interruption');}
  return write(name,...rest);
 };
 await assert.rejects(publish(first,'Withdrawn',false),/Simulated feed head interruption/);store.writeControl=write;
 for(const id of [a,b]){await assert.rejects(store.open(id,{path:host}),{code:'CONFLICT'});await assert.rejects(store.export(id),{code:'CONFLICT'});}
 const independent=await store.open(unrelated,{path:host}),out=root+'-publication';await mkdir(out);
 t.after(async()=>{if(path.dirname(out)!==path.resolve(os.tmpdir())||!path.basename(out).startsWith('website-feed-durable-'))throw Error('Unexpected publication');await rm(out,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const listing=await store.list();assert.ok(listing.items.find(s=>s.id===a).pending);assert.ok(!listing.items.find(s=>s.id===unrelated).pending);
 const edition=await WebsiteFilesCandidate.open(store,unrelated,independent.site.revision);await edition.verify({});
 const folder=new LocalExport(websitePublicationMetadata(store.publicationWorkspace(unrelated)),{fileOwner:{
  locked:(_dir,work)=>store.withSite(unrelated,independent.site.revision,work),candidate:async review=>{assert.equal(review,edition.reviewId);await edition.verify({});return edition;}
 }});
 const reviewed=await folder.plan({reviewId:edition.reviewId,directory:out});await folder.apply({id:reviewed.id,reviewed:true});
 await publish(first,'Withdrawn',false);
 const clean=await store.export(a);assert.ok(!clean.files.has('feed-assets/'+assetName));assert.ok(!(await contentBuffer(clean.files.get(host))).toString().includes('A protocol'));
 assert.equal((await status(b,two.feedId)).feed.total,2);
 fragments.length=0;store.readText=(descriptor,opts)=>{if(descriptor.name==='fragment.html')fragments.push(descriptor.blob);return read(descriptor,opts);};
 await publish(first,'A regranted protocol');store.readText=read;
 assert.ok(fragments.length<=2&&fragments.every(p=>p.includes('/sources/'+websiteSourceId(first)+'/')));
 assert.match((await store.open(a,{path:host})).html,/A regranted protocol/);
 await publish(second,'Withdrawn',false);const withoutNav=await store.export(a);
 for(const {path:published} of withoutNav.site.feedPages){const html=(await contentBuffer(withoutNav.files.get(published))).toString();assert.doesNotMatch(html,/C observations|entries\/approved\.html|data-observanda-link/);}
 const removed=await removeWebsiteFeed(store,a,{expectedRevision:await store.siteVersion(a),path:host,feedId:one.feedId});
 assert.doesNotMatch(removed.html,/data-website-feed=/);assert.ok(!removed.site.feedPages?.length);
 assert.ok(![...(await store.export(a)).files.keys()].some(name=>name.startsWith('feeds/')||name.startsWith('feed-assets/')));
 const untouched=removed.site.revision;await publish(third,'D updated');assert.equal(await store.siteVersion(a),untouched);
 const pdfId=websiteSourceId({...third,target:'pdf'}),pdf=await store.beginSourceUpdate({sourceId:pdfId,target:'pdf',provenance:third});
 assert.equal((await status(b,two.feedId)).feed.total,2);await store.cancelSourceUpdate({sourceId:pdfId,token:pdf});
 const unknown='e'.repeat(64);await store.scope(()=>store.fence(unknown,true),{write:true});
 await assert.rejects(store.open(unrelated),{code:'CONFLICT'});await store.scope(()=>store.fence(unknown,false),{write:true});
});

test('large allowed articles split at the supported HTML byte budget without dropping either article',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-bytes-'));
 await mkdir(path.join(root,'.observanda'));t.after(async()=>{await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-feed-bytes-'))throw Error('Unexpected fixture');await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:120});});
 const store=new WebsiteFileStore(new Workspace(root,{id:randomUUID(),key:randomBytes(32)})),site=randomUUID();
 const opened=await store.create({id:site,name:'Large essays',html:'<html><head><title>Large essays</title></head><body><main><h1>Field essays</h1></main></body></html>'});
 const prose='x'.repeat(maxPageBytes/2+512);
 for(const title of ['First measurement','Second measurement']){
  const provenance={workspaceId:store.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},id=websiteSourceId(provenance);
  const token=await store.beginSourceUpdate({sourceId:id,target:'website'});
  await store.putSource({sourceId:id,provenance,title,html:'<section data-observanda-part="title"><h2>'+title+'</h2></section><p>'+prose+'</p>'},{token});
 }
 const saved=await saveWebsiteFeed(store,site,{expectedRevision:opened.site.revision,path:'index.html',heading:'Both measurements',pageSize:100});
 assert.equal(saved.site.feedPages.length,1);const files=(await store.export(site)).files;
 const text=[];
 for(const name of ['index.html',saved.site.feedPages[0].path]){
  assert.ok(files.get(name).size<=maxPageBytes);const html=(await contentBuffer(files.get(name))).toString();
  assert.ok(html.includes(prose));text.push(html);
 }
 assert.equal(text.filter(html=>html.includes('First measurement')).length,1);assert.equal(text.filter(html=>html.includes('Second measurement')).length,1);
});
