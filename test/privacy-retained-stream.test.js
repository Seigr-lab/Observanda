import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {hasPrivateText,normalizePrivateText,privateTextPatterns} from '../src/privacy-text.js';
import {hasPrivateTextStream,PRIVACY_NORMALIZATION_SEGMENT} from '../src/privacy-text-stream.js';
import {PrivacyPatternStream,PrivacyBlockedStream} from '../src/privacy-pattern-stream.js';
import {admitRetainedPublicFile,assertPublicFiles} from '../src/privacy.js';
import {FileContent,writeContent} from '../src/file-content.js';

const source=(value,size=7)=>async function*(){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);for(let i=0;i<bytes.length;i+=size)yield bytes.subarray(i,i+size);};
async function same(value,blocked=[],sizes=[1,2,7,31,16384]){
 const expected=hasPrivateText(value,blocked);
 for(const size of sizes)assert.equal(await hasPrivateTextStream(source(value,size),blocked),expected,JSON.stringify({value:value.slice(0,160),blocked,size,expected}));
}
test('retained text preserves buffered privacy decisions across encoding and unbounded-pattern boundaries',async()=>{
 const examples=['Ordinary authored prose.',String.raw`C:\private\notes`,String.raw`\\server\folder`,'file'+ ' '.repeat(700)+' : notes','~/notes','"/home/person','a/home/person','/homecoming','/home.','Bearer'+ ' '.repeat(700)+'abcdefghijklmnop','Bearer short','api_key'+ ' '.repeat(700)+' = "abcdefgh"','mypassword: abcdefghijk','password: abcdefghijk','https://'+ 'a'.repeat(1600)+':'+ 'b'.repeat(900)+'@example.test','https://safe.example/test','-----BEGIN OPENSSH PRIVATE KEY-----','-----begin private key-----','ghp_'+ 'x'.repeat(1600),'ghp_'+ 'x'.repeat(1600)+'-suffix','AKIA'+'X'.repeat(16),'AKIA'+'X'.repeat(17),'\uff34\uff45\uff58\uff54 \uff23\uff1a\uff3cnotes','%43%3a%5cnotes','%2543%253a%255cnotes','&#67;&colon;&bsol;notes',String.raw`\u0043:\x5cnotes`,String.raw`\u005Cu0043:\\u005cnotes`,'&amp;#67;&amp;colon;&amp;bsol;notes','prefix '+Buffer.from('C:/private/observation').toString('base64'),'plain \u00c5ngstr\u00f6m \u{1f41d} \u6f22\u5b57'];
 for(const value of examples)await same(value);
 const alphabet=['a','B',' ','\n',':','/','\\','_','@','=','"','\u0301','\u00a0'];let state=321;
 for(let i=0;i<100;i++){let value='';for(let j=0;j<80;j++){state=(state*1664525+1013904223)>>>0;value+=alphabet[state%alphabet.length];}await same(value,[],[1,19]);}
});
test('the streaming automata preserve exact pattern and Unicode lowercase context',()=>{
 const values=['password'+ ' '.repeat(70000)+':abcdefgh','https://'+ 'a'.repeat(210000)+':secret@example.test','xfile'+ ' '.repeat(70000)+':notes','ghp_'+ 'a'.repeat(210000)+'_','x\\\\'+ 'b'.repeat(210000)+'/', 'plain normal text'];
 for(const value of values){const scan=new PrivacyPatternStream();for(let at=0;at<value.length;at+=73)scan.push(value.slice(at,at+73));assert.equal(scan.finish(),privateTextPatterns.some(pattern=>pattern.test(value)));}
 const cases=['\u039f\u03a3 end','\u039f\u03a3\u0391 end','A\u03a3\u0301 ','A\u03a3\u0301A','A\u03a3\u02b0 ','A\u03a3\u02b0A','\u0130STANBUL','\u{10400}word','A\u03a3'+ '\u0301'.repeat(9000)+' end','\u02b0\u03a3'];
 for(const value of cases)for(const blocked of ['\u03bf\u03c2 end','\u03bf\u03c3\u03b1','a\u03c2\u0301 ','a\u03c3\u0301a','a\u03c2\u02b0 ','a\u03c3\u02b0a','i\u0307stanbul','\u{10428}word']){
  const scan=new PrivacyBlockedStream([blocked]);for(let at=0;at<value.length;at++)scan.push(value[at]);assert.equal(scan.finish(),value.toLowerCase().includes(blocked),JSON.stringify({value:value.slice(0,30),blocked}));
 }
});
test('global URI fallback, numeric entities and NFKC agree with buffered normalization',async()=>{
 const cases=[['%C3%A9secret',['\u00e9secret']],['%C3%A9secret'+ ' ordinary '.repeat(300)+'%GG',['\u00e9secret']],['%25C3%25A9secret',['\u00e9secret']],['%25C3%25A9secret tail %25GG',['\u00e9secret']],['%E0%80%AFhome/public',[]],['%F0%9F%90%9Dnotes',['\u{1f41d}notes']],['&#'+ '0'.repeat(17000)+'67;&colon;&bsol;notes',[]],['&#'+ '9'.repeat(17000)+';&colon; ordinary',[]],['A\u030a notes',['\u00c5 notes']],['\u1100\u1161\u11a8 note',['\uac01 note']],['\ufb03 note',['ffi note']],['\ufdfa note',['\u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645']],['\u212b\u0323 notes',[normalizePrivateText('\u212b\u0323 notes')]],['\u039f\u03a3 end',['\u03bf\u03c2 end']],['%CE%9F%CE%A3 end',['\u03bf\u03c2 end']]];
 for(const [value,blocked] of cases)await same(value,blocked,[1,13,16384]);
});
test('base64 tokens retain their exact existing limit and do not accumulate decoded candidates',async()=>{
 for(const length of [23,24,199998,199999,200000,200001])for(const pad of ['', '=', '=='])await same(' '+ 'A'.repeat(length)+pad+' ',[],[16384]);
 const value=Array(3000).fill(Buffer.from('Ordinary public text with no secrets.').toString('base64')).join(' '),stats={};assert.equal(await hasPrivateTextStream(source(value,8192),[],{stats}),false);assert.ok(stats.maximumBase64Units<=200000+16384);assert.ok(stats.maximumPatternTransitions<=8192);
});
test('normalization complexity fails explicitly without truncation or a document-size limit',async()=>{
 await same('a'+'\u0301'.repeat(PRIVACY_NORMALIZATION_SEGMENT-1),[],[16384]);
 await assert.rejects(hasPrivateTextStream(source('a'+'\u0301'.repeat(PRIVACY_NORMALIZATION_SEGMENT)+' safe')), {code:'PRIVACY_TEXT_COMPLEXITY'});
 await assert.rejects(hasPrivateTextStream(source('a'+'\u0301'.repeat(PRIVACY_NORMALIZATION_SEGMENT)+' C:/secret')), {code:'PRIVACY_TEXT_COMPLEXITY'});
 const controller=new AbortController();controller.abort(new Error('Stop inspection'));await assert.rejects(hasPrivateTextStream(source('safe'),[],{signal:controller.signal}),/Stop inspection/);
 for(const bytes of [Buffer.from([0xff]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xe2,0x82])])await assert.rejects(hasPrivateTextStream(source(bytes,1)),{code:'UNSAFE'});
});
test('retained admission authenticates bytes and keys before caching a streamed text file',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-privacy-stream-')),vault={id:'synthetic',key:randomBytes(32)},workspace={vault,requireStorageKey:async()=>{if(!vault.key){const error=Error('locked');error.code='ACCESS_LOCKED';throw error;}},fileAAD:file=>path.basename(file)};
 t.after(async()=>{vault.key?.fill(0);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-privacy-stream-'));await rm(root,{recursive:true,force:true});});
 async function retained(name,text){const file=path.join(root,name),saved=await writeContent(workspace,file,source(text,29)());return new FileContent(workspace,file,saved.size,saved.sha256);}
 const safe=await retained('safe.blob','<p>\u00c5ngstr\u00f6m public observation \u{1f41d}.</p>');assert.equal(await admitRetainedPublicFile('index.html',safe,{type:'text'}),safe);assert.doesNotThrow(()=>assertPublicFiles(new Map([['index.html',safe]])));
 const privateFile=await retained('private.blob','<p>'+ 'ordinary '.repeat(5000)+'C:/private/notes</p>');await assert.rejects(admitRetainedPublicFile('index.html',privateFile,{type:'text'}),{code:'PRIVACY'});assert.throws(()=>assertPublicFiles(new Map([['index.html',privateFile]])),{code:'UNSAFE'});
 const damaged=await retained('damaged.blob','safe text'),bytes=await readFile(damaged.file);bytes[bytes.length-1]^=1;await writeFile(damaged.file,bytes);await assert.rejects(admitRetainedPublicFile('index.html',damaged,{type:'text'}),error=>['ENCRYPTION_DAMAGED','MEDIA_INVALID'].includes(error.code));
 const wrong=new FileContent(workspace,safe.file,safe.size,'0'.repeat(64));await assert.rejects(admitRetainedPublicFile('index.html',wrong,{type:'text'}),{code:'MEDIA_INVALID'});
 const invalid=await retained('invalid.blob',Buffer.from([0xff]));await assert.rejects(admitRetainedPublicFile('index.html',invalid,{type:'text'}),{code:'UNSAFE'});
 const locked=await retained('locked.blob','safe text'),read=locked.read.bind(locked);let passes=0;locked.read=async function*(...args){yield* read(...args);if(++passes===2){vault.key.fill(0);vault.key=null;}};await assert.rejects(admitRetainedPublicFile('index.html',locked,{type:'text'}),{code:'ACCESS_LOCKED'});
});
test('privacy scanning memory remains bounded as ordinary output grows sixteenfold',t=>{
 const program=`import {hasPrivateTextStream} from './src/privacy-text-stream.js';const mib=Number(process.argv[1]),stats={},chunk=Buffer.from('Ordinary public observation. '.repeat(600));let remaining=mib*1024*1024;const source=async function*(){let left=remaining;while(left){const n=Math.min(left,chunk.length);yield chunk.subarray(0,n);left-=n;}};const privateText=await hasPrivateTextStream(source,[],{stats});console.log(JSON.stringify({privateText,stats,rss:process.resourceUsage().maxRSS}));`;
 const measured=[4,64].map(size=>{const result=spawnSync(process.execPath,['--max-old-space-size=96','--input-type=module','-e',program,String(size)],{cwd:path.resolve('.'),encoding:'utf8',timeout:120000,windowsHide:true});assert.equal(result.status,0,result.stderr||result.error?.message);return JSON.parse(result.stdout);});
 for(const value of measured){assert.equal(value.privateText,false);assert.ok(value.stats.maximumNormalizationUnits<=PRIVACY_NORMALIZATION_SEGMENT);assert.ok(value.stats.maximumPatternTransitions<=8192);}
 assert.ok(measured[1].rss-measured[0].rss<48*1024,JSON.stringify(measured));t.diagnostic(JSON.stringify({sizesMiB:[4,64],results:measured}));
});
