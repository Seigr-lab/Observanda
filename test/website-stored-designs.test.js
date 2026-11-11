import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {componentOperation} from '../src/website-component-storage.js';
import {websitePageDesigns,storedDesignStyle} from '../src/website-page-designs.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {writeVisualStyle} from '../src/web/website-files-visual-style.js';
import {websiteSiteLifecycle} from '../src/website-site-lifecycle.js';

const wrap=(title,body)=>'<html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
const labels={heading:'Heading',text:'New writing',image:'Site picture'};

test('a kept design outlives changes to its page and makes nested pages with relinked links, pictures and new component copies',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stored-design-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),siteId=randomUUID();
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('A stored design read research');
 const photo='pictures/'+randomUUID()+'.png',layout='ow-visual-'+randomUUID();
 let page=await store.importFiles(siteId,{name:'Apiary',files:new Map([['index.html',wrap('Home','<p>Home</p>')],['layout.html',wrap('Layout','<p>x</p>')],['about.html',wrap('About','<p>About</p>')],['style.css','main{padding:1rem}']])});
 let revision=page.site.revision;
 const act=(action,opts={})=>websitePageDesigns(store,siteId,{expectedRevision:revision,action,path:'layout.html',...opts});
 const css=writeVisualStyle('main{padding:1rem}',layout,{length:1,cssText:'padding: 33px;'});
 const body='<section class="'+layout+'"><h2>Colony</h2><p><a href="about.html">About the apiary</a></p><img src="'+photo+'" alt="Frame" width="40" height="30"></section><aside><p>Legend</p></aside>';
 page=await store.save(siteId,{expectedRevision:revision,path:'layout.html',html:wrap('Layout',body),css,receivePictures:async function*(){yield {name:photo,bytes:Buffer.from('Owned public photo')};}});revision=page.site.revision;
 page=await componentOperation(store,'create',siteId,{path:'layout.html',expectedRevision:revision,blockPath:'0/2',name:'Legend'});revision=page.site.revision;
 page=await act('name',{name:'Inspection layout'});revision=page.site.revision;
 const [live]=(await act('list')).items;assert.deepEqual(Object.keys(live).sort(),['id','name','source']);

 page=await act('keep',{design:live.id,labels});revision=page.site.revision;
 const [kept]=(await act('list')).items;assert.deepEqual(kept,{id:live.id,name:'Inspection layout',stored:true});
 assert.equal((await act('list')).local,null);

 // The page itself changes completely; the kept design does not.
 const placed=(await store.scope(()=>store.raw(siteId))).pages.find(p=>p.path==='layout.html').instances[0].id;
 page=await componentOperation(store,'detach',siteId,{path:'layout.html',expectedRevision:revision,instance:placed});revision=page.site.revision;
 page=await store.open(siteId,{path:'layout.html'});
 page=await store.save(siteId,{expectedRevision:revision,path:'layout.html',html:wrap('Layout','<p>Rewritten</p>'),css:page.css});revision=page.site.revision;
 page=await act('use',{design:kept.id,destination:'yard/north/inspection.html',title:'North yard',language:'en',inclusion:'included'});revision=page.site.revision;
 const made=(await store.open(siteId,{path:'yard/north/inspection.html'})).html;
 assert.match(made,/<h1>North yard<\/h1>/);
 assert.match(made,/<a href="\.\.\/\.\.\/about\.html">/);
 assert.match(made,new RegExp('<img[^>]* src="\\.\\./\\.\\./'+photo.replace(/[.]/g,'\\.')+'"'));
 assert.match(made,/<aside data-website-instance="[^"]+"><p>/);
 assert.doesNotMatch(made,/data-website-design-component|Rewritten/);
 const instance=made.match(/data-website-instance="([^"]+)"/)[1];
 assert.ok(instance);

 // The kept design's stylesheet and pictures are private until a page uses them.
 const manifest=await store.scope(()=>store.raw(siteId));
 const sheet=manifest.files.find(f=>f.name===storedDesignStyle(kept.id));
 assert.equal(sheet.draft,true);assert.deepEqual(manifest.pictureStyles[storedDesignStyle(kept.id)],[photo]);

 // A component the kept design places cannot be removed while the design keeps it.
 const legend=(await store.scope(()=>store.raw(siteId))).components[0].id;
 await assert.rejects(componentOperation(store,'remove',siteId,{path:'layout.html',expectedRevision:revision,component:legend}),{code:'INVALID'});

 // A copied site gets its own copy of the kept design, naming the copy's components.
 const copyId=randomUUID(),args={action:'duplicate',copyId,title:'Apiary copy',expectedRevision:revision};
 const review=await websiteSiteLifecycle(store,siteId,args);await websiteSiteLifecycle(store,siteId,{...args,reviewId:review.reviewId},true);
 const copy=await store.scope(()=>store.raw(copyId)),copiedDesign=copy.pageDesigns.find(d=>d.template);
 assert.deepEqual(copiedDesign.template.components,[copy.components[0].id]);assert.notEqual(copy.components[0].id,legend);
 assert.match(copiedDesign.template.content,new RegExp('data-website-design-component="'+copy.components[0].id+'"'));
 const used=await websitePageDesigns(store,copyId,{expectedRevision:copy.revision,action:'use',path:'index.html',design:copiedDesign.id,destination:'made.html',title:'Made',language:'en',inclusion:'included'});
 assert.match(used.html,/<aside data-website-instance="[^"]+"><p>/);

 // Forgetting the kept design removes its stylesheet and picture group; pages keep their copies.
 page=await act('forget',{design:kept.id});revision=page.site.revision;
 const after=await store.scope(()=>store.raw(siteId));
 assert.equal(after.files.some(f=>f.name===storedDesignStyle(kept.id)),false);
 assert.equal(after.pictureStyles?.[storedDesignStyle(kept.id)],undefined);
 assert.ok(after.files.some(f=>f.name===photo),'the picture stays while a page uses it');
 assert.equal((await act('list')).items.length,0);
});
