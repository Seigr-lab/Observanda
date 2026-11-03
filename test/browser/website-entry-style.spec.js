import {test,expect} from '@playwright/test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {setPlacementPresentation} from '../../src/website-file-placements.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {entryStyleName} from '../../src/website-entry-styles.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {contentBuffer} from '../../src/file-content.js';

test.use({screenshot:'off'});
test('title cards publish in reviewed order with theme defaults and author overrides, including an older saved page',async({page})=>{
 test.setTimeout(90000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-entry-style-')),output=path.join(root,'published');
 await mkdir(path.join(root,'.observanda'));await mkdir(output);
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.openCatalogue=()=>{throw Error('File editor opened research');};
  const store=new WebsiteFileStore(workspace),site=randomUUID(),nested='field/notes.html',draft='draft/working.html';
  const html=css=>'<html><head><title>Measurements</title><link rel="stylesheet" href="'+css+'"></head><body><main><h1>Measurements</h1></main></body></html>';
  const styles=':root{--accent:rgb(30,87,80);--page-border:rgb(110,120,130);--page-surface:rgb(240,245,244);--card-padding:24px;--corner-radius:12px}.website-entry-card{border-radius:19px}';
  let opened=await store.importFiles(site,{name:'Field work',files:new Map([['index.html',html('style.css')],[nested,html('../style.css')],['style.css',styles]]),draftFiles:new Map([[draft,html('../draft-styles.css')],['draft-styles.css',styles]])});
  const rows=[];
  for(const title of ['Transect A','Transect B']){
   const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}),token=await store.beginSourceUpdate({sourceId});
   const {revision}=await store.putSource({sourceId,title,html:'<p data-observanda-part="body">Details omitted from this card</p>'},{token});
   rows.push({sourceId,sourceRevision:revision});
  }
  const batch=(sources,pagePath)=>store.insertSources(site,{expectedRevision:opened.site.revision,path:pagePath,sources,position:'end',presentation:'card'});
  const pinned=opened.site.revision;
  await expect(batch([rows[1],{...rows[0],sourceRevision:'0'.repeat(64)}],nested)).rejects.toMatchObject({code:'CONFLICT'});
  expect((await store.open(site,{path:nested})).site.revision).toBe(pinned);
  opened=await batch([rows[1],rows[0]],nested);
  expect(opened.html).toContain('href="../'+entryStyleName+'"');expect(opened.html).not.toContain('Details omitted');
  expect(opened.html.indexOf('Transect B')).toBeLessThan(opened.html.indexOf('Transect A'));
  opened=await batch([rows[0]],draft);
  const raw=()=>store.scope(()=>store.raw(site));
  // Recreate the previous canonical file format, in this encrypted fixture
  // only: both HTML files contain owned card markers but no display styles.
  const previous=await store.scope(async()=>{
   const current=await store.raw(site),old={...current,files:[]};delete old.revision;
   for(const file of current.files){
    if(file.name===entryStyleName)continue;
    if(!file.entryStyle){old.files.push(file);continue;}
    const unstyled=(await store.readText(file)).replace(/<link\b[^>]*data-website-entry-stylesheet[^>]*>/,'');
    const descriptor=await store.descriptor(file.name,unstyled,{owner:file.blob.split('/files/')[0]});
    old.files.push({...descriptor,...(file.draft?{draft:true}:{})});
   }
   old.revision=createHash('sha256').update(JSON.stringify(old)).digest('hex');
   const dir='.observanda/website-files/sites/'+site;
   await store.writeControl(dir+'/revisions/'+old.revision+'.json',old);await store.writeControl(dir+'/head.json',{revision:old.revision});return old.revision;
  },{write:true});
  opened=await store.open(site,{path:nested});expect(opened.html).toContain('../'+entryStyleName);
  expect((await raw()).revision).toBe(previous);expect((await raw()).files.some(f=>f.name===entryStyleName)).toBe(false);
  const preview=await store.file(site,nested,{revision:previous});expect((await contentBuffer(preview.content)).toString()).toBe(opened.html);
  const edition=await WebsiteFilesCandidate.open(store,site,previous);await edition.verify({});
  expect(edition.files.has(draft)).toBe(false);
  for(const name of [nested,'style.css',entryStyleName]){
   const file=path.join(output,...name.split('/'));await mkdir(path.dirname(file),{recursive:true});
   await writeFile(file,await contentBuffer(edition.files.get(name)));
  }
  await page.goto(pathToFileURL(path.join(output,...nested.split('/'))).href);
  const cards=page.locator('.website-entry-card');await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveCSS('padding-top','24px');await expect(cards.first()).toHaveCSS('border-left-style','solid');
  await expect(cards.first()).toHaveCSS('border-left-color','rgb(30, 87, 80)');
  await expect(cards.first()).toHaveCSS('background-color','rgb(240, 245, 244)');
  await expect(cards.first()).toHaveCSS('border-radius','19px');
  opened=await store.save(site,{...opened,path:nested,expectedRevision:previous,html:opened.html.replace('Measurements</h1>','Updated measurements</h1>')});
  expect((await raw()).files.find(f=>f.name===entryStyleName)?.entryDisplaySheet).toBe(true);
  expect((await raw()).files.find(f=>f.name===draft)?.entryStyle).toBeTruthy();
  const full=async(pagePath,row)=>{opened=await setPlacementPresentation(store,site,{expectedRevision:opened.site.revision,path:pagePath,ordinal:0,...row,presentation:'full'});};
  await full(nested,rows[0]);await full(nested,rows[1]);
  expect(opened.html).not.toContain(entryStyleName);expect((await store.export(site)).files.has(entryStyleName)).toBe(false);
  await expect(store.file(site,entryStyleName)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await store.file(site,entryStyleName,{editor:true})).content).toBeTruthy();
  await full(draft,rows[0]);expect((await raw()).files.some(f=>f.name===entryStyleName)).toBe(false);
 }finally{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('observanda-entry-style-'))throw Error('Unexpected workspace');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:120});
 }
});
