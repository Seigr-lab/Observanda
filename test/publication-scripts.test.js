import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PUBLIC_BOOK_SCRIPT} from '../src/publication-browse.js';
import {assertPublicFiles} from '../src/privacy.js';

test('reviewed earlier public scripts remain readable; modified code is rejected',async()=>{
 const previous=await readFile(new URL('./fixtures/public-book-v1.txt',import.meta.url),'utf8');
 for(const source of [previous,previous.replaceAll('\n','\r\n'),PUBLIC_BOOK_SCRIPT])assert.doesNotThrow(()=>assertPublicFiles(new Map([['public-book.js',source]])));
 for(const source of [previous+'\nalert(1)',previous.replace('form.hidden=false','form.hidden=true'),PUBLIC_BOOK_SCRIPT+'\nalert(1)'])assert.throws(()=>assertPublicFiles(new Map([['public-book.js',source]])),{code:'UNSAFE'});
});
