import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('shared configuration versions page independently without replacing review choices and ignore obsolete reads',async({page})=>{
 await page.route('https://sharing.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<dialog id="dialog"></dialog>'});
  return route.fulfill({contentType:path.endsWith('.json')?'application/json':'text/javascript',body:await readFile(new URL('../../src/web'+path,import.meta.url),'utf8')});
 });
 await page.goto('https://sharing.test/');
 await page.evaluate(async()=>{
  const {sharingUI}=await import('/sharing-ui.js'),dialog=document.querySelector('#dialog');
  const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const id=()=>crypto.randomUUID();window.bookId=id();window.recordId=id();window.calls=[];window.holds=[];window.holdAt=null;window.failAt=null;window.emptyHeader=false;window.errors=[];
  window.state={storage:{contextId:id()},book:{id:id()}};
  const rows=(version,collection)=>Array.from({length:25},(_,i)=>{
   const key=collection+'-'+i,label=version+' '+collection+' '+(i+1)+(i===20?' <img src=x onerror=alert(1)>':'');
   const value=collection==='profiles'?{id:'profile-'+i,version:1,enabled:i%2===0}:collection==='sections'?{id:key,label,enabled:true,description:'Exact '+label}:collection==='fields'?{key,label,type:'select',unit:'',required:true}:label;
   return {key:collection==='choices'?value:key,position:i,revision:'a'.repeat(64),value,...(collection==='sections'?{counts:{fields:25}}:collection==='fields'?{counts:{choices:25}}:{})};
  });
  const matches=(filter,body)=>filter&&Object.entries(filter).every(([key,value])=>body[key]===value);
  window.ui=await sharingUI({state,esc,field:(label,control)=>'<label>'+label+control+'</label>',showDialog:html=>{dialog.innerHTML=html;if(!dialog.open)dialog.showModal();},notify:message=>errors.push(message),render(){},api:async(path,body,options={})=>{
   if(path==='/api/sharing/state')return {packages:[],grants:[],notebooks:[],projects:[]};
   if(path==='/api/organizations/state')return {organizations:[]};
   if(path==='/api/sharing/review')return {id:body.id,kind:'offer',rows:[{id:recordId,title:'Retained experiment',kind:'changed',conflict:true,evidence:1}],structure:{title:null,books:[{before:{id:bookId,title:'Original book',configuration:{format:'observanda-configuration'}},after:{id:bookId,title:'Incoming book',configuration:{profiles:[],sections:[]}}},{before:null,after:{id:'unconfigured',title:'No configuration'}}]}};
   if(path!=='/api/sharing/configuration')throw Error('Unexpected '+path);
   calls.push(structuredClone(body));
   if(matches(holdAt,body)){holdAt=null;await new Promise((resolve,reject)=>holds.push({resolve,reject,signal:options.signal,body}));}
   if(matches(failAt,body)){failAt=null;throw Error('Synthetic read failure');}
   if(body.operation==='open')return {header:emptyHeader?null:{counts:{profiles:25,sections:25,fields:625,choices:15625}}};
   const all=rows(body.version,body.collection);
   if(body.operation==='item')return {item:all.find(row=>row.key===body.key)??null};
   if(body.operation==='window'){const offset=body.offset??0;return {rows:all.slice(offset,offset+body.limit),total:all.length,offset,next:offset+body.limit<all.length?offset+body.limit:null};}
   throw Error('Unexpected operation');
  }});
  document.addEventListener('click',event=>{const node=event.target.closest('[data-command]');if(node)void ui.action(node.dataset.command,node);});
  document.addEventListener('input',event=>ui.input(event.target));
  await ui.action('sharing-review',{dataset:{id:'review-one'}});
 });
 const versions=page.locator('[data-sharing-configuration]');
 await expect(versions).toHaveCount(2);expect(await page.evaluate(()=>calls)).toEqual([]);
 await page.locator('.sharing-structure details').first().locator('summary').click();
 const original=page.locator('[data-sharing-configuration][data-version="base"]'),incoming=page.locator('[data-sharing-configuration][data-version="incoming"]');
 await original.getByRole('button',{name:'Inspect record types'}).click();await incoming.getByRole('button',{name:'Inspect record types'}).click();
 const region=(side,name)=>side.locator('[data-sharing-config-region="'+name+'"]');
 await expect(region(original,'sections').getByRole('button',{name:'base sections 1',exact:true})).toBeVisible();
 await expect(region(incoming,'sections').getByRole('button',{name:'incoming sections 1',exact:true})).toBeVisible();
 const choice=page.locator('[name^="choice-"]');await choice.selectOption('current');await page.evaluate(()=>window.originalChoice=document.querySelector('[name^="choice-"]'));
 await page.evaluate(()=>holdAt={version:'base',collection:'sections',operation:'window',offset:20});
 await region(original,'sections').getByRole('button',{name:'Next',exact:true}).click();await expect.poll(()=>page.evaluate(()=>holds.length)).toBe(1);
 await region(incoming,'sections').getByRole('button',{name:'Next',exact:true}).click();
 await region(incoming,'sections').getByRole('button',{name:'incoming sections 21 <img src=x onerror=alert(1)>',exact:true}).click();
 await region(incoming,'fields').getByRole('button',{name:'Next',exact:true}).click();
 await region(incoming,'fields').getByRole('button',{name:'incoming fields 21 <img src=x onerror=alert(1)>',exact:true}).click();
 await region(incoming,'choices').getByRole('button',{name:'Next',exact:true}).click();
 await expect(region(incoming,'choices').locator('li')).toHaveCount(5);await expect(region(incoming,'choices').locator('li').first()).toHaveText('incoming choices 21 <img src=x onerror=alert(1)>');
 await region(incoming,'profiles').getByRole('button',{name:'Next',exact:true}).click();await expect(region(incoming,'profiles').locator('li')).toHaveCount(5);
 await expect(page.locator('.sharing-structure img')).toHaveCount(0);await expect(choice).toHaveValue('current');expect(await page.evaluate(()=>originalChoice===document.querySelector('[name^="choice-"]'))).toBe(true);
 await page.evaluate(()=>failAt={version:'incoming',collection:'choices',operation:'window',offset:0});
 await region(incoming,'choices').getByRole('button',{name:'Previous',exact:true}).click();await expect(region(incoming,'choices').getByRole('alert')).toHaveText('Could not load these record types. Retry to continue reviewing.');await expect(region(incoming,'choices').locator('li')).toHaveCount(5);
 await region(incoming,'choices').getByRole('button',{name:'Retry',exact:true}).click();await expect(region(incoming,'choices').locator('li')).toHaveCount(20);
 await page.evaluate(()=>holds[0].resolve());await expect(region(original,'sections').getByRole('button',{name:'base sections 25',exact:true})).toBeVisible();await expect(region(incoming,'fields').getByRole('button',{name:'incoming fields 25',exact:true})).toBeVisible();await expect(choice).toHaveValue('current');
 // A closed review's failed request must not replace the next review or show its error there.
 await page.evaluate(()=>holdAt={version:'base',collection:'sections',operation:'window',offset:0});
 await region(original,'sections').getByRole('button',{name:'Previous',exact:true}).click();await expect.poll(()=>page.evaluate(()=>holds.length)).toBe(2);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();expect(await page.evaluate(()=>holds[1].signal.aborted)).toBe(true);
 await page.evaluate(async()=>{await ui.action('sharing-review',{dataset:{id:'review-two'}});holds[1].reject(Error('Obsolete read failure'));});
 await expect(versions).toHaveCount(2);await expect(page.getByRole('alert')).toBeEmpty();await expect(choice).toHaveValue('');expect(await page.evaluate(()=>errors)).toEqual([]);
 await page.locator('.sharing-structure details').first().locator('summary').click();await page.evaluate(()=>emptyHeader=true);await incoming.getByRole('button',{name:'Inspect record types'}).click();await expect(incoming).toHaveText('No items.');
 const requests=await page.evaluate(()=>calls);expect(requests.some(row=>row.notebookId==='unconfigured')).toBe(false);expect(requests.filter(row=>row.reviewId==='review-two')).toHaveLength(1);
 for(const request of requests){expect(request.workspaceId).toBeTruthy();expect(request.reviewId).toBeTruthy();expect(['base','incoming']).toContain(request.version);expect(Object.keys(request).sort()).toEqual(expect.arrayContaining(['operation','workspaceId','reviewId','notebookId','version']));expect(request.configurationPin).toBeUndefined();expect(request.configuration).toBeUndefined();if(request.operation==='window')expect(request.limit).toBe(20);}
});
