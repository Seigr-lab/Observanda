import {test,expect} from '@playwright/test';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {LocalExport} from '../../src/local-export.js';
import {websitePublicationMetadata} from '../../src/website-publication-metadata.js';
import {entryStyleName} from '../../src/website-entry-styles.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';

test.use({screenshot:'off'});
test('editor-created menus publish with standalone theme styling, native keyboard submenus and page-relative current links',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-menu-style-')),root=path.join(directory,'workspace'),output=path.join(directory,'edition');
 await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(output);
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID(),nested='methods/salinity.html';
  workspace.openCatalogue=()=>{throw Error('File-only publish opened research');};
  const pageHTML=(title,css)=>'<html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+css+'"></head><body><main><h1>'+title+'</h1><nav class="manual"><a href="#notes">Chapter contents</a></nav><p id="notes">Field protocol</p></main></body></html>';
  const css=':root{--accent:rgb(24,95,76);--page-border:rgb(162,180,174);--page-surface:rgb(250,253,252);--corner-radius:8px}.manual a{color:rgb(110,32,61);font-style:italic}nav[data-website-menu] a{border-radius:11px}';
  const base=await store.importFiles(id,{name:'Coastal protocols',files:new Map([['index.html',pageHTML('Handbook','style.css')],[nested,pageHTML('Salinity method','../style.css')],['style.css',css]])});
  const item=(label,href,children=[])=>({key:null,label,href,children});
  const updated=await store.saveMenu(id,{expectedRevision:base.site.revision,items:[item('Home','index.html'),item('Methods',nested,[item('Salinity by station',nested)])]});
  const raw=()=>store.scope(()=>store.raw(id)),manifest=await raw();
  expect(manifest.files.find(f=>f.name===nested)?.editorMenu).toBe(true);
  expect(manifest.files.find(f=>f.name===entryStyleName)?.entryDisplaySheet).toBe(true);
  expect(updated.html).toContain('href="'+entryStyleName+'"');
  // This revision predates the public menu stylesheet and its descriptor flag.
  const old=await store.scope(async()=>{
   const value={...manifest,files:[]};delete value.revision;
   for(const file of manifest.files){
    if(file.name===entryStyleName)continue;
    if(!file.editorMenu){value.files.push(file);continue;}
    const html=(await store.readText(file)).replace(/<link\b[^>]*data-website-entry-stylesheet[^>]*>/,'');
    value.files.push(await store.descriptor(file.name,html,{owner:file.blob.split('/files/')[0]}));
   }
   value.revision=createHash('sha256').update(JSON.stringify(value)).digest('hex');const folder='.observanda/website-files/sites/'+id;
   await store.writeControl(folder+'/revisions/'+value.revision+'.json',value);await store.writeControl(folder+'/head.json',{revision:value.revision});return value.revision;
  },{write:true});
  const opened=await store.open(id,{path:nested});expect(opened.html).toContain('href="../'+entryStyleName+'"');
  const candidate=await WebsiteFilesCandidate.open(store,id,old);await candidate.verify({});
  const publish=new LocalExport(websitePublicationMetadata(store.publicationWorkspace(id)),{fileOwner:{
   locked:(_dir,work)=>store.withSite(id,old,work),candidate:async review=>{expect(review).toBe(candidate.reviewId);await candidate.verify({});return candidate;}
  }});
  const plan=await publish.plan({reviewId:candidate.reviewId,directory:output});
  await publish.apply({id:plan.id,reviewed:true});
  expect((await raw()).revision).toBe(old);expect((await raw()).files.some(f=>f.name===entryStyleName)).toBe(false);
  expect(await readFile(path.join(output,nested),'utf8')).toBe(opened.html);expect(await readFile(path.join(output,entryStyleName),'utf8')).toContain('nav[data-website-menu]');
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);
  const nav=page.locator('nav[data-website-menu]'),list=nav.locator(':scope>ul'),home=nav.getByRole('link',{name:'Home'});
  await expect(list).toHaveCSS('list-style-type','none');await expect(list).toHaveCSS('display','flex');
  await expect(home).toHaveAttribute('aria-current','page');await expect(home).toHaveCSS('color','rgb(24, 95, 76)');
  await expect(home).toHaveCSS('border-radius','11px');await expect(page.locator('.manual a')).toHaveCSS('color','rgb(110, 32, 61)');
  const summary=nav.locator('summary'),sub=nav.getByRole('link',{name:'Salinity by station'});
  await home.focus();await page.keyboard.press('Tab');await page.keyboard.press('Tab');await expect(summary).toBeFocused();
  await expect(summary).toHaveCSS('outline-style','solid');await page.keyboard.press('Enter');await expect(sub).toBeVisible();
  await page.keyboard.press('Tab');await expect(sub).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Salinity method'})).toBeVisible();
  await expect(nav.getByRole('link',{name:'Methods',exact:true})).toHaveAttribute('aria-current','page');
  await expect(nav.getByRole('link',{name:'Home'})).toHaveAttribute('href','../index.html');
  await page.setViewportSize({width:420,height:700});await nav.locator('summary').focus();await page.keyboard.press('Space');
  await expect(nav.getByRole('link',{name:'Salinity by station'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{
  await closeIdleMutationFiles();if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-menu-style-'))throw Error('Unexpected workspace');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:120});
 }
});
