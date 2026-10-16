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

test('browser sign-in controls retain destination edits, select accounts, reconnect on restart and cancel on lock',async({page})=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-github-ui-')),f=await encryptedFixture(directory,sampleNotebook()),file=path.join(directory,'github.json'),store=new Map(),token='synthetic_browser_token_1234567890';let complete=null;
 const helper={available:async()=>true,accounts:async()=>[...store.keys()],store:async({login,token})=>store.set(login,token),forget:async login=>store.delete(login),credential:async(login,{interactive,signal}={})=>{
  if(!interactive)return {login,token:store.get(login)};
  return new Promise((resolve,reject)=>{complete=login=>resolve({login,token});signal.addEventListener('abort',()=>reject(new AppError('GITHUB_SIGNIN_CANCELLED')),{once:true});});
 }};
 let login='alice';const request=async()=>new Response(JSON.stringify({id:login==='alice'?1:2,login}));
 const make=()=>new GithubConnections({file,helper,request});let connections=make(),app;const start=()=>startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),githubConnections:connections,publishingOptions:{request}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  app=await start();await page.goto(app.url);await page.evaluate(()=>location.hash='#/preferences/integrations');const panel=page.locator('#github-connection');await expect(panel.getByRole('button',{name:'Sign in with GitHub',exact:true})).toBeEnabled();await expect(page.getByLabel('GitHub token',{exact:true})).not.toBeVisible();
  const owner=page.getByLabel('GitHub owner / organization',{exact:true});await owner.fill('My-unsaved-org');await page.getByLabel('Repository name',{exact:true}).fill('unsaved-site');await panel.getByRole('button',{name:'Sign in with GitHub',exact:true}).click();await expect(panel).toContainText('Finish signing in');complete('alice');await expect(panel).toContainText('Connected as alice');await expect(owner).toHaveValue('My-unsaved-org');await expect(page.locator('#destination-status')).toContainText('unsaved changes');
  expect(await page.content()).not.toContain(token);expect(await readFile(file,'utf8')).not.toContain(token);await page.screenshot({path:test.info().outputPath('github-connected.png'),fullPage:true});
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');login='bob';complete('bob');await expect(panel).toContainText('Connected as bob');
  await panel.getByLabel('Account saved on this computer').selectOption('alice');login='alice';await panel.getByRole('button',{name:'Use this account',exact:true}).click();await expect(panel).toContainText('Connected as alice');await expect(owner).toHaveValue('My-unsaved-org');
  // Restart the real server; only the protected helper storage survives.
  await app.close();connections=make();app=await start();await page.goto(app.url);await page.evaluate(()=>location.hash='#/preferences/integrations');await expect(panel).toContainText('Connected as alice');expect(await connections.token(f.workspace.root)).toBe(token);
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');await panel.getByRole('button',{name:'Cancel sign-in',exact:true}).click();await expect(panel).toContainText('Connected as alice');expect(connections.pending.state).toBe('cancelled');
  await panel.getByRole('button',{name:'Sign in with another account',exact:true}).click();await expect(panel).toContainText('Finish signing in');await page.locator('#main-navigation').getByRole('button',{name:'Lock workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();expect(connections.pending.state).toBe('cancelled');expect(connections.cache.size).toBe(0);
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await page.evaluate(()=>location.hash='#/preferences/integrations');await expect(panel).toContainText('Connected as alice');await panel.getByText('Forget account on this computer',{exact:true}).first().click();await panel.getByRole('button',{name:'Forget account on this computer',exact:true}).click();await expect(panel).toContainText('No GitHub account is connected');expect(store.has('alice')).toBe(false);expect(store.has('bob')).toBe(true);expect(errors).toEqual([]);
 }finally{await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
