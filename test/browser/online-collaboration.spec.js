import {test,expect} from '@playwright/test';
import path from 'node:path';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

async function openOnline(page){await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');await expect(page.getByRole('heading',{name:'Online collaboration',exact:true})).toBeVisible();}
test('ordinary installations host shared books and simultaneously edit text with retained disconnect drafts',async({browser})=>{
 test.setTimeout(240000);const cleanup=[],apps=[],contexts=[],errors=[];const f=await collaborationFixture({after:fn=>cleanup.push(fn)});
 try{
  const pages=[];
  for(const [i,fixture] of [f.author,f.member,f.member].entries()){
   const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore,preferencesFile:path.join(f.directory,i+'.prefs')});apps.push(app);const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(25000);await page.goto(app.url);await openOnline(page);
  }
  const [owner,a,b]=pages,dialog=owner.locator('#dialog');
  await owner.getByRole('button',{name:'Start hosting',exact:true}).click();await dialog.getByLabel('This computer’s network address',{exact:true}).fill('127.0.0.1');
  await expect(dialog).toContainText('trusted local network or VPN');await dialog.getByLabel('Listen on',{exact:true}).selectOption('127.0.0.1');
  await dialog.getByLabel('Listening port',{exact:true}).fill('0');await dialog.getByRole('button',{name:'Start hosting',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(owner.locator('.online-research')).toContainText('listening on 127.0.0.1');
  const [download]=await Promise.all([owner.waitForEvent('download'),owner.getByRole('button',{name:'Download connection card',exact:true}).click()]);const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const card=Buffer.concat(chunks);
  for(const page of [a,b]){
   await page.getByRole('button',{name:'Connect to an installation',exact:true}).click();const d=page.locator('#dialog');await d.getByLabel('Connection card',{exact:true}).setInputFiles({name:'test.observanda-online',mimeType:'application/json',buffer:card});await expect(d.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await d.getByRole('checkbox').check();await d.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(d).not.toBeVisible();
   await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(f.book.entries[0].id);await expect(page.getByRole('textbox',{name:'Shared writing area',exact:true})).toBeVisible();
  }
  const editA=a.getByRole('textbox',{name:'Shared writing area',exact:true}),editB=b.getByRole('textbox',{name:'Shared writing area',exact:true});
  await Promise.all([editA.press('Home').then(()=>editA.pressSequentially('Alpha ')),editB.press('Home').then(()=>editB.pressSequentially('Beta '))]);
  for(const edit of [editA,editB]){await expect(edit).toContainText('Alpha');await expect(edit).toContainText('Beta');}
  await expect(a.locator('[data-live-status]')).toHaveText('All text changes are saved on the host.');
  let rejectDraftRemoval=true,removalFailed=false;
  await a.route('**/api/live/draft',async route=>{if(route.request().postDataJSON().document===null&&rejectDraftRemoval){removalFailed=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic draft removal failure'})});}else await route.continue();});
  await editA.press('End');await editA.pressSequentially(' Retry draft cleanup');await expect(a.locator('[data-live-status]')).toContainText('could not be saved locally');expect(removalFailed).toBe(true);
  rejectDraftRemoval=false;await expect(a.locator('[data-live-status]')).toHaveText('All text changes are saved on the host.');await a.unroute('**/api/live/draft');
  await a.getByLabel('New comment',{exact:true}).fill('Review the synchronized text');await a.getByRole('button',{name:'Post comment',exact:true}).click();await expect(b.locator('[data-live-comments]')).toContainText('Review the synchronized text');
  await a.getByLabel('Record title',{exact:true}).fill('A shared result');await a.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(editA).toBeVisible();
  let lostTitleResponse=false;await a.route('**/api/live/request',async route=>{if(route.request().postDataJSON().operation==='fields'&&!lostTitleResponse){lostTitleResponse=true;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost response'})});}else await route.continue();});
  await a.getByRole('button',{name:'Save record details',exact:true}).click();await expect(a.getByRole('button',{name:'Retry pending request',exact:true})).toBeVisible();await expect(a.getByLabel('Record title',{exact:true})).toHaveAttribute('readonly','');
  await a.getByRole('button',{name:'Retry pending request',exact:true}).click();await expect(a.locator('.online-record>h3')).toHaveText('A shared result');await expect(a.getByRole('button',{name:'Save record details',exact:true})).toBeVisible();await a.unroute('**/api/live/request');
  await owner.getByRole('button',{name:'Stop hosting',exact:true}).click();await editA.press('End');await editA.pressSequentially(' Retained offline text');await expect(a.locator('[data-live-status]')).toContainText('Connection interrupted');
  const draft=await a.evaluate(async({workspaceId,recordId})=>{const s=await (await fetch('/api/live/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId})})).json(),connectionId=s.connections[0].id;return (await fetch('/api/live/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId,recordId,connectionId,clientId:sessionStorage.getItem('observanda.live.client.'+connectionId),field:'body'})})).json();},{workspaceId:(await f.member.workspace.outline()).metadata.id,recordId:f.book.entries[0].id});
  expect(JSON.stringify(draft)).toContain('Retained offline text');
  // A retained offline draft must survive a role change while disconnected.
  const {generation,...grant}=f.grant;void generation;
  await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'});
  await owner.getByRole('button',{name:'Start hosting',exact:true}).click();await dialog.getByLabel('This computer’s network address',{exact:true}).fill('127.0.0.1');
  await dialog.getByLabel('Listening port',{exact:true}).fill(new URL(JSON.parse(card).value.endpoint).port);await dialog.getByRole('button',{name:'Start hosting',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(a.locator('[data-live-status]')).toContainText('Your access changed');await expect(editA).toHaveCount(0);await expect(a.locator('[data-live-recovery]')).toContainText('Retained offline text');
  await expect(b.locator('[data-live-status]')).toContainText('Your access changed');
  const denied=(await f.author.workspace.read()).book.entries.find(r=>r.id===f.book.entries[0].id);expect(JSON.stringify(denied.body)).not.toContain('Retained offline text');
  await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:2,role:'editor'});
  for(const page of [a,b])await page.getByRole('button',{name:'Review latest shared version',exact:true}).click();
  await a.getByRole('button',{name:'Replace shared text with this retained version',exact:true}).click();await expect(editB).toContainText('Retained offline text');
  await expect(a.locator('[data-live-status]')).toHaveText('All text changes are saved on the host.');
  // More than one host batch remains in the editor while disconnected.
  await owner.getByRole('button',{name:'Stop hosting',exact:true}).click();await editA.press('End');const longText='abcdefghij'.repeat(61);await editA.pressSequentially(longText);
  await expect(a.locator('[data-live-status]')).toContainText('Your text is retained locally');
  await owner.getByRole('button',{name:'Start hosting',exact:true}).click();await dialog.getByLabel('This computer’s network address',{exact:true}).fill('127.0.0.1');await dialog.getByLabel('Listening port',{exact:true}).fill(new URL(JSON.parse(card).value.endpoint).port);await dialog.getByRole('button',{name:'Start hosting',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(editB).toContainText(longText);await expect(a.locator('[data-live-status]')).toHaveText('All text changes are saved on the host.');
  // Closing is blocked when the local write fails. Once retained, the draft
  // is available after reload without contacting the unavailable host.
  await owner.getByRole('button',{name:'Stop hosting',exact:true}).click();
  await a.route('**/api/live/draft',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Local draft write failed',code:'IO'})}));
  await editA.press('End');await editA.pressSequentially(' Recover after restart');await expect(a.locator('[data-live-status]')).toContainText('could not be saved locally');
  await a.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(editA).toBeVisible();
  await a.unroute('**/api/live/draft');await a.getByRole('button',{name:'Close shared books',exact:true}).click();await expect(editA).toHaveCount(0);
  await a.reload();await navigate(a,'Organizations & teams');
  await a.getByRole('button',{name:'Remove connection',exact:true}).click();await expect(a.getByRole('button',{name:'Open shared books',exact:true})).toHaveCount(0);
  await a.getByRole('button',{name:'Retained drafts',exact:true}).click();await a.getByRole('button',{name:'Read retained draft',exact:true}).click();await expect(a.locator('[data-online-draft-preview]')).toContainText('Recover after restart');
  await a.getByRole('button',{name:'Compare with shared record',exact:true}).click();await expect(a.locator('[data-online-draft-preview]')).toContainText('Recover after restart');
  await a.getByRole('button',{name:'Back to connections',exact:true}).click();
  await owner.getByRole('button',{name:'Start hosting',exact:true}).click();await dialog.getByLabel('This computer’s network address',{exact:true}).fill('127.0.0.1');await dialog.getByLabel('Listening port',{exact:true}).fill(new URL(JSON.parse(card).value.endpoint).port);await dialog.getByRole('button',{name:'Start hosting',exact:true}).click();await expect(dialog).not.toBeVisible();
  await a.getByRole('button',{name:'Connect to an installation',exact:true}).click();const reconnect=a.locator('#dialog');await reconnect.getByLabel('Connection card',{exact:true}).setInputFiles({name:'test.observanda-online',mimeType:'application/json',buffer:card});await expect(reconnect.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await reconnect.getByRole('checkbox').check();await reconnect.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(reconnect).not.toBeVisible();
  await a.getByRole('button',{name:'Retained drafts',exact:true}).click();await a.getByRole('button',{name:'Read retained draft',exact:true}).click();await a.getByRole('button',{name:'Compare with shared record',exact:true}).click();await a.getByRole('button',{name:'Replace shared text with this retained version',exact:true}).click();await expect(editB).toContainText('Recover after restart');await expect(a.locator('[data-live-status]')).toHaveText('All text changes are saved on the host.');
  await a.screenshot({path:test.info().outputPath('online-shared-writing.png')});await a.setViewportSize({width:390,height:844});expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await a.screenshot({path:test.info().outputPath('online-shared-writing-phone.png')});
  expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close();for(const app of apps)await app.close();for(const fn of cleanup.reverse())await fn();}
});
