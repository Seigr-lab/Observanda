import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {setRecordTitle} from './record-editing-helper.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {OrganizationExchange} from '../../src/collaboration/organization-exchange.js';
import {navigate,preferences} from './preferences-helper.js';

async function download(page,action){const [file]=await Promise.all([page.waitForEvent('download'),action()]),stream=await file.createReadStream(),parts=[];for await(const part of stream)parts.push(part);return Buffer.concat(parts);}
const upload=(locator,name,buffer)=>locator.setInputFiles({name,mimeType:'application/octet-stream',buffer});
async function openSharing(page){await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');await expect(page.getByRole('heading',{name:'Shared lab books',exact:true})).toBeVisible();}

test('two installed app sessions grant, exchange, edit and review shared books through the UI',async({browser})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-shared-ui-')),fixtures=[],apps=[],contexts=[],errors=[];
 try{
  const book=sampleNotebook(),hidden=randomUUID();book.notebooks.push({id:hidden,projectId:book.projects[0].id,title:'Owner private journal'});book.entries[2].notebookId=hidden;
  for(const [name,content] of [['owner',book],['member',sampleNotebook()]])fixtures.push(await encryptedFixture(path.join(directory,name),content));
  const a=new OrganizationExchange(fixtures[0].workspace,fixtures[0].deviceStore),b=new OrganizationExchange(fixtures[1].workspace,fixtures[1].deviceStore),identity=await b.identity.public(),owner=await a.identity.public(),org=(await a.organizations.create({workspaceId:book.id,name:'Field cooperative',administratorName:'Owner',expectedRevision:0,identity:owner})).organization;
  const state=()=>a.organizations.load(),invitation=await a.command('invitation.create',{organizationId:org.id,identity,verifiedFingerprint:identity.id,name:'Field observer',role:'member',teamIds:[],expiresAt:new Date(Date.now()+86400000).toISOString()},(await state()).revision),acceptance=await b.accept(invitation.file,owner.id),confirmation=await a.receive(acceptance.file);await b.receipt(confirmation.file);
  const pages=[];
  for(const [i,f] of fixtures.entries()){
   const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,i+'.prefs')});apps.push(app);const context=await browser.newContext(),page=await context.newPage();contexts.push(context);pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await openSharing(page);
  }
  const [ownerPage,memberPage]=pages,od=ownerPage.locator('#dialog'),md=memberPage.locator('#dialog');
  const contact=await download(memberPage,()=>memberPage.getByRole('button',{name:'Download my sharing contact',exact:true}).click());
  await ownerPage.getByRole('button',{name:'Grant access',exact:true}).click();await od.getByLabel('Member or team',{exact:true}).selectOption({label:'Field observer'});await od.getByLabel('Field journal',{exact:true}).check();await od.getByLabel('Permission',{exact:true}).selectOption('editor');await od.getByRole('button',{name:'Save access',exact:true}).click();await expect(od).not.toBeVisible();
  for(const role of ['reader','editor']){await ownerPage.getByRole('button',{name:'Edit access',exact:true}).click();await expect(od.getByLabel('Field journal',{exact:true})).toBeChecked();await expect(od.getByLabel('Member or team',{exact:true})).toHaveValue(/member:/);await od.getByLabel('Permission',{exact:true}).selectOption(role);await od.getByRole('button',{name:'Save access',exact:true}).click();await expect(od).not.toBeVisible();await expect(ownerPage.getByRole('button',{name:'Edit access',exact:true})).toHaveCount(1);}
  await ownerPage.getByRole('button',{name:'Prepare encrypted copy',exact:true}).click();await upload(od.getByLabel("Recipient's sharing contact",{exact:true}),'contact.observanda-sharing-contact',contact);await od.getByRole('button',{name:'Prepare encrypted copy',exact:true}).click();await expect(od).not.toBeVisible();
  const shared=await download(ownerPage,()=>ownerPage.getByRole('link',{name:'Download encrypted file',exact:true}).click());
  expect(shared.includes(Buffer.from('Owner private journal'))).toBe(false);
  await memberPage.getByRole('button',{name:'Open exchange file',exact:true}).click();await upload(md.getByLabel('Encrypted research file',{exact:true}),'research.observanda-share',shared);await md.getByRole('button',{name:'Inspect file',exact:true}).click();await expect(md).not.toBeVisible();
  const destination=path.join(directory,'working-copy');await memberPage.getByRole('button',{name:'Create shared workspace',exact:true}).click();await md.getByLabel('Empty workspace folder',{exact:true}).fill(destination);await md.getByRole('button',{name:'Create shared workspace',exact:true}).click();await expect(md).not.toBeVisible();
  await navigate(memberPage,'Workspaces');await md.getByRole('button',{name:'Open existing',exact:true}).click();await md.locator('[name=storagePath]').fill(destination);await md.getByRole('button',{name:'Open workspace',exact:true}).click();await expect(md).not.toBeVisible();
  await memberPage.getByRole('region',{name:'Recent records',exact:true}).getByRole('button',{name:/Watching a seed unfold/}).click();await setRecordTitle(memberPage,'Observation from the field observer');
  await openSharing(memberPage);await memberPage.getByRole('button',{name:'Prepare my changes',exact:true}).click();await expect(memberPage.getByRole('link',{name:'Download encrypted file',exact:true})).toBeVisible();
  const changes=await download(memberPage,()=>memberPage.getByRole('link',{name:'Download encrypted file',exact:true}).click());
  await ownerPage.getByRole('button',{name:'Open exchange file',exact:true}).click();await upload(od.getByLabel('Encrypted research file',{exact:true}),'changes.observanda-share',changes);await od.getByRole('button',{name:'Inspect file',exact:true}).click();await expect(od).not.toBeVisible();
  await ownerPage.getByRole('button',{name:'Review returned changes',exact:true}).click();await expect(od).toContainText('Observation from the field observer');await od.getByRole('button',{name:'Compare versions',exact:true}).click();await expect(od.locator('[data-sharing-comparison]')).toBeVisible();await expect(od.getByRole('heading',{name:'Observation from the field observer',exact:true})).toBeVisible();
  await ownerPage.screenshot({path:test.info().outputPath('shared-review-desktop.png')});await ownerPage.setViewportSize({width:390,height:844});expect(await ownerPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await ownerPage.screenshot({path:test.info().outputPath('shared-review-phone.png')});
  await od.getByRole('button',{name:'Back to review',exact:true}).click();await od.getByLabel('Change',{exact:true}).selectOption('incoming');await od.getByRole('button',{name:'Apply reviewed choices',exact:true}).click();await expect(od).not.toBeVisible();
  expect((await fixtures[0].workspace.read()).book.entries.find(r=>r.id===book.entries[0].id).title).toBe('Observation from the field observer');expect((await fixtures[0].workspace.read()).book.entries.find(r=>r.id===book.entries[2].id)).toEqual(book.entries[2]);
  await expect(ownerPage.getByRole('button',{name:'Review returned changes',exact:true})).toHaveCount(0);await expect(ownerPage.getByText(/1 accepted, 0 kept locally/)).toBeVisible();
  await ownerPage.setViewportSize({width:1280,height:900});await ownerPage.getByRole('button',{name:'Prepare encrypted copy',exact:true}).click();await upload(od.getByLabel("Recipient's sharing contact",{exact:true}),'contact.observanda-sharing-contact',contact);await od.getByRole('button',{name:'Prepare encrypted copy',exact:true}).click();await expect(od).not.toBeVisible();
  const updated=await download(ownerPage,()=>ownerPage.getByRole('link',{name:'Download encrypted file',exact:true}).first().click());
  await memberPage.getByRole('button',{name:'Open exchange file',exact:true}).click();await upload(md.getByLabel('Encrypted research file',{exact:true}),'updated.observanda-share',updated);await md.getByRole('button',{name:'Inspect file',exact:true}).click();await expect(md).not.toBeVisible();
  await memberPage.getByRole('button',{name:'Review owner update',exact:true}).click();await expect(md).toContainText('Observation from the field observer');await md.getByLabel('Change',{exact:true}).selectOption('incoming');await md.getByRole('button',{name:'Apply reviewed choices',exact:true}).click();await expect(md).not.toBeVisible();await expect(memberPage.getByText(/1 accepted, 0 kept locally/)).toBeVisible();await expect(memberPage.getByRole('button',{name:'Review owner update',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close().catch(()=>{});for(const app of apps)await app.close();for(const f of fixtures)clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
