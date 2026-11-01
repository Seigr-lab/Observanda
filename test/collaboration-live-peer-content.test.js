import {test} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {liveCertificate} from '../src/collaboration/live-certificate.js';
import {startServer} from '../src/server.js';

test('an accepted signed peer cannot render a crafted record or active files at the local origin',async t=>{
 const f=await collaborationFixture(t),record=structuredClone(f.book.entries[0]),revision='a'.repeat(64),malicious=Buffer.from('<script>parent.compromised=true</script>');
 let type='text/html';record.attachments=[{id:randomUUID(),kind:'iframe',caption:'',alt:'',transcript:'',share:false}];
 const host=https.createServer({...await liveCertificate(f.author.workspace),minVersion:'TLSv1.3'},async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),operation=request.value?.operation;
  if(operation==='file'||operation==='figure-export'){res.writeHead(200,{'Content-Type':type,'Content-Length':malicious.length,'Content-Disposition':'inline; filename="attack.html"'});res.end(malicious);return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/challenge'?{instance:'a'.repeat(48),nonce:'b'.repeat(64)}:operation==='read'?{record,revision,workspaceId:f.book.id,role:'reader'}:{records:[],notebooks:[],role:'reader',next:null}));
 });
 await new Promise(resolve=>host.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{host.closeAllConnections();host.close(resolve);}));
 const certificate=await liveCertificate(f.author.workspace),card=await f.a.identity.sign({kind:'observanda.live.v1',workspaceId:f.book.id,organizationId:f.org.id,grantId:f.grant.id,endpoint:'https://127.0.0.1:'+host.address().port,certificate:certificate.cert,title:'Synthetic peer'});
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'peer-content.prefs')});t.after(()=>app.close());
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0],headers={Origin:app.origin,'Content-Type':'application/json',Cookie:cookie};
 const storage=await(await fetch(app.origin+'/api/storage',{headers})).json(),workspaceId=(await f.member.workspace.outline()).metadata.id;
 const request=(operation,data)=>fetch(app.origin+'/api/live/'+operation,{method:'POST',headers,body:JSON.stringify({workspaceId,...data})});
 const connected=await request('connect',{card,verifiedFingerprint:card.identity.id});assert.equal(connected.status,200);const {id:connectionId}=await connected.json();
 const response=await request('request',{connectionId,operation:'read',data:{recordId:record.id}});assert.equal((await response.json()).code,'COLLABORATION_INVALID');
 const file=kind=>app.origin+'/api/live/files/'+connectionId+'/'+record.id+'/'+kind+'/'+record.attachments[0].id+'?context='+storage.contextId;
 for(type of ['text/html','text/javascript','image/svg+xml']){
  const media=await fetch(file('media'),{headers});assert.equal((await media.json()).code,'COLLABORATION_INVALID');
  const artifact=await fetch(file('artifact'),{headers});assert.equal(artifact.status,200);assert.equal(artifact.headers.get('content-type'),'application/octet-stream');assert.match(artifact.headers.get('content-disposition'),/^attachment;/);assert.equal(artifact.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(artifact.headers.get('x-content-type-options'),'nosniff');assert.equal(await artifact.text(),malicious.toString());
 }
 type='image/png';const image=await fetch(file('media'),{headers});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('content-security-policy'),"default-src 'none'; sandbox");await image.arrayBuffer();
 const selection={recordId:record.id,figureId:randomUUID(),revision,format:'svg'},figure=await fetch(app.origin+'/api/live/figures/'+connectionId+'/'+record.id+'/'+selection.figureId+'?context='+storage.contextId+'&selection='+encodeURIComponent(JSON.stringify(selection)),{headers});
 assert.equal(figure.status,200);assert.equal(figure.headers.get('content-type'),'application/octet-stream');assert.match(figure.headers.get('content-disposition'),/^attachment;/);await figure.arrayBuffer();
});
