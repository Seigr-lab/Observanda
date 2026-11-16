import {test,expect} from '@playwright/test';
import {defaultPublishing} from '../../src/publishing.js';
import {githubFixture} from '../github-fixture.js';
import {githubEditor} from './website-github-editor.js';
import {mountFilesEditor} from './mount-files-editor.js';

const tree=remote=>remote.trees.get(remote.commits.get(remote.head).tree);
async function destination(e,github){const config=defaultPublishing();Object.assign(config.github,{owner:'example',repository:'notebook',branch:'main',pages:false},github);return e.request('/api/website-files/destination/save',{siteId:e.site.id,config,etag:'new'});}
// The publish screen offers its destination directly.
async function openDestination(page){await page.getByRole('button',{name:'Publishing destination',exact:true}).click();}
// Waits for this transfer's own commit: an earlier result can still be on screen.
async function approve(page,remote){const before=remote.head,review=page.locator('[data-website-files-review]');await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Publish website'}).click();await expect.poll(()=>remote.head,{timeout:60000}).not.toBe(before);await expect(page.locator('[data-website-files-transfer]')).toContainText(remote.head,{timeout:60000});await expect(page.locator('[data-website-files-transfer]')).toContainText('uploaded and verified');}

test('an existing site blocks publishing until the website gets its own folder, which leaves the existing site untouched',async({page})=>{
 test.setTimeout(120000);const remote=githubFixture({branch:'main',initialFiles:{'index.html':'Existing home','news.html':'Existing news'}}),initial=remote.head,before=structuredClone(tree(remote)),e=await githubEditor(page,remote);
 try{
  await destination(e);await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const review=page.locator('[data-website-files-review]');
  await expect(review).toContainText('The destination has conflicting files.');await expect(review.getByRole('button',{name:'Publish website'})).toHaveCount(0);
  expect(remote.calls.some(call=>call.method!=='GET')).toBe(false);
  // A folder of its own: the website's files go beside the existing site.
  await openDestination(page);await page.getByLabel('Destination directory',{exact:true}).fill('lab/field-notes');await page.getByRole('button',{name:'Save destination',exact:true}).click();
  await page.getByRole('button',{name:'Review publication',exact:true}).click();
  await expect(review).toContainText('example/notebook / main / lab/field-notes');await expect(review).toContainText('Unrelated files preserved: 2');
  await approve(page,remote);
  expect(tree(remote).filter(entry=>!entry.path.startsWith('lab/field-notes/'))).toEqual(before);expect(tree(remote).some(entry=>entry.path==='lab/field-notes/index.html')).toBe(true);
  expect(remote.commits.get(remote.head).parents).toEqual([initial]);
  // Upload only: Pages settings are never read or changed.
  expect(remote.calls.some(call=>call.route.endsWith('/pages'))).toBe(false);
 }finally{await page.close();await e.close();}
});

test('the first upload to main keeps the repository’s other files and turns on GitHub Pages for the website',async({page})=>{
 test.setTimeout(120000);const remote=githubFixture({branch:'main',initialFiles:{'README.md':'Keep this reference'}}),initial=remote.head,e=await githubEditor(page,remote);
 try{
  await destination(e,{pages:true});await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const review=page.locator('[data-website-files-review]');await expect(review).toContainText('Unrelated files preserved: 1');
  expect(remote.head).toBe(initial);
  await approve(page,remote);
  expect(tree(remote).find(entry=>entry.path==='README.md')).toBeTruthy();expect(remote.commits.get(remote.head).parents).toEqual([initial]);
  expect(remote.calls.some(call=>call.route.endsWith('/pages')&&call.method==='POST'&&call.data?.source?.branch==='main')).toBe(true);
 }finally{await page.close();await e.close();}
});

test('replacing an old application archives its branch first and keeps the domain and license files',async({page})=>{
 test.setTimeout(150000);
 const remote=githubFixture({branch:'main',initialFiles:{'index.html':'Old application','CNAME':'field.example\n','LICENSE.md':'Keep these terms',...Object.fromEntries(Array.from({length:12},(_,i)=>['old-app/file-'+i+'.js','Old application source']))}}),initial=remote.head,e=await githubEditor(page,remote);
 try{
  await destination(e);await mountFilesEditor(page);
  await page.getByRole('button',{name:'Publish update',exact:true}).click();
  const review=page.locator('[data-website-files-review]');await expect(review).toContainText('Conflicting files: 1');
  await review.getByText('Replace an existing website or application',{exact:true}).click();await review.getByLabel('Archive branch (optional)',{exact:true}).fill('previous-application');
  await review.getByRole('button',{name:'Review replacing existing destination files',exact:true}).click();
  await expect(review).toContainText('Remove: 12 files');await expect(review).toContainText('create branch previous-application at the current commit');
  await approve(page,remote);
  const files=tree(remote).map(entry=>entry.path);
  expect(files).toContain('CNAME');expect(files).toContain('LICENSE.md');expect(files.some(file=>file.startsWith('old-app/'))).toBe(false);
  // The old application stays on its own branch at the commit it had.
  expect(remote.calls.some(call=>call.method==='POST'&&call.route.endsWith('/git/refs')&&call.data?.ref==='refs/heads/previous-application'&&call.data?.sha===initial)).toBe(true);
 }finally{await page.close();await e.close();}
});

test('an earlier release is reopened from Releases, restored and published again through a new review',async({page})=>{
 test.setTimeout(150000);const remote=githubFixture({branch:'main',initialFiles:{'README.md':'About this repository'}}),e=await githubEditor(page,remote);
 const button=name=>page.getByRole('button',{name,exact:true}),home=()=>{const entry=tree(remote).find(item=>item.path==='index.html');return entry?remote.blobs.get(entry.sha).toString():'';};
 try{
  await destination(e);await mountFilesEditor(page);
  const deliver=async()=>{await button('Publish update').click();await approve(page,remote);await button('Return to editing').click();};
  await deliver();expect(home()).not.toContain('Second edition');
  await button('Page code (HTML)').click();const html=page.getByRole('textbox',{name:'Page code (HTML)',exact:true});
  await html.fill((await html.inputValue()).replace('</main>','<p>Second edition</p></main>'));await button('Save website').click();
  await deliver();expect(home()).toContain('Second edition');
  // Releases lists both deliveries; the earlier one opens its version from history.
  const menu=page.locator('[data-website-site-menu]');if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();await menu.getByRole('button',{name:'Releases',exact:true}).click();
  const entries=page.locator('[data-release-entry]');await expect(entries).toHaveCount(2);
  await entries.last().getByRole('button',{name:'Open this version'}).click();await button('Compare changes').click();
  await expect(page.locator('.website-version-diff pre').last()).toContainText('Second edition');await button('Restore as new version').click();
  await expect(page.frameLocator('#website-files-canvas').getByText('Second edition',{exact:true})).toHaveCount(0);
  await button('Publish update').click();await approve(page,remote);
  expect(home()).not.toContain('Second edition');expect(home()).toContain('Field atlas');
 }finally{await page.close();await e.close();}
});
