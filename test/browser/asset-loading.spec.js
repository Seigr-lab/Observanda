import {test,expect} from '@playwright/test';
import fs,{mkdtemp,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createApplicationAssets} from '../../src/application-assets.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('source startup and Help survive a cold asset queue already occupied by language resources',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-asset-loading-')),f=await encryptedFixture(directory,sampleNotebook());
 const assets=await createApplicationAssets({builtDirectory:pathToFileURL(path.join(directory,'absent')+path.sep)}),gate=Promise.withResolvers(),originalStat=fs.lstat;
 let app,reads=[];const errors=[],responses=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)responses.push([new URL(response.url()).pathname,response.status()]);});
 try{
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:assets});
  // Styles must not occupy the browser's connections ahead of the gated entry.
  for(const name of assets.entries.keys())if(name.endsWith('.css'))await assets.read(name);
  const names=[...assets.entries.keys()].filter(name=>name.startsWith('locales/nb/')&&name.endsWith('.json')).slice(0,16),urls=new Set(names.map(name=>String(assets.entries.get(name).url)));
  expect(names).toHaveLength(16);
  fs.lstat=async(url,...args)=>{if(urls.has(String(url)))await gate.promise;return originalStat(url,...args);};syncBuiltinESMExports();
  reads=names.map(name=>assets.read(name));
  expect(assets.statistics().pending).toBe(16);
  const response=assets.response.bind(assets);
  assets.response=name=>{
   const result=response(name);
   // Release disk work only after the browser's entry has sought admission.
   if(name==='app.js')gate.resolve();
   return result;
  };
  await page.goto(app.url);await page.evaluate(()=>location.hash='#/preferences/help');
  await expect(page.getByRole('link',{name:'Records, methods and runs',exact:true})).toBeVisible();
  await page.locator('[data-language-choice]').selectOption('nb');
  await expect(page.locator('[data-language-choice]')).toHaveValue('nb');
  await expect(page.getByRole('heading',{name:'Innstillinger',exact:true})).toBeVisible();
  expect(errors).toEqual([]);expect(responses).toEqual([]);
 }finally{
  gate.resolve();fs.lstat=originalStat;syncBuiltinESMExports();await Promise.allSettled(reads);await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});
 }
});
