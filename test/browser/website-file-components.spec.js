import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const moduleURL=new URL('../../src/web/website-files-components.js',import.meta.url);
const messages=JSON.parse(await readFile(new URL('../../src/web/locales/en/websiteFiles.json',import.meta.url)));
test('component library supports keyboard placement, canvas drop, scoped visual main editing and detach',async({page})=>{
 await page.route('http://components.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/module.js')return route.fulfill({contentType:'text/javascript',body:await readFile(moduleURL,'utf8')});
  await route.fulfill({contentType:'text/html',body:url.pathname==='/'?'<section id="panel"></section><iframe id="page" title="Page"></iframe>':'<!doctype html><html><body></body></html>'});
 });
 await page.goto('http://components.test/');
 await page.evaluate(async messages=>{
  const {websiteFilesComponents}=await import('/module.js'),host=document.querySelector('#panel'),frame=document.querySelector('#page');
  let opened={site:{id:'site',revision:'rev0'},path:'index.html',html:'<main><section><p>Author</p></section></main>',css:''},main=null,seq=0;
  const doc=frame.contentDocument;doc.body.innerHTML=opened.html;window.calls=[];
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),tr=k=>messages[k]??k;
  const request=async(route,data)=>{
   window.calls.push([route,data]);if(data.expectedRevision!==opened.site.revision)throw Error('Wrong pin');
   if(route==='components/list')return {revision:opened.site.revision,items:main&&main.name.includes(data.query)?[{id:'main',name:main.name}]:[],next:null};
   if(route==='components/main')return {...main,revision:opened.site.revision,id:'main'};
   if(route==='components/create'){main={name:data.name,html:'<section><p>Author</p></section>'};doc.querySelector('section').dataset.websiteInstance='placed';}
   if(route==='components/update')main={name:data.name,html:data.html};
   return {...opened,site:{...opened.site,revision:'rev'+(++seq)}};
  };
  function render(){host.innerHTML=ui.view();ui.bind();}
  const ui=websiteFilesComponents({request,esc,tr,site:()=>opened,selected:()=>'0/0',save:async()=>{},adopt:r=>{opened=r;},render,run:fn=>fn()});
  host.addEventListener('click',e=>{if(e.target.dataset.action)void ui.action(e.target.dataset.action.slice(14),e.target);});
  host.addEventListener('input',e=>ui.input(e.target));render();ui.bindCanvas(doc);
 },messages);
 const click=name=>page.getByRole('button',{name,exact:true}).click();
 await click('Browse components');await page.getByLabel('Component name',{exact:true}).fill('Sidebar card');await click('Create from selected block');
 const card=page.getByText('Sidebar card',{exact:true});await expect(card).toBeVisible();
 await page.getByLabel('Search component names').fill('missing');await page.getByLabel('Search component names').press('Enter');await expect(page.getByText('No matching components.')).toBeVisible();
 await page.getByLabel('Search component names').fill('Sidebar');await click('Search');
 await page.getByLabel('Insert position').selectOption('before');await page.getByRole('button',{name:'Insert instance'}).focus();await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>window.calls.filter(([op])=>op==='components/insert').at(-1)?.[1].position)).toBe('before');
 await page.evaluate(()=>{
  const dt=new DataTransfer(),row=document.querySelector('[data-component-drag]'),target=document.querySelector('#page').contentDocument.querySelector('section');
  row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
  target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:target.getBoundingClientRect().bottom}));
 });
 await expect.poll(()=>page.evaluate(()=>window.calls.filter(([op])=>op==='components/insert').at(-1)?.[1].position)).toBe('after');
 await click('Edit main component');await expect(page.getByRole('dialog')).toBeVisible();
 const root=page.frameLocator('[data-main-canvas]').locator('p');await expect(root).toHaveText('Author');
 await root.click();await page.keyboard.press('End');await page.keyboard.type(' edited');await click('Update all instances');
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>window.calls.find(([op])=>op==='components/update')[1].html)).toContain('Author edited');
 await click('Detach selected instance');await expect.poll(()=>page.evaluate(()=>window.calls.filter(([op])=>op==='components/detach').at(-1)?.[1].instance)).toBe('placed');
});
