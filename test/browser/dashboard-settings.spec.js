import {test,expect} from '@playwright/test';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {saveDashboard,dashboardSnapshot} from '../../src/preferences.js';

const settled=page=>page.evaluate(async()=>{
 await document.fonts.ready;
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
});
const geometry=page=>page.evaluate(()=>{
 const rect=node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
 const cards=[...document.querySelectorAll('.desk-card')];
 return {
  cards:cards.map(rect),desktop:rect(document.querySelector('.desk-desktop')),
  text:cards.map(card=>[...card.querySelectorAll('.desk-item>.desk-link')].map(node=>{
   const range=document.createRange();range.selectNodeContents(node);
   return [...range.getClientRects()].map(r=>[r.x,r.y,r.width,r.height]);
  })),
  page:[scrollX,scrollY,document.documentElement.scrollWidth,document.documentElement.scrollHeight],
  navigation:document.querySelector('#main-navigation').scrollTop
 };
});
async function openFixture(page,layout,many=false){
 const directory=await mkdtemp(path.resolve('.local/ux-review/card-settings-'));
 const book=sampleNotebook();book.title='Example workspace';book.projects[0].title='Example project';book.notebooks[0].title='Research records';
 book.entries=book.entries.slice(0,1);
 book.entries[0].title='Comparing observations across different light conditions, materials and repeated measurements over time';
 if(many)for(let i=0;i<8;i++)book.entries.push({...structuredClone(book.entries[0]),id:crypto.randomUUID()});
 const root=path.join(directory,'notebook'),preferences=path.join(directory,'preferences.json');
 await new Workspace(root).create(book);
 const settings=defaultDashboard(),projects=createPanel('projects','projects',4),records=createPanel('records','records',8);
 projects.column=0;records.column=layout==='stacked'?0:4;
 settings.views[0].panels=[projects,records];
 await saveDashboard(preferences,settings,dashboardSnapshot(defaultDashboard()).etag);
 const app=await startServer({root,port:0,preferencesFile:preferences});
 await page.goto(app.url);await page.locator('.desk-desktop[data-placed]').waitFor();await settled(page);
 return {app,directory};
}
async function rememberNodes(page){
 await page.evaluate(()=>{
  window.retained=[document.querySelector('.desk-desktop'),...document.querySelectorAll('.desk-card,.desk-item,#main-navigation,.tree-project')];
 });
}
async function unchanged(page,before){
 await settled(page);
 expect(await geometry(page)).toEqual(before);
 expect(await page.evaluate(()=>retained.every(node=>node.isConnected))).toBe(true);
}
async function bounded(page,uncovered=false){
 const result=await page.evaluate(()=>{
  const r=document.querySelector('.desk-inspector').getBoundingClientRect();
  const cards=[...document.querySelectorAll('.desk-card')].map(node=>node.getBoundingClientRect());
  return {bounded:r.x>=0&&r.y>=0&&r.right<=document.documentElement.clientWidth&&r.bottom<=innerHeight,
   overlaps:cards.some(c=>r.x<c.right&&r.right>c.x&&r.y<c.bottom&&r.bottom>c.y)};
 });
 expect(result.bounded).toBe(true);
 if(uncovered)expect(result.overlaps).toBe(false);
}
for(const layout of ['stacked','side-by-side']){
 test('card settings preserve '+layout+' card geometry, live nodes and scroll context',async({page})=>{
  await page.setViewportSize({width:1834,height:900});
  const {app,directory}=await openFixture(page,layout);
  const writes=[],errors=[];
  page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith('/api/dashboard'))writes.push(req);});
  page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.evaluate(()=>{document.querySelector('.tree-project').open=true;document.querySelector('#main-navigation').scrollTop=75;});
   await rememberNodes(page);const before=await geometry(page);
   await page.screenshot({path:path.join(directory,'before.png')});
   await page.getByRole('button',{name:'Settings for Projects',exact:true}).click();
   await unchanged(page,before);await bounded(page,true);
   await page.screenshot({path:path.join(directory,'settings-open.png')});
   const origin=await page.locator('.desk-inspector').evaluate(node=>{const r=node.getBoundingClientRect();return [r.x,r.y];});
   for(const tab of ['Display','Layout','Content']){
    await page.locator('.desk-inspector').getByRole('button',{name:tab,exact:true}).click();
    await unchanged(page,before);await bounded(page);
    expect(await page.locator('.desk-inspector').evaluate(node=>{const r=node.getBoundingClientRect();return [r.x,r.y];})).toEqual(origin);
   }
   // Moving the settings surface is not a card resize or rearrangement.
   const handle=page.getByRole('button',{name:'Move card settings',exact:true});
   const previous=await page.locator('.desk-inspector').boundingBox(),point=await handle.boundingBox();
   await page.mouse.move(point.x+10,point.y+10);await page.mouse.down();
   await page.mouse.move(point.x+45,point.y+30,{steps:5});await page.mouse.up();
   expect((await page.locator('.desk-inspector').boundingBox()).x).not.toBe(previous.x);
   await unchanged(page,before);
   await handle.focus();await page.keyboard.press('ArrowLeft');await unchanged(page,before);
   await page.keyboard.press('Escape');await unchanged(page,before);
   await expect(page.getByRole('button',{name:'Settings for Projects',exact:true})).toBeFocused();
   await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();
   await unchanged(page,before);
   await page.getByRole('button',{name:'Close card settings',exact:true}).click();
   await unchanged(page,before);
   await page.getByRole('button',{name:'Settings for Projects',exact:true}).click();
   await page.getByRole('button',{name:'Settings for Projects',exact:true}).click();
   await expect(page.locator('.desk-inspector')).toHaveCount(0);await unchanged(page,before);
   expect(writes).toHaveLength(0);expect(errors).toEqual([]);
   console.log('Visual review:',directory);
  }finally{await app.close();}
 });
}
test('settings retain a scrolled desktop on narrow screens; deliberate edits still persist',async({page})=>{
 const {app,directory}=await openFixture(page,'stacked',true);
 try{
  await page.setViewportSize({width:600,height:800});await settled(page);
  await page.evaluate(()=>scrollTo(0,100));await settled(page);
  await rememberNodes(page);const before=await geometry(page);
  await page.getByRole('button',{name:'Settings for Projects',exact:true}).click();
  await unchanged(page,before);await bounded(page);
  await page.screenshot({path:path.join(directory,'narrow-settings.png')});
  await page.getByRole('button',{name:'Display',exact:true}).click();await unchanged(page,before);
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await expect(page.locator('.desk-inspector')).toBeHidden();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await expect(page.locator('.desk-inspector')).toBeVisible();await unchanged(page,before);
  await page.setViewportSize({width:390,height:640});await settled(page);await bounded(page);
  expect(await page.locator('.desk-inspector-body').evaluate(node=>node.clientHeight)).toBeGreaterThan(250);
  await page.screenshot({path:path.join(directory,'phone-settings.png')});
  await page.getByLabel('Card title',{exact:true}).fill('Research projects');
  await expect(page.locator('[data-desk-card="projects"] h2')).toHaveText('Research projects');
  await expect.poll(()=>page.evaluate(async()=>(await (await fetch('/api/dashboard')).json()).settings.views[0].panels[0].config.title)).toBe('Research projects');
  await page.getByRole('button',{name:'Close card settings',exact:true}).click();
  await page.reload();await page.locator('.desk-desktop[data-placed]').waitFor();
  await expect(page.locator('[data-desk-card="projects"] h2')).toHaveText('Research projects');
  await page.setViewportSize({width:1834,height:900});await settled(page);
  await page.getByRole('button',{name:'Settings for Research projects',exact:true}).click();
  await page.getByRole('button',{name:'Layout',exact:true}).click();
  const width=await page.locator('[data-desk-card="projects"]').evaluate(node=>node.getBoundingClientRect().width);
  await page.getByRole('slider',{name:'Card width',exact:true}).fill('6');await settled(page);
  expect(await page.locator('[data-desk-card="projects"]').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(width);
 }finally{await app.close();}
});
