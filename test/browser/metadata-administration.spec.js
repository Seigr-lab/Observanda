import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {migrationFixture} from '../migration-fixture.js';
import {navigate,preferences} from './preferences-helper.js';
for(const count of [65,650])test('storage, access and source inspection retain no research bodies at '+count+' records',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-administration-')),book=sampleNotebook(),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private original '+i,body:'PRIVATE_UNRELATED_BODY '.repeat(100),sections:[],figures:[],attachments:[],relations:[],contributors:[]}));
 const f=await encryptedFixture(path.join(directory,'app'),book),source=path.join(directory,'source');await migrationFixture(source,{creative:true});
 const before=await f.workspace.catalogue(s=>s.head()),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences')}),original={read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record},requests=[],errors=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace loaded during administration');};ResearchCatalogue.prototype.record=()=>{throw Error('Original loaded during administration');};
 page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
 const cdp=await page.context().newCDPSession(page);let heap=0;const measure=async()=>{heap=Math.max(heap,(await cdp.send('Runtime.getHeapUsage')).usedSize);};
 try{
  const session=await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});expect(session.ok()).toBe(true);
  await page.goto(app.origin+'/#/preferences/storage');await expect(page.getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();await measure();
  await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();await expect(page.getByRole('heading',{name:'Workspace access',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
  await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  await page.getByLabel('Source folder',{exact:true}).fill(source);await page.getByRole('button',{name:'Inspect source',exact:true}).click();await expect(page.getByRole('heading',{name:'Inventory fully accounted for',exact:true})).toBeVisible();await measure();
  await page.getByRole('button',{name:'Back to workspaces',exact:true}).click();await expect(page.getByRole('heading',{name:'Your workspaces',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
  await preferences(page,'Storage & access');await expect(page.getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Workspace storage',exact:true})).toBeVisible();await measure();
  expect(requests.filter(p=>p==='/api/notebook'||p==='/api/workspace/read/page'||p==='/api/workspace/read/selection')).toEqual([]);expect(errors).toEqual([]);expect(await f.workspace.catalogue(s=>s.head())).toBe(before);expect(heap).toBeLessThan(96*1024*1024);
  console.log(JSON.stringify({records:count,sampledBrowserHeapMiB:Math.round(heap/1024**2),originalReads:0}));
 }finally{ResearchCatalogue.prototype.read=original.read;ResearchCatalogue.prototype.record=original.record;await cdp.detach();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
