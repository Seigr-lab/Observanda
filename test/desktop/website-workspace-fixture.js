import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {rename,stat,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';

export async function createWebsiteWorkspace(page,directory,name){
 await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
 await page.getByLabel('Workspace name',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Create in',{exact:true}).fill(directory);
 await page.getByLabel('Use this device',{exact:false}).check();
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await expect(page.locator('.topbar .workspace-name')).toHaveText(name,{timeout:60000});
}

// Only disposable fixture runtimes may be moved, after a confirmed shutdown.
export async function disableWebsiteResearch(directory,roots){
 const parent=await realpath(directory),databases=[];
 for(const root of roots){
  const database=await realpath(path.join(root,'.observanda','postgresql')),relative=path.relative(parent,database);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!(await stat(database)).isDirectory())throw Error('Unexpected disposable database layout');
  await rename(database,database+'-offline');
  await writeFile(database,'Research PostgreSQL is deliberately unavailable.\n',{flag:'wx'});
  databases.push(database);
 }
 return databases;
}

export async function selectEntry(page){
 const seed=sampleNotebook(),entry=seed.entries[2];seed.entries=[entry];entry.title='Retained observation';entry.body='Permitted record body';entry.share=false;
 entry.sections=[{id:randomUUID(),title:'First result',body:'withdraw-this-result',share:true},{id:randomUUID(),title:'Second result',body:'release-this-result',share:false},{id:randomUUID(),title:'Private appendix',body:'never-export-this-canary',share:false}];
 return page.evaluate(async seed=>{
  const context=(await(await fetch('/api/storage')).json()).contextId,headers={'Content-Type':'application/json','X-Observanda-Workspace':context};
  async function call(route,data){const response=await fetch(route,{headers,...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();if(!response.ok)throw Error(route+': '+result.code);return result;}
  const projectId=crypto.randomUUID(),project=(await call('/api/projects/create',{id:crypto.randomUUID(),username:'',password:'',project:{id:projectId,title:'Optics project',description:'',share:true,logoId:null}})).project;
  const books='/api/projects/'+projectId+'/lab-books',book=(await call(books+'/create',{id:crypto.randomUUID(),username:'',password:'',book:{id:crypto.randomUUID(),projectId,title:'Measurement book'}})).book,prefix=books+'/'+book.labBookId;
  const entry=seed.entries[0];entry.notebookId=book.labBookId;await call(prefix+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:entry.id,expectedRevision:null,record:entry}]});
  const target={workspaceId:book.namespaceId,recordId:entry.id,field:'share'},prior=await call(prefix+'/research/records/values/read',target);await call(prefix+'/research/records/values/save',{...target,expectedRevision:prior.revision,value:{value:true}});
  return {context,prefix,projectId,labBookId:book.labBookId,workspaceId:book.namespaceId,recordId:entry.id,sections:entry.sections.map(value=>value.id),roots:[project.root,book.root]};
 },seed);
}
