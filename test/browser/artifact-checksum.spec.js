import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {openEvidence} from './record-editor-helper.js';

test('a retained original is verified against a published SHA-512 and a mismatch is reported',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-artifact-checksum-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,book),app=await startServer({root:workspace.root,port:0,deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog');
 const bytes=Buffer.concat([Buffer.from('release image\n'),Buffer.alloc(3*1024*1024,7)]),sha512=createHash('sha512').update(bytes).digest('hex');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await openEvidence(page);await dialog.getByRole('button',{name:'Import original file',exact:true}).click();
  await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'release.img',mimeType:'application/octet-stream',buffer:bytes});
  await dialog.getByRole('button',{name:'Import original',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:30000});
  await dialog.locator('.material-list li').filter({hasText:'release.img'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const checksum=dialog.locator('[data-artifact-digest]');
  await checksum.getByText('Verify a checksum',{exact:true}).click();
  await expect(checksum.getByRole('combobox',{name:'Algorithm',exact:true})).toHaveValue('sha512');
  // A published checksum-file line, in upper case, is accepted as published.
  await checksum.getByLabel('Published checksum (optional)',{exact:true}).fill(sha512.toUpperCase()+'  release.img');
  await checksum.getByRole('button',{name:'Compute and compare',exact:true}).click();
  await expect(checksum.getByText('The original matches the published checksum.',{exact:true})).toBeVisible({timeout:30000});
  await expect(checksum.locator('code').first()).toHaveText(sha512);
  await expect(checksum).toContainText(bytes.length.toLocaleString('en')+' bytes, unchanged since intake');
  // One changed character is a mismatch, reported as an alert.
  await checksum.getByLabel('Published checksum (optional)',{exact:true}).fill((sha512[0]==='0'?'1':'0')+sha512.slice(1));
  await checksum.getByRole('button',{name:'Compute and compare',exact:true}).click();
  await expect(checksum.getByRole('alert')).toHaveText('The original does not match the published checksum.',{timeout:30000});
  // A value of the wrong length is refused before reading the file.
  await checksum.getByRole('combobox',{name:'Algorithm',exact:true}).selectOption('sha256');
  await checksum.getByRole('button',{name:'Compute and compare',exact:true}).click();
  await expect(checksum.getByRole('alert')).toHaveText('A SHA-256 checksum has 64 hexadecimal characters.');
  // Legacy algorithms compute, with a note about their limits.
  await checksum.getByRole('combobox',{name:'Algorithm',exact:true}).selectOption('md5');
  await checksum.getByLabel('Published checksum (optional)',{exact:true}).fill('');
  await checksum.getByRole('button',{name:'Compute and compare',exact:true}).click();
  await expect(checksum.locator('code').first()).toHaveText(createHash('md5').update(bytes).digest('hex'),{timeout:30000});
  await expect(checksum).toContainText('no longer prove that it was not deliberately altered');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
