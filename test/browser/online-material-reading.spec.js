import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {LiveConnections} from '../../src/collaboration/live-connections.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {createFigure} from '../../src/web/figure-model.js';
import {navigate,preferences} from './preferences-helper.js';

test('shared evidence opens exact datasets, figures and source downloads inline while preserving other edits',async({browser},testInfo)=>{
 test.setTimeout(180000);const cleanup=[],errors=[],f=await collaborationFixture({after:fn=>cleanup.push(fn)}),source=f.book.entries[0],other=f.book.entries[1],m=new ResearchMaterials(f.author.workspace);
 const precise='9007199254740993.000000001',csv=Buffer.from(Array.from({length:17},(_,i)=>'Channel '+i).join(',')+'\n'+Array.from({length:60},(_,i)=>[i,...Array(16).fill(precise)].join(',')).join('\n'));
 const upload=await m.startImport({recordId:other.id,name:'measurements.csv',size:csv.length});await m.appendImport(upload.id,0,[csv]);const artifact=await m.finishImport(upload.id),dataset=await m.dataset({recordId:other.id,title:'Exact observations',artifact});
 const plot=await m.plot({recordId:other.id,title:'Observation counts',dataset,mapping:{x:0,xKind:'category',values:[],group:null,operation:'count',kind:'bar',order:'source',mode:'replace',decimal:'.'},base:createFigure()});
 await m.analysis({recordId:source.id,title:'Decoded acquisition',tool:'Synthetic decoder',version:'fixture-1',parameters:'Keep exact decimal spelling',inputs:[dataset,plot.ref],outputs:[artifact]});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),card=await host.card(f.grant.id),manager=new LiveConnections(f.member.workspace,f.member.deviceStore);
 await manager.command('connect',{card,verifiedFingerprint:card.identity.id});await manager.close();
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'material-reading.prefs')}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(source.id);
  const details=page.locator('[data-live-details]');await details.getByLabel('Record title',{exact:true}).fill('Keep my unsaved title');
  const evidence=page.locator('[data-live-evidence]'),inspection=evidence.locator('[data-evidence-inspection]');await evidence.locator('>summary').click();await evidence.getByRole('button',{name:'Inspect Decoded acquisition',exact:true}).click();await expect(inspection).toContainText('Keep exact decimal spelling');await expect(inspection).toHaveAttribute('aria-busy','false');
  await inspection.getByRole('button',{name:'Observation counts',exact:true}).click();await expect(inspection.locator('[data-reference-figure] svg')).toBeVisible();await inspection.locator('.figure-reading-control input').check();await expect(inspection.locator('.figure-reading-control input')).toBeChecked();await inspection.getByRole('button',{name:'Back to referring evidence',exact:true}).click();
  await inspection.getByRole('button',{name:'Exact observations',exact:true}).click();await expect(inspection.locator('tbody tr')).toHaveCount(50);await expect(inspection.locator('tbody')).toContainText(precise);await inspection.getByRole('button',{name:'Next rows',exact:true}).click();await expect(inspection.locator('tbody tr')).toHaveCount(10);await inspection.getByRole('button',{name:'Next columns',exact:true}).click();await expect(inspection).toContainText('Columns 17–17 of 17');await expect(inspection.locator('thead')).toContainText('Channel 16');
  await inspection.getByRole('button',{name:'Back to referring evidence',exact:true}).click();await inspection.getByRole('button',{name:'measurements.csv',exact:true}).click();const downloading=page.waitForEvent('download');await inspection.getByRole('link',{name:'Download measurements.csv',exact:true}).click();expect(await readFile(await(await downloading).path())).toEqual(csv);
  await expect(details.getByLabel('Record title',{exact:true})).toHaveValue('Keep my unsaved title');await expect(evidence.locator('..')).toHaveAttribute('aria-busy','false');
  await page.setViewportSize({width:390,height:844});await inspection.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('shared-retained-evidence.png')});
  await evidence.getByRole('button',{name:'Close evidence inspection',exact:true}).click();await expect(inspection).toBeHidden();await details.getByRole('button',{name:'Discard detail changes',exact:true}).click();await page.getByRole('button',{name:'Close shared books',exact:true}).click();expect(errors).toEqual([]);
 }finally{await context.close();await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});
