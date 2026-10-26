import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {downloadFingerprint,withheldTextCheck} from './desktop/download-verification.js';

async function* chunks(bytes,width=1){for(let offset=0;offset<bytes.length;offset+=width)yield bytes.subarray(offset,offset+width);}

test('download verification hashes exact bytes while decoding split UTF-8 text once',async()=>{
 const bytes=Buffer.from('\ufeffPublic observation: café 🌿.'),text=[];
 const result=await downloadFingerprint(chunks(bytes),{checkText:value=>text.push(value)});
 assert.deepEqual(result,{size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 assert.equal(text.join(''),'Public observation: café 🌿.');
});

test('publication privacy checks reject markers across stream chunks and text file boundaries',async()=>{
 const marker='WITHHELD_EVIDENCE_';
 await assert.rejects(downloadFingerprint(chunks(Buffer.from('Before '+marker+' after'),3),{checkText:withheldTextCheck([marker])}),/contains withheld text/);
 const checkText=withheldTextCheck([marker]);
 await downloadFingerprint(chunks(Buffer.from('Public text WITHHELD_'),4),{checkText});
 await assert.rejects(downloadFingerprint(chunks(Buffer.from('\ufeffEVIDENCE_hidden'),2),{checkText}),/contains withheld text/);
});

test('publication checks stream a large safe body and retain matching tails across text files only',async()=>{
 const marker='withheld-private-marker',checkText=withheldTextCheck([marker]),safe=Buffer.alloc(256*1024,120);
 await downloadFingerprint(chunks(safe,8192),{checkText});
 await downloadFingerprint(chunks(Buffer.from('withheld-'),2),{checkText});
 const binary=Buffer.from('unpublished binary label');
 assert.deepEqual(await downloadFingerprint(chunks(binary,5)),{size:binary.length,sha256:createHash('sha256').update(binary).digest('hex')});
 await assert.rejects(downloadFingerprint(chunks(Buffer.from('private-marker'),2),{checkText}),/contains withheld text/);
});

test('an interrupted download cannot return a completed fingerprint',async()=>{
 async function* interrupted(){yield Buffer.from('partial');throw Error('Transport interrupted');}
 await assert.rejects(downloadFingerprint(interrupted(),{checkText:withheldTextCheck(['secret'])}),/Transport interrupted/);
});
