import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {retainedCollaborationFigure} from '../fixtures/retained-collaboration-figure.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {LiveConnections} from '../../src/collaboration/live-connections.js';
import {startServer} from '../../src/server.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchExchange} from '../../src/collaboration/research-exchange.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {Workspace} from '../../src/storage.js';
import {navigate,preferences} from './preferences-helper.js';

test('live and returned-review figures page and download complete data while preserving unfinished choices',async({browser},testInfo)=>{
 test.setTimeout(240000);const cleanup=[],apps=[],contexts=[],errors=[],f=await collaborationFixture({after:fn=>cleanup.push(fn)}),recordId=f.book.entries[0].id,{figure}=await retainedCollaborationFigure(f.author.workspace,f.book.id,recordId,{points:33});
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),incoming=await f.sb.receive(await f.sa.outgoing(offer.id)),destination=path.join(f.directory,'review-copy');await f.sb.acceptCopy(incoming.id,destination);
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const copied=new Workspace(destination,vault),record=(await copied.read()).book.entries.find(row=>row.id===recordId);await new ResearchRecords(copied,{}).save({workspaceId:f.book.id,changes:[{id:recordId,expectedRevision:recordRevision(record),record:{...record,title:'Proposed shared observation'}}]});
 const returnedBy=new ResearchExchange(copied,f.member.deviceStore),changes=await returnedBy.prepareChanges(),returned=await f.sa.receive(await returnedBy.outgoing(changes.id));
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'}),card=await host.card(f.grant.id),manager=new LiveConnections(f.member.workspace,f.member.deviceStore);await manager.command('connect',{card,verifiedFingerprint:card.identity.id});await manager.close();
 async function open(owner,name){
  const app=await startServer({root:owner.workspace.root,port:0,headless:true,deviceStore:owner.deviceStore,preferencesFile:path.join(f.directory,name+'.prefs')});apps.push(app);
  const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();contexts.push(context);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');return page;
 }
 async function download(page,reader,format){
  const pending=page.waitForEvent('download');await reader.getByRole('link',{name:format,exact:true}).click();const result=await pending;expect(await result.failure()).toBeNull();return (await readFile(await result.path())).toString('utf8');
 }
 try{
  const live=await open(f.member,'live-figure');await live.getByRole('button',{name:'Open shared books',exact:true}).click();await live.locator('[data-online-record]').selectOption(recordId);
  const details=live.locator('[data-live-details]');await expect(details).toBeVisible();await details.getByLabel('Record title',{exact:true}).fill('Unfinished local title');
  await live.locator('[data-live-read]>summary').click();const reading=live.locator('[data-reader-record]');await reading.getByRole('button',{name:'Open retained figure',exact:true}).click();await expect(reading.locator('[data-rf-range]')).toHaveText('1-32 of 33');
  await reading.locator('[data-rf="observations-next"]').click();await expect(reading.locator('[data-rf-range]')).toHaveText('33-33 of 33');await expect(details.getByLabel('Record title',{exact:true})).toHaveValue('Unfinished local title');
  expect((await download(live,reading,'CSV')).match(/^"measurement",/gm)).toHaveLength(33);expect(JSON.parse(await download(live,reading,'Source JSON')).series).toEqual(figure.series);
  await reading.scrollIntoViewIfNeeded();await live.screenshot({path:testInfo.outputPath('live-retained-figure-desktop.png')});await live.setViewportSize({width:390,height:844});await reading.locator('[data-rf-range]').scrollIntoViewIfNeeded();expect(await live.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await live.screenshot({path:testInfo.outputPath('live-retained-figure-phone.png')});
  await details.getByRole('button',{name:'Discard detail changes',exact:true}).click();await live.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(details).toHaveCount(0);
  const owner=await open(f.author,'review-figure');await owner.locator('[data-command="sharing-review"][data-id="'+returned.id+'"]').click();const dialog=owner.locator('#dialog'),choice=dialog.locator('[name="choice-'+recordId+'"]');await choice.selectOption('current');await dialog.getByRole('button',{name:'Compare versions',exact:true}).click();
  const proposed=dialog.locator('[data-sharing-figure-version="incoming"]');await expect(proposed).toContainText('Proposed shared observation');await proposed.getByRole('button',{name:'Open retained figure',exact:true}).click();await expect(proposed.locator('[data-rf-range]')).toHaveText('1-32 of 33');
  await proposed.locator('[data-rf="observations-next"]').click();await expect(proposed.locator('[data-rf-range]')).toHaveText('33-33 of 33');expect((await download(owner,proposed,'CSV')).match(/^"measurement",/gm)).toHaveLength(33);
  await proposed.locator('[data-rf-range]').scrollIntoViewIfNeeded();await owner.screenshot({path:testInfo.outputPath('review-retained-figure-desktop.png')});await owner.setViewportSize({width:390,height:844});await proposed.locator('[data-rf-range]').scrollIntoViewIfNeeded();expect(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await owner.screenshot({path:testInfo.outputPath('review-retained-figure-phone.png')});
  await dialog.getByRole('button',{name:'Back to review',exact:true}).click();await expect(choice).toHaveValue('current');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await f.author.workspace.read()).book.entries.find(row=>row.id===recordId).title).toBe(f.book.entries[0].title);const activity=await owner.evaluate(async()=>await(await fetch('/api/activity')).json());expect(activity.operations.some(item=>item.kind==='/api/sharing/figure')).toBe(false);expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close();for(const app of apps)await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});
