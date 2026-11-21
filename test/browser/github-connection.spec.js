import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {GithubConnections} from '../../src/github/connections.js';
import {clearVault} from '../../src/encryption.js';
import {AppError} from '../../src/errors.js';
import {randomUUID} from 'node:crypto';
import {ResearchRecords} from '../../src/research.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';

for(const named of [false])test((named?'named website':'workspace preferences')+' GitHub account controls stay independent of a workspace above the complete-read budget',async({page})=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-github-ui-')),book=sampleNotebook(),seed=book.entries[0];book.entries=[];
 const f=await encryptedFixture(directory,book),file=path.join(directory,'github.json'),store=new Map(),token='synthetic_browser_token_1234567890';let complete=null;
 const records=new ResearchRecords(f.workspace,{});
 for(let offset=0;offset<60;offset+=20){const changes=Array.from({length:20},(_,i)=>{const record={...structuredClone(seed),id:randomUUID(),title:'Private observation '+(offset+i),body:'PRIVATE_RESEARCH_'.repeat(2500),share:false,sections:[],attachments:[],figures:[],relations:[]};return {id:record.id,expectedRevision:null,record};});await records.save({workspaceId:book.id,changes},{receipt:true});}
 await expect(f.workspace.catalogue(store=>store.read())).rejects.toMatchObject({code:'WORKSPACE_READ_LIMIT'});
 let destination='#/preferences/integrations';
 let browserAssets;if(named){const built=process.env.OBSERVANDA_TEST_BROWSER_BUILD,out=built?path.resolve(built):path.join(directory,'frontend');if(built)await readFile(path.join(out,'manifest.json'));else await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
 // Startup/unlock integrity verification is separate from account actions.
 // Attribute original reads only while the connection panel is in use.
 let inspectingAccount=false;
 const original=ResearchCatalogue.prototype.record,loaded=[],requests=[];ResearchCatalogue.prototype.record=function(id,...args){if(inspectingAccount)loaded.push(id);return original.call(this,id,...args);};
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(new URL(request.url()).pathname);});
 const helper={available:async()=>true,accounts:async()=>[...store.keys()],store:async({login,token})=>store.set(login,token),forget:async login=>store.delete(login),credential:async(login,{interactive,signal,onVerification}={})=>{
  if(!interactive)return {login,token:store.get(login)};
  onVerification?.({url:'https://github.com/login/device',code:'ABCD-5678'});
  return new Promise((resolve,reject)=>{complete=login=>resolve({login,token});signal.addEventListener('abort',()=>reject(new AppError('GITHUB_SIGNIN_CANCELLED')),{once:true});});
 }};
 let login='alice';const request=async url=>{
  const route=new URL(url);let value;
  if(route.pathname==='/user')value={id:login==='alice'?1:2,login};
  else throw Error('Unexpected GitHub request '+route.pathname);
  return new Response(JSON.stringify(value));
 };
 const make=()=>new GithubConnections({file,helper,request});let connections=make(),app;const start=()=>startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),githubConnections:connections,publishingOptions:{request},browserAssets});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const openDestination=async()=>{await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible({timeout:30000});await page.evaluate(route=>location.hash=route,destination);};
 try{
  app=await start();await openDestination();if(named)await expect(page.locator('script[type="module"][src^="/assets/app-"]')).toHaveCount(1);const panel=page.locator('#github-connection');await expect(panel.getByRole('button',{name:'Sign in with GitHub',exact:true})).toBeEnabled();await expect(page.getByLabel('GitHub token',{exact:true})).not.toBeVisible();inspectingAccount=true;
  await panel.getByRole('button',{name:'Sign in with GitHub',exact:true}).click();await expect(panel).toContainText('Finish signing in');await expect(panel).toContainText('ABCD-5678');await expect(panel.getByRole('link',{name:'Open GitHub to sign in'})).toHaveAttribute('href','https://github.com/login/device');
  const cancel=await panel.getByRole('button',{name:'Cancel sign-in',exact:true}).elementHandle();await cancel.focus();
  for(let i=0;i<2;i++)await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/github-connection/status');
  expect(await cancel.evaluate(element=>element.isConnected&&document.activeElement===element)).toBe(true);await cancel.dispose();
  complete('alice');await expect(panel).toContainText('Connected as alice');await expect(panel).not.toContainText('ABCD-5678');
  expect(await page.content()).not.toContain(token);expect(await readFile(file,'utf8')).not.toContain(token);await page.screenshot({path:test.info().outputPath('github-connected.png'),fullPage:true});
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');login='bob';complete('bob');await expect(panel).toContainText('Connected as bob');
  await panel.getByLabel('Account saved on this computer').selectOption('alice');login='alice';await panel.getByRole('button',{name:'Use this account',exact:true}).click();await expect(panel).toContainText('Connected as alice');
  // Restart the real server; only the protected helper storage survives.
  inspectingAccount=false;await app.close();connections=make();app=await start();await openDestination();await expect(panel).toContainText('Connected as alice');expect(await connections.token(f.workspace.root)).toBe(token);inspectingAccount=true;
  await panel.getByRole('button',{name:'Check connection status',exact:true}).click();await expect(panel).toContainText('Connected as alice');
  await panel.getByRole('button',{name:'Disconnect workspace',exact:true}).click();await expect(panel).toContainText('No GitHub account is connected');expect(store.has('alice')).toBe(true);
  await panel.getByLabel('Account saved on this computer').selectOption('alice');await panel.getByRole('button',{name:'Use this account',exact:true}).click();await expect(panel).toContainText('Connected as alice');
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');await panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(panel).not.toContainText('Finish signing in');await expect(panel).toContainText('Connected as alice');await expect.poll(()=>connections.pending.state).toBe('cancelled');
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');await page.locator('#main-navigation').getByRole('button',{name:'Lock workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();await expect.poll(()=>connections.pending.state).toBe('cancelled');expect(connections.cache.size).toBe(0);
  inspectingAccount=false;await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await page.evaluate(route=>location.hash=route,destination);await expect(panel).toContainText('Connected as alice');inspectingAccount=true;await panel.getByText('Forget account on this computer',{exact:true}).first().click();await panel.getByRole('button',{name:'Forget account on this computer',exact:true}).click();await expect(panel).toContainText('No GitHub account is connected');expect(store.has('alice')).toBe(false);expect(store.has('bob')).toBe(true);expect(errors).toEqual([]);
  expect(loaded).toEqual([]);expect(requests.filter(route=>['/api/notebook','/api/workspace/read/page','/api/workspace/read/selection'].includes(route))).toEqual([]);expect(await page.content()).not.toContain('PRIVATE_RESEARCH_');
 }finally{ResearchCatalogue.prototype.record=original;await app?.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
