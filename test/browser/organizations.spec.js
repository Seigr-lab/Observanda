import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';

async function bytes(download){const stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);return Buffer.concat(parts);}
async function download(page,action){const [file]=await Promise.all([page.waitForEvent('download',{timeout:15000}),action()]);return bytes(file);}
const upload=(locator,name,buffer)=>locator.setInputFiles({name,mimeType:'application/json',buffer});

test('organization membership completes through two app installations with verified files and editable teams',async({browser})=>{
  test.setTimeout(150000);
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-organizations-ui-')),fixtures=[],apps=[],contexts=[],pages=[],errors=[];
  try{
    for(const name of ['administrator','recipient']){
      const fixture=await encryptedFixture(path.join(directory,name),sampleNotebook());fixtures.push(fixture);
      const app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,name+'.prefs')});apps.push(app);
      const context=await browser.newContext(),page=await context.newPage();contexts.push(context);pages.push(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
      await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');await expect(page.getByRole('heading',{name:'Organizations & teams',exact:true})).toBeVisible();
    }
    const [a,b]=pages,ad=a.locator('#dialog'),bd=b.locator('#dialog');
    const identity=await download(b,()=>b.getByRole('button',{name:'Download my public identity',exact:true}).click());
    await a.getByRole('button',{name:'Create organization',exact:true}).click();await ad.getByLabel('Organization name',{exact:true}).fill('Field research cooperative');await ad.getByLabel('Your name',{exact:true}).fill('Research administrator');await ad.getByRole('button',{name:'Create organization',exact:true}).click();await expect(ad).not.toBeVisible();
    await a.getByRole('button',{name:'Create team',exact:true}).click();await ad.getByLabel('Team name',{exact:true}).fill('Field observations');
    let releaseRefresh,refreshStarted=false;const refreshGate=new Promise(resolve=>{releaseRefresh=resolve;});
    const delayRefresh=async route=>{refreshStarted=true;await refreshGate;await route.continue();};
    await a.route('**/api/organizations/state',delayRefresh);
    try{
      await ad.getByRole('button',{name:'Save',exact:true}).click();await expect.poll(()=>refreshStarted).toBe(true);
      await expect(ad).toBeVisible();await expect(ad.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    }finally{releaseRefresh();}
    await expect(ad).not.toBeVisible();
    await a.unroute('**/api/organizations/state',delayRefresh);
    await a.getByRole('button',{name:'Invite member',exact:true}).click();await ad.getByLabel('Recipient name',{exact:true}).fill('Field observer');await upload(ad.getByLabel('Recipient public identity file',{exact:true}),'observer.observanda-identity',identity);await expect(ad.locator('[data-organization-fingerprint]')).toContainText('Fingerprint:');await ad.getByLabel('I verified this complete fingerprint with the person through another channel.',{exact:true}).check();await ad.getByLabel('Field observations',{exact:true}).check();
    const invitation=await download(a,()=>ad.getByRole('button',{name:'Save',exact:true}).click());await expect(ad).not.toBeVisible();
    const recovered=await download(a,()=>a.getByRole('button',{name:'Download invitation',exact:true}).click());expect(JSON.parse(recovered).value).toEqual(JSON.parse(invitation).value);
    await b.getByRole('button',{name:'Open invitation',exact:true}).click();await upload(bd.getByLabel('Organization exchange file',{exact:true}),'organization.observanda-invitation',invitation);await bd.getByRole('button',{name:'Review invitation',exact:true}).click();await expect(bd).toContainText('Field research cooperative');await bd.getByRole('checkbox').check();
    await expect(bd).toContainText('Field observations');
    const acceptance=await download(b,()=>bd.getByRole('button',{name:'Accept and download response',exact:true}).click());await expect(bd).not.toBeVisible();await expect(b.locator('main')).toContainText("Waiting for the administrator's confirmation");
    await a.getByRole('button',{name:'Import acceptance',exact:true}).click();await upload(ad.getByLabel('Organization exchange file',{exact:true}),'organization.observanda-acceptance',acceptance);
    const confirmation=await download(a,()=>ad.getByRole('button',{name:'Import',exact:true}).click());await expect(ad).not.toBeVisible();await expect(a.locator('main')).toContainText('Field observations (1)');
    await b.getByRole('button',{name:'Import confirmation',exact:true}).click();await upload(bd.getByLabel('Organization exchange file',{exact:true}),'organization.observanda-membership',confirmation);await bd.getByRole('button',{name:'Import',exact:true}).click();await expect(bd).not.toBeVisible();await expect(b.locator('main')).toContainText('Acceptance confirmed at');
    await a.locator('main p').filter({hasText:'Field observer — Member'}).getByRole('button',{name:'Edit',exact:true}).click();await ad.getByRole('button',{name:'Remove member',exact:true}).click();await ad.getByRole('checkbox').check();await ad.getByRole('button',{name:'Save',exact:true}).click();await expect(ad).not.toBeVisible();await expect(a.locator('main')).toContainText('Field observer — Removed');await expect(a.locator('main')).toContainText('Field observations (0)');
    await a.reload();await expect(a.locator('main')).toContainText('Field observer — Removed');
    await a.getByRole('button',{name:'Membership activity',exact:true}).click();
    await expect(ad.getByRole('heading',{name:'Member changed',exact:true})).toBeVisible();
    await expect(ad).toContainText('Membership: Removed');await expect(ad).toContainText('Research administrator');await expect(ad).toContainText('Invitation accepted');
    await ad.getByRole('button',{name:'Close',exact:true}).click();await expect(ad).not.toBeVisible();
    await a.screenshot({path:test.info().outputPath('organizations-desktop.png'),fullPage:true});
    await a.setViewportSize({width:390,height:844});await expect(a.getByRole('heading',{name:'Organizations & teams',exact:true})).toBeVisible();expect(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
    await a.screenshot({path:test.info().outputPath('organizations-phone.png'),fullPage:true});
  }finally{for(const context of contexts)await context.close().catch(()=>{});for(const app of apps)await app.close();for(const fixture of fixtures)clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
