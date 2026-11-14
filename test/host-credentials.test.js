import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from '../scripts/work-directory.js';
import {HostCredentials} from '../src/host-credentials.js';

// A device key store like the operating system protected one: the private key
// is available only on this computer.
function device(){
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072}),spki=publicKey.export({format:'der',type:'spki'}).toString('base64');
 const identity={format:'observanda-device-v1',id:createHash('sha256').update(Buffer.from(spki,'base64')).digest('hex'),publicKey:spki};
 return {available:()=>true,identity:async()=>identity,privateKey:async()=>({identity,key:privateKey})};
}
const destination={protocol:'ftp',host:'Example.org',port:21,user:'site'};

test('an FTP password is kept encrypted for this computer only, never in plain text, and can be forgotten',async t=>{
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'host-credentials-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'preferences.json.host-credentials.json'),here=device(),password='correct horse battery staple ü';
 const store=new HostCredentials({file,deviceStore:here});
 assert.equal(await store.has(destination),false);await assert.rejects(store.read(destination),{code:'PUBLISH_PASSWORD'});
 assert.deepEqual(await store.save(destination,password),{remembered:true});
 assert.equal(await new HostCredentials({file,deviceStore:here}).read({...destination,host:'example.org'}),password,'host names are not case sensitive');
 const stored=await readFile(file,'utf8');assert.equal(stored.includes('correct horse'),false);assert.equal(stored.includes('site'),false);
 await assert.rejects(new HostCredentials({file,deviceStore:device()}).read(destination),{code:'PUBLISH_PASSWORD'},'another computer cannot read it');
 await assert.rejects(store.read({...destination,user:'other'}),{code:'PUBLISH_PASSWORD'});
 for(const bad of ['', 'a\nb', 'x'.repeat(1025)])await assert.rejects(store.save(destination,bad),{code:'PUBLISH_PASSWORD'});
 await store.forget(destination);assert.equal(await store.has(destination),false);
});

test('without a device key store, or when not remembered, a password lasts only for this session',async t=>{
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'host-credentials-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,'preferences.json.host-credentials.json');
 const unavailable=new HostCredentials({file,deviceStore:{available:()=>false}});
 assert.equal(unavailable.persistent(),false);assert.deepEqual(await unavailable.save(destination,'session only'),{remembered:false});
 assert.equal(await unavailable.read(destination),'session only');
 await assert.rejects(new HostCredentials({file,deviceStore:{available:()=>false}}).read(destination),{code:'PUBLISH_PASSWORD'},'a new session has no password');
 const here=new HostCredentials({file,deviceStore:device()});
 assert.deepEqual(await here.save(destination,'not kept',{remember:false}),{remembered:false});assert.equal(await here.read(destination),'not kept');
 assert.equal(JSON.parse(await readFile(file,'utf8')).entries&&Object.keys(JSON.parse(await readFile(file,'utf8')).entries).length,0);
});
