import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPublicFiles} from '../src/privacy.js';

test('earlier shipped index scripts remain admitted without admitting altered code',async()=>{
 for(const version of [1,2]){const old=await readFile(new URL('./fixtures/public-book-v'+version+'.txt',import.meta.url),'utf8');assert.doesNotThrow(()=>assertPublicFiles(new Map([['public-book.js',old]])));assert.throws(()=>assertPublicFiles(new Map([['public-book.js',old+'\nalert(1)']])) ,{code:'UNSAFE'});}
});

