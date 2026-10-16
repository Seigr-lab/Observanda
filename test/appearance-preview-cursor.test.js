import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {encodeAppearanceCursor,decodeAppearanceCursor} from '../src/appearance-preview-cursor.js';
import {ENVELOPE,unseal} from '../src/encryption.js';
import {hasPrivateText,assertPublicFields,assertPublicFiles} from '../src/privacy.js';

const key=Buffer.alloc(32,11),aad='appearance-card-page/synthetic-owner',format='observanda-preview-cursor';
function fixture(){
 // A fixed synthetic nonce deliberately contains bytes that look like a path
 // when an opaque encrypted envelope is incorrectly decoded as pasted text.
 const nonce=Buffer.from([255,0,110,58,92,1,254,2,253,3,252,4]),cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from(aad));
 const plaintext=Buffer.from(JSON.stringify({binding:'synthetic-query',after:24,backward:false}));
 const content=Buffer.concat([cipher.update(plaintext),cipher.final()]);
 return {bytes:Buffer.concat([ENVELOPE,nonce,cipher.getAuthTag(),content]),plaintext};
}
const envelope=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

test('preview cursor transport keeps valid authenticated binary out of pasted-text privacy inspection',()=>{
 const {bytes,plaintext}=fixture(),legacy=bytes.toString('base64url'),cursor=encodeAppearanceCursor(bytes);
 assert.equal(hasPrivateText(legacy),true);
 assert.throws(()=>assertPublicFiles(new Map([['index.html','<a href="?cards='+legacy+'">Next</a>']])),{code:'PRIVACY'});
 assert.equal(hasPrivateText(cursor),false);
 assert.doesNotThrow(()=>assertPublicFiles(new Map([['index.html','<a href="?cards='+cursor+'">Next</a>']])));
 assert.deepEqual(decodeAppearanceCursor(cursor),bytes);
 assert.deepEqual(decodeAppearanceCursor(legacy),bytes);
 assert.deepEqual(unseal(decodeAppearanceCursor(cursor),key,aad),plaintext);
});

test('text envelopes keep credential-shaped ciphertext distinct from authored credentials',()=>{
 // Synthetic envelope-shaped bytes isolate the representation; authentication
 // is checked independently by the valid AES-GCM fixture above and below.
 const bytes=Buffer.concat([ENVELOPE,Buffer.alloc(28),Buffer.from('-ghp_'+'a'.repeat(19),'base64url')]);
 assert.equal(hasPrivateText(envelope({format,value:bytes.toString('base64url')})),true);
 const cursor=encodeAppearanceCursor(bytes);assert.equal(hasPrivateText(cursor),false);
 assert.deepEqual(decodeAppearanceCursor(cursor),bytes);
 assert.doesNotThrow(()=>assertPublicFiles(new Map([['index.html','<a href="?cards='+cursor+'">Next</a>']])));
});

test('transport changes cannot bypass cursor authentication or its purpose binding',()=>{
 const {bytes}=fixture(),changed=Buffer.from(bytes);changed[changed.length-1]^=1;
 const tampered=encodeAppearanceCursor(changed);
 assert.throws(()=>unseal(decodeAppearanceCursor(tampered),key,aad),{code:'ENCRYPTION_DAMAGED'});
 const cursor=encodeAppearanceCursor(bytes);
 assert.throws(()=>unseal(decodeAppearanceCursor(cursor),key,'appearance-browse-page/synthetic-owner'),{code:'ENCRYPTION_DAMAGED'});
 assert.throws(()=>unseal(decodeAppearanceCursor(cursor),Buffer.alloc(32,12),aad),{code:'ENCRYPTION_DAMAGED'});
});

test('cursor envelopes reject malformed, noncanonical, unsupported and oversized transports',()=>{
 const {bytes}=fixture(),value=bytes.toString('hex'),cursor=encodeAppearanceCursor(bytes);
 for(const invalid of [
  null,1,'',cursor+'=',cursor+'!',cursor.slice(0,-1),value+'=','A'.repeat(4097),
  Buffer.from([255,254,253]).toString('base64url'),envelope(null),envelope([]),envelope({}),
  envelope({format:'other',value}),envelope({format,value,extra:true}),envelope({value,format}),
  envelope({format,value:1}),envelope({format,value:value+'='}),envelope({format,value:''}),envelope({format,value:value.toUpperCase()}),envelope({format,value:value.slice(0,-1)}),
  envelope({format,value:ENVELOPE.toString('hex')}),envelope({format,value:cursor}),
  Buffer.from(JSON.stringify({format,value},null,2)).toString('base64url')
 ])assert.throws(()=>decodeAppearanceCursor(invalid),{code:'INVALID'});
 for(const invalid of [null,new Uint8Array(bytes),Buffer.alloc(0),ENVELOPE,Buffer.concat([ENVELOPE,Buffer.alloc(4096)])])assert.throws(()=>encodeAppearanceCursor(invalid),{code:'INVALID'});
 const fitting=Buffer.concat([ENVELOPE,Buffer.alloc(1000)]);assert.deepEqual(decodeAppearanceCursor(encodeAppearanceCursor(fitting)),fitting);
});

test('authored base64 private text remains blocked in fields and generated output',()=>{
 for(const text of [String.raw`D:\Users\ImaginaryResearcher\notes.txt`,'/home/imaginary-researcher/private.txt']){
  const pasted=Buffer.from(text).toString('base64');
  assert.equal(hasPrivateText(pasted),true);
  assert.throws(()=>assertPublicFields([{field:'body',value:pasted}]),{code:'PRIVACY'});
  assert.throws(()=>assertPublicFiles(new Map([['index.html','<p>'+pasted+'</p>']])),{code:'PRIVACY'});
 }
});
