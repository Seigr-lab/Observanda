import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createPublicHttpsRequest} from '../src/public-https.js';
import {publicAddress} from '../src/public-network.js';

test('public HTTPS rejects special-purpose and alternate-spelling local destinations before opening a socket',async()=>{
 let sockets=0,dns=0;const fetch=createPublicHttpsRequest({resolve:async()=>{dns++;return [];},request:()=>{sockets++;throw Error('unexpected socket');}});
 for(const host of ['127.0.0.1','127.1','2130706433','0x7f000001','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.1','224.0.0.1','[::1]','[::ffff:127.0.0.1]','[fc00::1]','[fe80::1]','[2002:7f00:1::]','[2001:db8::1]','[3fff::1]'])await assert.rejects(fetch(`https://${host}/`));
 for(const url of ['http://example.org/','https://user:password@example.org/','https://example.org/#fragment'])await assert.rejects(fetch(url));
 assert.equal(sockets,0);assert.equal(dns,0);
 assert.equal(publicAddress('2606:4700:4700::1111'),true);assert.equal(publicAddress('1.1.1.1'),true);
});

test('empty, mixed and malformed DNS answers never open a socket',async()=>{
 let sockets=0;
 for(const answers of [[],[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}],[{address:'1.1.1.1',family:6}],[{address:'::ffff:10.0.0.1',family:6}]]){
  const fetch=createPublicHttpsRequest({resolve:async()=>answers,request:()=>{sockets++;}});await assert.rejects(fetch('https://site.example/'));
 }
 assert.equal(sockets,0);
});

function socketFixture(status=200){
 const calls=[];let response;
 const request=(url,options,receive)=>{
  const req=new EventEmitter();calls.push({url,options});req.end=()=>queueMicrotask(()=>{response=Readable.from([Buffer.from('verified bytes')]);response.statusCode=status;response.headers={'content-type':'text/plain'};receive(response);});return req;
 };
 return {request,calls,get response(){return response;}};
}
test('validated DNS is pinned for every socket lookup while hostname and TLS defaults remain intact',async()=>{
 let dns=0;const fixture=socketFixture(),fetch=createPublicHttpsRequest({resolve:async()=>{dns++;return [{address:dns===1?'1.1.1.1':'127.0.0.1',family:4}];},request:fixture.request});
 const result=await fetch('https://site.example/path',{headers:{Authorization:'secret',Cookie:'secret'}});assert.equal(await result.text(),'verified bytes');
 const {url,options}=fixture.calls[0];assert.equal(url.hostname,'site.example');assert.equal(options.agent,false);assert.equal(options.rejectUnauthorized,undefined);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
 options.lookup('site.example',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'1.1.1.1');assert.equal(family,4);});
 options.lookup('site.example',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'1.1.1.1',family:4}]);});assert.equal(dns,1);
 await assert.rejects(fetch('https://site.example/next'));assert.equal(fixture.calls.length,1);
});
test('redirects are rejected without following their location',async()=>{
 for(const status of [301,302,303,307,308]){const fixture=socketFixture(status),fetch=createPublicHttpsRequest({resolve:async()=>[{address:'1.1.1.1',family:4}],request:fixture.request});await assert.rejects(fetch('https://site.example/'),/redirects/);assert.equal(fixture.calls.length,1);assert.equal(fixture.response.destroyed,true);}
});
test('cancelling a pending resolver does not open a socket',async()=>{
 let sockets=0;const controller=new AbortController(),fetch=createPublicHttpsRequest({resolve:()=>new Promise(()=>{}),request:()=>{sockets++;}}),pending=fetch('https://site.example/',{signal:controller.signal});controller.abort(new Error('cancelled'));await assert.rejects(pending,/cancelled/);assert.equal(sockets,0);
});
test('public IP literals bypass DNS and request failures propagate',async()=>{
 let dns=0;const fixture=socketFixture(),fetch=createPublicHttpsRequest({resolve:async()=>{dns++;throw Error('unexpected resolver');},request:fixture.request});
 for(const address of ['1.1.1.1','[2606:4700:4700::1111]'])assert.equal(await (await fetch(`https://${address}/`)).text(),'verified bytes');
 assert.equal(dns,0);
 const failed=createPublicHttpsRequest({request:()=>{const req=new EventEmitter();req.end=()=>queueMicrotask(()=>req.emit('error',new Error('TLS rejected')));return req;}});
 await assert.rejects(failed('https://1.1.1.1/'),/TLS rejected/);
});
