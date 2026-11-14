import {test,expect} from '@playwright/test';
import {mountFilesEditor} from './mount-files-editor.js';

// Exercise the real browser document editor. No research service is provided;
// the unrelated installed acceptance test must also qualify packaging/storage.
const id='10000000-0000-4000-8000-000000000001';
const savedSite={id,name:'Recovered site',revision:'c'.repeat(64),cssPath:'style.css',pages:[{path:'index.html',title:'Home'}]};
const savedPage={site:savedSite,path:'index.html',css:'',html:'<!doctype html><html><body><main><h1>Original saved home</h1></main></body></html>'};
const sessionWith=(sites,preparation)=>({workspaceId:id,title:'Lab',sites,preparation});

test('undo checks current access before replaying a saved page transaction',async({page})=>{
 let site={...savedSite},granted=true,checks=0;
 const source='4'.repeat(64),grantedPart='<section data-observanda-source="'+source+'" data-observanda-source-revision="'+source+'"><p data-observanda-part="text">Selected field text</p></section>';
 let html=savedPage.html.replace('</main>',grantedPart+'</main>');
 const open=()=>({...savedPage,site,html,sourceStamp:granted?source:'5'.repeat(64)});
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([site],{state:'ready'});
  if(route.endsWith('/open'))return open();
  if(route.endsWith('/version')){checks++;return {revision:site.revision};}
  if(route.endsWith('/save')){html=data.html;site={...site,revision:'d'.repeat(64)};return open();}
  throw Error('Unexpected route '+route);
 });
 await page.clock.install();await mountFilesEditor(page);
 const canvas=page.frameLocator('#website-files-canvas'),heading=canvas.getByRole('heading');
 await heading.click();await page.keyboard.press('End');await page.keyboard.type(' amended');
 await page.getByRole('button',{name:'Save website',exact:true}).click();
 const undo=page.getByRole('button',{name:'Undo',exact:true});
 await expect(undo).toBeEnabled();
 granted=false;html=html.replace(/<section data-observanda-source=[\s\S]+?<\/section>/,'');site={...site,revision:'e'.repeat(64)};
 const before=checks;await undo.click();await expect.poll(()=>checks).toBeGreaterThan(before);
 await expect(page.locator('#website-files-canvas')).toHaveCount(0);
 await page.clock.fastForward(5100);
 await expect(heading).toHaveText('Original saved home amended');
 await expect(canvas.getByText('Selected field text')).toHaveCount(0);
 await expect(undo).toBeDisabled();
});

test('a rejected undo identifies unavailable media and keeps unsaved writing and history intact',async({page})=>{
 const picture='pictures/677a25bc-7713-49a6-8521-a4ff11e918bf.png';
 const nested='pictures/377a25bc-7713-49a6-8521-a4ff11e918bc.png';let available=false,checked=[];
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([savedSite],{state:'ready'});
  if(route.endsWith('/open'))return {...savedPage,css:'.cover{background-image:URL('+picture+')}',html:savedPage.html.replace('</main>','<template><template><img alt="Local sample" src="'+nested+'"></template></template></main>')};
  if(route.endsWith('/version')){if(data.media)checked=data.media;return {revision:savedSite.revision,...(data.media?.length?{mediaAvailable:available}:{})};}
  throw Error('Unexpected route '+route);
 });
 await mountFilesEditor(page);
 const heading=page.frameLocator('#website-files-canvas').getByRole('heading'),undo=page.getByRole('button',{name:'Undo',exact:true});
 await heading.click();await page.keyboard.press('End');await page.keyboard.insertText(' changed');
 await undo.click();await expect(page.locator('[data-website-files-status]')).toContainText('Undo needs a media file');
 expect(checked.sort()).toEqual([picture,nested].sort());await expect(heading).toHaveText('Original saved home changed');await expect(undo).toBeEnabled();
 available=true;await undo.click();await expect(heading).toHaveText('Original saved home');
});

test('a late component listing cannot replace the library for the acknowledged edit',async({page})=>{
 let release,arrived,finished,created=false;const old=new Promise(r=>{release=r;}),pending=new Promise(r=>{arrived=r;}),delivered=new Promise(r=>{finished=r;});
 const component='c2d03233-dd69-4e31-8039-de949983f917',instance='b520d6ba-4d83-440a-a98d-736bc58bcf30';
 const site=()=>created?{...savedSite,revision:'b'.repeat(64)}:savedSite;
 const opened=()=>({...savedPage,site:site(),html:savedPage.html.replace('</main>','<section '+(created?'data-website-instance="'+instance+'"':'')+'><h2>Field card</h2></section></main>')});
 await page.exposeFunction('filesAPI',async(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([site()],{state:'ready'});
  if(route.endsWith('/open'))return opened();
  if(route.endsWith('/version'))return {revision:site().revision};
  if(route.endsWith('/components/create')){created=true;return opened();}
  if(route.endsWith('/components/list')){
   if(data.expectedRevision===savedSite.revision){arrived();await old;finished();return {errorCode:'CONFLICT',message:'Obsolete component response'};}
   return {revision:site().revision,items:[{id:component,name:'Field card',instances:1,pages:1}],total:1,next:null};
  }
  throw Error('Unexpected route '+route);
 });
 try{
  await mountFilesEditor(page);const canvas=page.frameLocator('#website-files-canvas'),library=page.locator('[data-website-components]');
  await page.getByRole('button',{name:'Reusable library',exact:true}).click();await pending;
  await canvas.locator('section').click({position:{x:2,y:2}});await library.getByLabel('Component name',{exact:true}).fill('Field card');
  await library.getByRole('button',{name:'Create from selected block'}).click();
  await expect(library.getByText('Placements 1 · Pages 1')).toBeVisible();release();await delivered;
  await expect(library).not.toContainText('Obsolete component response');await expect(library.getByText('Placements 1 · Pages 1')).toBeVisible();
 }finally{release();}
});

test('undo never changes the other identical paragraph when the edited occurrence becomes a shared component',async({page})=>{
 const label='Repeated measurement interval',amended=label+' amended';
 let site=savedSite,html=savedPage.html.replace('</main>','<section><p>'+label+'</p></section><section><p>'+amended+'</p></section></main>'),component=false;
 const open=()=>({...savedPage,site,html});
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([site],{state:'ready'});
  if(route.endsWith('/open'))return open();
  if(route.endsWith('/version'))return {revision:site.revision};
  if(route.endsWith('/save')){html=data.html;site={...site,revision:'a'.repeat(64)};return open();}
  if(route.endsWith('/components/list'))return {items:[],next:null,total:0,revision:site.revision};
  if(route.endsWith('/components/create')){
   component=true;html=html.replace('<section><p>'+amended,'<section data-website-instance="88b0ae3e-c165-4cb2-8e15-c53ab07522fb"><p>'+amended);
   site={...site,revision:'b'.repeat(64)};return open();
  }
  throw Error('Unexpected route '+route);
 });
 await mountFilesEditor(page);const canvas=page.frameLocator('#website-files-canvas'),sections=canvas.locator('main section'),first=sections.first().locator('p');
 await first.click();await page.keyboard.press('End');await page.keyboard.insertText(' amended');
 await page.getByRole('button',{name:'Save website',exact:true}).click();const undo=page.getByRole('button',{name:'Undo',exact:true});await expect(undo).toBeEnabled();
 await page.getByRole('button',{name:'Reusable library',exact:true}).click();await sections.first().click({position:{x:2,y:2}});
 const library=page.locator('[data-website-components]');await library.getByLabel('Component name',{exact:true}).fill('Shared observation');
 await library.getByRole('button',{name:'Create from selected block'}).click();await expect.poll(()=>component).toBe(true);
 await expect(undo).toBeDisabled();await expect(first).toHaveText(amended);await expect(sections.last()).toHaveText(amended);
});

test('publish update shows the configured SSH site and its reviewed files before enabling transfer',async({page})=>{
 const transfers=[],config={kind:'ssh',ssh:{login:'5f0c3f9e-2b6a-4c1d-9e8f-0a1b2c3d4e5f',directory:'/srv/atlas'}},server={id:'5f0c3f9e-2b6a-4c1d-9e8f-0a1b2c3d4e5f',name:'Lab server',protocol:'ssh',host:'lab.example',port:22,user:'research'};
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([savedSite],{state:'ready'});
  if(route.endsWith('/open'))return savedPage;
  if(route.endsWith('/version'))return {revision:savedSite.revision};
  if(route.endsWith('/publish-target'))return {kind:'remote',destination:{config,etag:'selected',server}};
  if(route.endsWith('/plan'))return {id:'review-id',included:['index.html'],counts:{included:1},windows:{included:{offset:0,next:null}}};
  if(route.endsWith('/publish')){transfers.push(data);return {receipt:{status:'published'}};}
  throw Error('Unexpected route '+route);
 });
 await mountFilesEditor(page);await page.getByRole('button',{name:'Publish update',exact:true}).click();
 const review=page.locator('[data-website-files-review]'),send=review.getByRole('button',{name:'Publish website'});
 await expect(review).toContainText('Lab server · research@lab.example:/srv/atlas/current');await review.locator('summary').click();
 await expect(review.getByText('index.html',{exact:true})).toBeVisible();await expect(send).toBeDisabled();
 expect(transfers).toHaveLength(0);await review.getByRole('checkbox').check();await expect(send).toBeEnabled();
 await send.click();await expect.poll(()=>transfers.length).toBe(1);expect(transfers[0]).toMatchObject({siteId:savedSite.id,expectedRevision:savedSite.revision,configEtag:'selected',destinationReview:'review-id',destinationReviewed:true});
});

test('a pending grant hides the page and open review, then restores the current draft after cancellation',async({page})=>{
 let pending=false;
 await page.exposeFunction('filesAPI',route=>{
  if(route.endsWith('/session'))return sessionWith([savedSite],{state:'ready'});
  if(route.endsWith('/open'))return savedPage;
  if(route.endsWith('/version'))return pending?{errorCode:'CONFLICT',message:'Workspace changed'}:{revision:savedSite.revision};
  throw Error('Unexpected route '+route);
 });
 await page.clock.install();
 await mountFilesEditor(page);
 const canvas=page.frameLocator('#website-files-canvas'),heading=canvas.getByRole('heading');
 await expect(heading).toHaveText('Original saved home');
 await heading.click();await page.keyboard.press('End');await page.keyboard.type(' with new writing');
 await page.getByRole('button',{name:'Check page',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
 pending=true;await page.clock.fastForward(5100);
 await expect(page.getByRole('alert')).toContainText('Checking whether this page can be shown');
 await expect(page.locator('#website-files-canvas')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
 pending=false;await page.clock.fastForward(5100);
 await expect(heading).toHaveText('Original saved home with new writing');await expect(page.getByRole('button',{name:'Save website',exact:true})).toBeEnabled();
});

test('a revision confined to another page keeps the mounted canvas, pending writing, selection and undo history',async({page})=>{
 let current=savedSite,opens=0,checks=0,lastWrite;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const surfaceStamp='1'.repeat(64);
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route.endsWith('/session'))return sessionWith([savedSite],{state:'ready'});
  if(route.endsWith('/open')){opens++;return {...savedPage,surfaceStamp,site:current};}
  if(route.endsWith('/version')){checks++;return {revision:current.revision,site:current,surfaceStamp};}
  if(route.endsWith('/save')){lastWrite=data;return {...savedPage,site:current,surfaceStamp,html:data.html};}
  throw Error('Unexpected route '+route);
 });
 await mountFilesEditor(page);
 const canvas=page.frameLocator('#website-files-canvas'),heading=canvas.getByRole('heading');
 await expect(heading).toHaveText('Original saved home');await heading.click();await page.keyboard.press('End');await page.keyboard.type(' edited');
 await expect(heading).toHaveText('Original saved home edited');expect(errors).toEqual([]);
 await heading.evaluate(node=>{window.editorWitness=node;});await page.keyboard.press('Shift+ArrowLeft');
 current={...savedSite,revision:'d'.repeat(64),pages:[...savedSite.pages,{path:'plates.html',title:'New plates'}]};
 await expect(page.locator('[data-website-file-page] option[value="plates.html"]')).toHaveCount(1,{timeout:12000});
 expect(await heading.evaluate(n=>n===window.editorWitness&&n.ownerDocument.getSelection().toString()==='d')).toBe(true);
 expect(opens).toBe(1);expect(checks).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect.poll(()=>lastWrite?.expectedRevision).toBe(current.revision);
 expect(lastWrite.html).toContain('Original saved home edited');
});

test('a prepared website opens from saved files without another user action',async({page})=>{
 const calls=[];let checks=0;
 await page.exposeFunction('filesAPI',route=>{
  calls.push(route);
  switch(route){
   case '/api/website-files/session':return sessionWith([],{state:'preparing'});
   case '/api/website-files/preparation':return {preparation:++checks===1?{state:'preparing',stage:'copying-files',completed:8,stageTotal:15}:{state:'ready'}};
   case '/api/website-files/list':return {items:[savedSite],next:null};
   case '/api/website-files/open':return savedPage;
   default:throw Error('Unexpected request '+route);
  }
 });
 await mountFilesEditor(page);await expect(page.getByRole('status')).toHaveText('Preparing saved websites…');
 await expect(page.getByRole('button',{name:'New website'})).toHaveCount(0);
 await expect(page.getByRole('status')).toHaveText('Copying website files (8 of 15)');
 await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 // Opening also checks for a recoverable draft of the opened page.
 expect(calls).toEqual(['session','preparation','preparation','list','open','recovery/page'].map(op=>'/api/website-files/'+op));
});

test('private draft remains identifiable and an added page is created by the site with its publication choice',async({page})=>{
 const draft={path:'drafts/notes.html',title:'Notes',draft:true},pages=[...savedSite.pages,draft];
 const site={...savedSite,pages},home={...savedPage,site,css:'main{color:blue}'};
 const privatePage={...savedPage,site:{...site,cssPath:'drafts/draft.css'},path:draft.path,css:'.private-note{color:red}'};
 const creates=[];
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route==='/api/website-files/session')return sessionWith([site],{state:'ready'});
  if(route==='/api/website-files/open')return data.path===draft.path?privatePage:home;
  if(route==='/api/website-files/version')return {revision:site.revision};
  if(route==='/api/website-files/recovery/page')return {items:[],next:null};
  if(route==='/api/website-files/page/create'){
   // The service writes the starter page and links the site stylesheet; the editor only names the page.
   creates.push(data);return {...home,path:data.path,html:'<!doctype html><html><head><link rel="stylesheet" href="../style.css"></head><body><main><h1>'+data.title+'</h1></main></body></html>',site:{...site,pages:[...pages,{path:data.path,title:data.title}]}};
  }
  throw Error('Unexpected request '+route);
 });
 await mountFilesEditor(page);
 const select=page.locator('[data-website-file-page]'),notice=page.getByText('Saving keeps this page as a private draft. Exports and publications exclude it.');
 await expect(select.locator('option').last()).toHaveText('Notes (private draft)');
 await select.selectOption(draft.path);await expect(notice).toBeVisible();
 await page.getByRole('button',{name:'Add page'}).click();
 const title=page.getByLabel('Page title'),file=page.getByLabel('Page file name');
 await title.fill('Index');await expect(file).toHaveValue('index-2.html');
 await title.fill('NUL');await expect(file).toHaveValue('nul-page.html');
 await title.fill('Øresund – Résultats');await expect(file).toHaveValue('oresund-resultats.html');
 await file.fill('pages/field.html');await title.fill('Field work');await expect(file).toHaveValue('pages/field.html');
 await expect(page.getByLabel('Publication')).toHaveValue('private');await page.getByLabel('Publication').selectOption('included');
 await page.getByRole('button',{name:'Add page'}).click();await expect(select).toHaveValue('pages/field.html');
 await expect(notice).toHaveCount(0);expect(creates).toHaveLength(1);
 expect(creates[0]).toMatchObject({siteId:id,expectedRevision:site.revision,path:'pages/field.html',title:'Field work',inclusion:'included'});
});

test('the empty workspace creates once, disables actions while writing, and retains a failed form',async({page})=>{
 let finish,creates=0;
 await page.exposeFunction('filesAPI',async route=>{
  if(route==='/api/website-files/session')return sessionWith([],{state:'ready'});
  if(route==='/api/website-files/create'){
   creates++;if(creates>1)return savedPage;
   await new Promise(resolve=>{finish=resolve;});return {errorCode:'UNAVAILABLE',message:'Storage is unavailable.'};
  }
  throw Error('Unexpected request '+route);
 });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mountFilesEditor(page);
 const create=page.getByRole('button',{name:'New website',exact:true});
 await expect(create).toHaveCount(1);await create.click();
 await page.getByLabel('Website name').fill('Recovered site');await expect(create).toHaveCount(1);await create.click();
 await expect(create).toBeDisabled();await expect(page.getByRole('button',{name:'Cancel'})).toBeDisabled();
 await expect(page.getByLabel('Website name')).toBeDisabled();expect(creates).toBe(1);
 finish();await expect(page.getByRole('alert')).toHaveText('Storage is unavailable.');
 await expect(page.getByLabel('Website name')).toHaveValue('Recovered site');expect(errors).toEqual([]);
 await create.click();await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 expect(creates).toBe(2);
});

test('a missing bookmarked site can be recovered without displaying another site under its name',async({page})=>{
 const requested='20000000-0000-4000-8000-000000000002',calls=[];
 await page.exposeFunction('filesAPI',(route,data)=>{
  calls.push([route,data?.siteId]);
  if(route==='/api/website-files/session')return sessionWith([savedSite],{state:'ready'});
  if(route==='/api/website-files/open')return data.siteId===requested?{errorCode:'NOT_FOUND',message:'Missing'}:savedPage;
  if(route==='/api/website-files/recovery/page')return {items:[],next:null};
  throw Error('Unexpected request '+route);
 });
 await mountFilesEditor(page,{hash:'#/websites/'+requested+'/editor'});
 await expect(page.getByText('This website could not be opened. Return to the workspace to check it.')).toBeVisible();
 await expect(page.locator('#website-files-canvas')).toHaveCount(0);
 await expect(page.getByText('There are no websites in this workspace.')).toHaveCount(0);
 await page.locator('[data-website-file-site]').selectOption(id);
 await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 // Opening the recovered site also checks it for a recoverable draft.
 await expect.poll(()=>calls).toEqual([['/api/website-files/session',undefined],['/api/website-files/open',requested],['/api/website-files/open',id],['/api/website-files/recovery/page',id]]);
});
for(const [state,message] of [
 ['unprepared','Open the workspace to check for saved websites.'],
 ['failed','The workspace could not prepare its saved websites. Return to the workspace to check storage and access.']
]){
 test('workspace preparation state '+state+' cannot be mistaken for an empty workspace',async({page})=>{
  const calls=[];
  await page.exposeFunction('filesAPI',route=>{calls.push(route);return sessionWith([],{state});});
  await mountFilesEditor(page);await expect(page.getByText(message,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry'})).toHaveCount(1);
  await expect(page.getByText('There are no websites in this workspace.')).toHaveCount(0);
  // Preparation runs only when the workspace opens with research access, so the website window can still start a new site.
  await expect(page.getByRole('button',{name:'New website'})).toHaveCount(1);
  await expect(page.locator('#website-files-canvas')).toHaveCount(0);
  expect(calls).toEqual(['/api/website-files/session']);
 });
}
test('visual edits preserve saved HTML, styles and placement and reject outdated drafts',async({page})=>{
 let version=1,html='<!doctype html><html lang="en"><head><title>Observation</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Observation</h1><p>Initial notes</p><section data-observanda-source="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" data-observanda-source-revision="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><p data-observanda-part="body">Copied text</p><p data-observanda-part="section-1">First release</p></section></main></body></html>',css='h1{color:rgb(12, 34, 56)}';
 const revision=()=>String(version).padStart(64,'a'),site=()=>({id,name:'Observation',revision:revision(),pages:[{path:'index.html',title:'Observation'}],cssPath:'style.css'}),open=()=>({site:site(),path:'index.html',sourceStamp:html.match(/data-observanda-source-revision="([a-f0-9]{64})"/)[1],html,css});
 const calls=[];await page.exposeFunction('filesAPI',async(route,data)=>{calls.push(route);switch(route){
  case '/api/website-files/session':return {workspaceId:id,title:'Lab',sites:[site()]};
  case '/api/website-files/open':return open();case '/api/website-files/version':return {revision:revision()};
  case '/api/website-files/source/check':return {revision:data.expectedRevision};
  case '/api/website-files/save':if(data.expectedRevision!==revision())throw Error('stale revision');html=data.html;css=data.css;version++;return open();
  default:throw Error('Unexpected request '+route);
 }});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mountFilesEditor(page,{resource:url=>url.pathname.endsWith('.css')?css:html});const canvas=page.frameLocator('#website-files-canvas');await expect(canvas.locator('h1')).toHaveCSS('color','rgb(12, 34, 56)');
 const paragraph=canvas.locator('main > p');await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type('Edited on canvas');await expect(paragraph).toHaveText('Edited on canvas');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');expect(html).toContain('<p>Edited on canvas</p>');expect(html).not.toMatch(/contenteditable|data-observanda-editor/);
 await page.getByRole('button',{name:'CSS',exact:true}).click();await page.getByLabel('CSS',{exact:true}).fill('p{font-weight:700}');await page.getByRole('button',{name:'Preview saved website'}).click();await expect(page.frameLocator('iframe').locator('main > p')).toHaveCSS('font-weight','700');
 await page.reload();await expect(canvas.locator('main > p')).toHaveText('Edited on canvas');
 const part=canvas.locator('[data-observanda-part="body"]');await part.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type('My webpage wording');await expect(part).toHaveText('My webpage wording');
 const release=canvas.locator('[data-observanda-part="section-2"]');
 version++;html=html.replace('b'.repeat(64),'c'.repeat(64)).replace('<p data-observanda-part="section-1">First release</p>','<p data-observanda-part="section-2">Second release</p>');
 await expect(release).toHaveText('Second release',{timeout:10000});await expect(canvas.getByText('First release',{exact:true})).toHaveCount(0);await expect(part).toHaveText('My webpage wording');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');expect(html).toContain('My webpage wording');
 version++;html=html.replace('c'.repeat(64),'d'.repeat(64)).replace('<p data-observanda-part="body">My webpage wording</p>','');
 await expect(part).toHaveCount(0,{timeout:10000});await expect(canvas.getByText('My webpage wording',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'HTML',exact:true}).click();const source=page.getByLabel('HTML',{exact:true});await source.fill(html.replace('Edited on canvas','Uncommitted change'));version++;html=html.replace('Edited on canvas','Updated visibility');await expect(page.locator('[data-website-files-status]')).toContainText('Website content changed',{timeout:10000});
 const review=page.locator('.website-merge-panel');
 await expect(review.getByRole('region',{name:'Your unsaved page'})).toContainText('Uncommitted change');
 await expect(page.getByRole('button',{name:'Preview saved website'})).toHaveCount(0);
 await expect(review.getByRole('region',{name:'Latest saved page'})).toContainText('Updated visibility');
 await page.getByRole('button',{name:'Use my change'}).click();expect(html).toContain('Updated visibility');
 await page.getByRole('button',{name:'Save resolved page'}).click();
 await expect(source).toBeEditable();await expect(source).toHaveValue(/Uncommitted change/);expect(html).toContain('Uncommitted change');
 version++;html=html.replace('d'.repeat(64),'e'.repeat(64)).replace('Uncommitted change','New field report').replace('<p data-observanda-part="section-2">Second release</p>','');
 await expect(source).toHaveValue(/New field report/,{timeout:10000});await expect(source).not.toHaveValue(/Second release/);
 expect(calls.every(call=>call.startsWith('/api/website-files/'))).toBe(true);expect(errors).toEqual([]);
});
