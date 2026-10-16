import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PUBLIC_BOOK_SCRIPT} from '../src/publication-browse.js';
import {assertPublicFiles,admitRetainedPublicFile} from '../src/privacy.js';
import {FileContent,writeContent,contentBuffer} from '../src/file-content.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';

test('reviewed earlier public scripts remain readable with exact retained bytes; modified code is rejected',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-script-')),f=await encryptedFixture(root,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(root,{recursive:true,force:true});});
 const previous=await readFile(new URL('./fixtures/public-book-v1.txt',import.meta.url),'utf8');
 for(const source of [previous,previous.replaceAll('\n','\r\n'),PUBLIC_BOOK_SCRIPT]){
  assert.doesNotThrow(()=>assertPublicFiles(new Map([['public-book.js',source]])));
  const file=path.join(f.workspace.root,'retained-script.blob'),saved=await writeContent(f.workspace,file,[source]),content=new FileContent(f.workspace,file,saved.size,saved.sha256);
  const admitted=await admitRetainedPublicFile('public-book.js',content,{type:'text'});assert.doesNotThrow(()=>assertPublicFiles(new Map([['public-book.js',admitted]])));assert.equal((await contentBuffer(admitted)).toString(),source);
 }
 for(const source of [previous+'\nalert(1)',previous.replace('form.hidden=false','form.hidden=true'),PUBLIC_BOOK_SCRIPT+'\nalert(1)'])assert.throws(()=>assertPublicFiles(new Map([['public-book.js',source]])),{code:'UNSAFE'});
});
