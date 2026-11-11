import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {componentOperation} from '../src/website-component-storage.js';
import {websitePageDesigns} from '../src/website-page-designs.js';
import {websiteThemes} from '../src/website-scoped-themes.js';
import {websiteStyleBook} from '../src/website-style-book.js';
import {websiteBreakpoints} from '../src/website-breakpoints.js';
import {regionOperation} from '../src/website-region-storage.js';
import {exportWebsiteDesign} from '../src/website-design-package.js';
import {applyWebsiteDesign,readDesignPackage,reviewWebsiteDesign} from '../src/website-design-import.js';
import {readDesignArchive} from '../src/website-design-archive.js';
import {zipStream} from '../src/zip-stream.js';
import {bundledFonts} from '../src/fonts.js';
import {BUNDLED_FONTS} from '../src/web/font-catalogue.js';
import {defaultBreakpoints} from '../src/web/website-breakpoint-model.js';
import {writeVisualStyle} from '../src/web/website-files-visual-style.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {Readable} from 'node:stream';
import {readdir} from 'node:fs/promises';
import {mediaCapabilities} from '../src/media.js';
import {contentBuffer} from '../src/file-content.js';
import {readRecordingUpload,saveRecordingUpload} from '../src/website-recordings.js';
import {mediaFixtures,PRIVATE_MARKER} from './media-fixtures.js';

const wrap=(title,body)=>'<html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
const labels={heading:'Heading',text:'New writing',image:'Site picture'};
const raw=(store,id)=>store.scope(()=>store.raw(id));
async function packageBytes(members){const parts=[];for await(const chunk of zipStream(members))parts.push(Buffer.from(chunk));return Buffer.concat(parts);}

async function designedSite(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-design-package-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),siteId=randomUUID();
 const png=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
 const photo='pictures/'+randomUUID()+'.png',backdrop='pictures/'+randomUUID()+'.png',layout='ow-visual-'+randomUUID();
 let page=await store.importFiles(siteId,{name:'Apiary',files:new Map([['index.html',wrap('Home','<p>Home</p>')],['layout.html',wrap('Layout','<p>x</p>')],['about.html',wrap('About','<p>About</p>')],['style.css','main{padding:1rem}']])});
 let revision=page.site.revision;const next=value=>{revision=value.site.revision;return value;};
 // The site stylesheet uses a picture of its own.
 // Every page here shares the site stylesheet, so each save keeps the picture rule.
 const base='main{padding:1rem}\nbody{background:url('+backdrop+')}';
 next(await store.save(siteId,{expectedRevision:revision,path:'index.html',html:wrap('Home','<p>Home</p>'),css:base,receivePictures:async function*(){yield {name:backdrop,bytes:png};}}));
 const css=writeVisualStyle(base,layout,{length:1,cssText:'padding: 33px;'});
 const body='<section class="'+layout+'"><h2>Colony</h2><p><a href="about.html">About the apiary</a></p><img src="'+photo+'" alt="Frame" width="40" height="30"></section><aside><p>Legend</p></aside>';
 next(await store.save(siteId,{expectedRevision:revision,path:'layout.html',html:wrap('Layout',body),css,receivePictures:async function*(){yield {name:photo,bytes:png};}}));
 next(await componentOperation(store,'create',siteId,{path:'layout.html',expectedRevision:revision,blockPath:'0/2',name:'Legend'}));
 const legend=(await raw(store,siteId)).components[0].id;
 next(await regionOperation(store,'assign',siteId,{expectedRevision:revision,slot:'footer',component:legend}));
 const theme=next(await websiteThemes(store,siteId,{path:'layout.html',expectedRevision:revision,action:'create',scope:'section',blockPath:'0/1',name:'Hive accent',values:{accent:'#124955'}},true));
 const style=async(action,options)=>{const r=await websiteStyleBook(store,siteId,{action,expectedRevision:revision,path:'layout.html',...options});if(r.site)next(r);return r;};
 const stock=BUNDLED_FONTS.find(f=>f.id==='atkinson'),encoded=bundledFonts.get('fonts/'+stock.faces[0].file).toString('base64');
 const font=(await style('import-font',{encoded,embed:true,rights:'open-license',notice:'Open font notice for the design package test.'})).importedFontId;
 const paint=(await style('create',{name:'Hive colour',group:'color',rules:{normal:{color:'#114466'}}})).modifiedStyleId;
 const type=(await style('create',{name:'Licensed body',group:'typography',rules:{normal:{'font-family':font}}})).modifiedStyleId;
 await style('assign',{group:'color',tokenId:paint,scope:'site'});await style('assign',{group:'typography',tokenId:type,scope:'site'});
 const wide={id:randomUUID(),name:'Wide',min:1200,max:null},ranges=[...defaultBreakpoints(),wide];
 const plan=await websiteBreakpoints(store,siteId,{path:'index.html',expectedRevision:revision,ranges});
 next(await websiteBreakpoints(store,siteId,{path:'index.html',expectedRevision:revision,ranges,reviewId:plan.reviewId},true));
 next(await websitePageDesigns(store,siteId,{expectedRevision:revision,action:'name',path:'layout.html',name:'Inspection layout'}));
 // A lab book entry on the design's page: its text must never leave the site in a design.
 const provenance={workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},entryId=websiteSourceId(provenance);
 const grant=await store.putSource({sourceId:entryId,provenance,visible:true,title:'Granted canary',html:'<p data-observanda-part="body">SECRET HIVE NOTE</p>'},{token:await store.beginSourceUpdate({sourceId:entryId,target:'website',provenance})});
 next(await store.insertSource(siteId,{path:'layout.html',expectedRevision:revision,sourceId:entryId,sourceRevision:grant.revision,position:'end'}));
 return {store,workspace,siteId,get revision(){return revision;},photo,backdrop,legend,themeId:theme.themeId,font,wide};
}
async function blankSite(store,name='Orchard'){
 const id=randomUUID();const created=await store.create({id,name});return {id,revision:created.site.revision};
}

test('a design leaves without lab book material and arrives complete in a blank site',async t=>{
 const s=await designedSite(t),{store}=s;
 const exported=await exportWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,labels});
 const bytes=await packageBytes(exported.members);
 // The privacy canary: no lab book text, provenance or research markup anywhere in the package.
 for(const [name,content] of readDesignArchive(bytes)){
  const text=content.toString('latin1');
  assert.doesNotMatch(text,/SECRET HIVE NOTE|Granted canary|data-observanda-/,name);
  assert.equal(text.includes(s.workspace.vault.id),false,name);
 }
 const pkg=readDesignPackage(bytes);
 assert.deepEqual(pkg.components.map(c=>c.name),['Legend']);
 assert.deepEqual(pkg.pageDesigns.map(d=>d.name),['Inspection layout']);
 assert.deepEqual(Object.keys(pkg.regions),['footer']);
 assert.equal(pkg.fonts[0].id,s.font);assert.match(pkg.fonts[0].notice,/Open font notice/);
 assert.ok(pkg.resources.some(r=>r.name===s.backdrop)&&pkg.resources.some(r=>r.name===s.photo));

 const blank=await blankSite(store);
 const review=await reviewWebsiteDesign(store,blank.id,{expectedRevision:blank.revision,bytes});
 assert.deepEqual(new Set(review.rows.map(r=>r.kind)),new Set(['theme','style','font','breakpoint','component','design']));
 assert.equal(review.rows.some(r=>r.from),false);assert.equal(review.stylesheet,true);
 assert.deepEqual(review.regions,[{slot:'footer',component:'Legend',current:null}]);
 await assert.rejects(applyWebsiteDesign(store,blank.id,{expectedRevision:blank.revision,bytes,reviewId:'0'.repeat(64),options:{}}),{code:'CONFLICT'});
 const applied=await applyWebsiteDesign(store,blank.id,{expectedRevision:blank.revision,bytes,reviewId:review.reviewId,options:{stylesheet:true,regions:['footer']}});
 const site=await raw(store,blank.id);
 assert.deepEqual(site.themeBook.items.map(t=>t.name),['Hive accent']);assert.notEqual(site.themeBook.items[0].id,s.themeId);
 assert.deepEqual(site.styleBook.tokens.map(t=>t.name).sort(),['Hive colour','Licensed body']);
 assert.deepEqual(site.styleBook.fonts.map(f=>f.id),[s.font]);assert.equal(site.styleBook.site.length,2);
 assert.ok(site.breakpoints.some(r=>r.id===s.wide.id&&r.name==='Wide'));
 const legend=site.components.find(c=>c.name==='Legend');assert.ok(legend);assert.notEqual(legend.id,s.legend);
 assert.equal(site.regions.slots.footer.component,legend.id);
 assert.match(applied.html,/<footer data-website-region="footer"><aside data-website-instance="[^"]+"><p>Legend<\/p><\/aside><\/footer>/);
 assert.match(applied.css,/background:url\("?pictures\/[a-f0-9-]{36}\.png"?\)/);assert.equal(applied.css.includes(s.backdrop),false);
 const design=site.pageDesigns.find(d=>d.name==='Inspection layout');assert.ok(design.template);
 assert.deepEqual(design.template.components,[legend.id]);
 // The imported design makes pages in its new site, with its pictures and a link to a page it does not have removed.
 const made=await websitePageDesigns(store,blank.id,{expectedRevision:applied.site.revision,action:'use',path:'index.html',design:design.id,destination:'yard/inspection.html',title:'Inspection',language:'en',inclusion:'included'});
 assert.match(made.html,/<img[^>]* src="\.\.\/pictures\/[a-f0-9-]{36}\.png"/);
 assert.match(made.html,/<aside data-website-instance="[^"]+"><p>Legend<\/p><\/aside>/);
 assert.doesNotMatch(made.html,/about\.html|SECRET HIVE NOTE/);
});

test('importing a design again renames what the site already has and keeps shared fonts once',async t=>{
 const s=await designedSite(t),{store}=s;
 const bytes=await packageBytes((await exportWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,labels})).members);
 const review=await reviewWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,bytes});
 const renamed=Object.fromEntries(review.rows.filter(r=>r.from).map(r=>[r.kind+':'+r.from,r.name]));
 assert.equal(renamed['component:Legend'],'Legend (2)');assert.equal(renamed['theme:Hive accent'],'Hive accent (2)');
 assert.equal(renamed['style:Hive colour'],'Hive colour (2)');assert.equal(renamed['design:Inspection layout'],'Inspection layout (2)');
 assert.equal(review.rows.some(r=>r.kind==='font'||r.kind==='breakpoint'),false,'known fonts and layout sizes are not added twice');
 assert.deepEqual(review.regions,[{slot:'footer',component:'Legend',current:'Legend'}]);
 const applied=await applyWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,bytes,reviewId:review.reviewId,options:{}});
 const site=await raw(store,s.siteId);
 assert.deepEqual(site.components.map(c=>c.name),['Legend','Legend (2)']);
 assert.equal(site.styleBook.fonts.length,1);
 assert.equal(site.regions.slots.footer.component,s.legend,'regions change only when chosen');
 assert.ok(applied.site.revision);
});

test('malformed, foreign and unsafe packages are refused before the site changes',async t=>{
 const s=await designedSite(t),{store}=s;
 const valid=readDesignArchive(await packageBytes((await exportWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,labels})).members));
 const json=JSON.parse(valid.get('design.json').toString());
 const zip=(members)=>Buffer.from(zipSync(Object.fromEntries([...members].map(([name,value])=>[name,typeof value==='string'?strToU8(value):new Uint8Array(value)]))));
 const review=bytes=>reviewWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,bytes});
 await assert.rejects(review(randomBytes(512)),{code:'WEBSITE_DESIGN_PACKAGE'});
 await assert.rejects(review(zip(new Map([...valid,['../outside.txt','x']]))),{code:'WEBSITE_DESIGN_PACKAGE'});
 await assert.rejects(review(zip(new Map([...valid,['files/extra.png','x']]))),{code:'WEBSITE_DESIGN_PACKAGE'});
 await assert.rejects(review(zip(new Map([...valid,['design.json',JSON.stringify({...json,version:99})]]))),{code:'WEBSITE_DESIGN_VERSION'});
 await assert.rejects(review(zip(new Map([...valid,['design.json',JSON.stringify({...json,format:'other'})]]))),{code:'WEBSITE_DESIGN_PACKAGE'});
 const planted={...json,components:json.components.map(c=>({...c,html:c.html.replace('<p>','<p data-observanda-source="x">')}))};
 await assert.rejects(review(zip(new Map([...valid,['design.json',JSON.stringify(planted)]]))),{code:'PRIVACY'});
 const missing={...json,regions:{footer:{...json.regions.footer,component:randomUUID()}}};
 await assert.rejects(review(zip(new Map([...valid,['design.json',JSON.stringify(missing)]]))),{code:'WEBSITE_DESIGN_PACKAGE'});
 const broken=new Map(valid);for(const [name] of valid)if(name.startsWith('files/pictures/'))broken.set(name,Buffer.from('not a picture'));
 const reviewed=await review(zip(broken));
 await assert.rejects(applyWebsiteDesign(store,s.siteId,{expectedRevision:s.revision,bytes:zip(broken),reviewId:reviewed.reviewId,options:{}}),{code:'WEBSITE_DESIGN_PACKAGE'});
 assert.throws(()=>readDesignArchive(zip(valid),{archive:64*1024*1024,members:2,member:1024*1024,total:8*1024*1024}),{code:'LIMIT'});
 assert.equal((await raw(store,s.siteId)).revision,s.revision,'nothing was saved');
});

test('a component that plays a recording travels with its recording and captions, which arrive prepared like an upload',async t=>{
 if(!(await mediaCapabilities()).available)return t.skip('Requires FFmpeg and FFprobe');
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-design-recording-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),siteId=randomUUID(),fixtures=await mediaFixtures(root);
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('A design read research');
 let state=await store.importFiles(siteId,{name:'Acoustics',files:new Map([['index.html',wrap('Hum','<section><p>Hive sound</p></section>')],['style.css','main{padding:1rem}']]),draftFiles:new Map([['private.html',wrap('Notes','<aside><p>Unfinished legend</p></aside>')],['draft-styles.css','']])});
 const cues=['WEBVTT','','00:00.000 --> 00:00.300','A tone',''].join(String.fromCharCode(10)),audio='recordings/'+randomUUID()+'.wav',track='recordings/'+randomUUID()+'.vtt';
 const html=state.html.replace('</section>','<figure data-website-recording><audio controls preload="none" src="'+audio+'"><track src="'+track+'" kind="captions" srclang="en" label="English" default></audio></figure></section>');
 const meta=Buffer.from(JSON.stringify({siteId,expectedRevision:state.site.revision,path:'index.html',html,css:state.css,tracks:[{name:track,text:cues}],recording:{name:audio,label:'Hive hum',size:fixtures.audio.bytes.length}})),length=Buffer.alloc(4);length.writeUInt32BE(meta.length);
 state=await saveRecordingUpload(store,await readRecordingUpload(Readable.from([length,meta,fixtures.audio.bytes])));
 state=await componentOperation(store,'create',siteId,{path:'index.html',expectedRevision:state.site.revision,blockPath:'0/1',name:'Players'});
 state=await componentOperation(store,'create',siteId,{path:'private.html',expectedRevision:state.site.revision,blockPath:'0/1',name:'Private legend'});

 const valid=readDesignArchive(await packageBytes((await exportWebsiteDesign(store,siteId,{expectedRevision:state.site.revision,labels})).members));
 const pkg=readDesignPackage(await packageBytes(valid));
 assert.deepEqual(pkg.components.map(c=>c.name),['Players']);
 assert.deepEqual(pkg.omitted,[{kind:'component',name:'Private legend',reason:'private'}]);
 assert.deepEqual(pkg.resources.filter(r=>r.recording).map(r=>[r.name,r.label]).sort(),[[audio,'Hive hum'],[track,undefined]].sort());

 // The original upload, metadata included, takes the place of the display copy: import must prepare it again.
 const planted=new Map(valid);planted.set('files/'+audio,fixtures.audio.bytes);
 const bytes=Buffer.from(zipSync(Object.fromEntries([...planted].map(([name,value])=>[name,new Uint8Array(value)]))));
 const blank=await blankSite(store);
 const review=await reviewWebsiteDesign(store,blank.id,{expectedRevision:blank.revision,bytes});
 assert.deepEqual(review.omitted,[{kind:'component',name:'Private legend',reason:'private'}]);
 await applyWebsiteDesign(store,blank.id,{expectedRevision:blank.revision,bytes,reviewId:review.reviewId,options:{}});
 const site=await raw(store,blank.id),main=site.components.find(c=>c.name==='Players');
 assert.equal(main.recordings.length,2);
 const files=new Map(site.files.map(f=>[f.name,f]));
 const sound=main.recordings.find(f=>f.name.endsWith('.wav')),caption=main.recordings.find(f=>f.name.endsWith('.vtt'));
 assert.notEqual(sound.name,audio);assert.notEqual(caption.name,track);
 assert.ok(main.html.includes(sound.name)&&main.html.includes(caption.name));
 assert.equal(files.get(sound.name).recording,true);assert.equal(files.get(sound.name).label,'Hive hum');assert.equal(files.get(sound.name).contentType,'audio/wav');
 const copy=await contentBuffer(await store.file(blank.id,sound.name,{editor:true}).then(f=>f.content),{maxBytes:8*1024*1024});
 assert.ok(copy.length);assert.equal(copy.includes(Buffer.from(PRIVATE_MARKER)),false,'the recording was prepared again, without its metadata');
 assert.equal((await contentBuffer(await store.file(blank.id,caption.name,{editor:true}).then(f=>f.content),{maxBytes:8192})).toString(),cues);
 assert.deepEqual(await readdir(path.join(root,'.observanda','website-files','recording-stage')),['writer']);
});
