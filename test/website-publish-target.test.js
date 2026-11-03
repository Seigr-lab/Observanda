import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {rememberPublishTarget,websitePublishTarget} from '../src/website-publish-target.js';

function metadata(){
 const values=new Map();
 return {values,withLock:task=>task(),readMetadata:name=>values.get(name)??null,writeMetadata:(name,value)=>values.set(name,value),
  async *metadataNames(directory){for(const name of values.keys())if(name.startsWith(directory+'/'))yield name.slice(directory.length+1);}};
}
const noRemote=async()=>({configured:false});
test('publish update reuses only an unambiguous completed folder from earlier publication receipts',async()=>{
 const site=metadata(),owners='.observanda/local-exports/owners/',directory=path.resolve('site-output');
 site.values.set(owners+'a'.repeat(64)+'.json',JSON.stringify({directory,releaseId:'published'}));
 site.values.set(owners+'b'.repeat(64)+'.json',JSON.stringify({directory:path.resolve('other-output'),pending:'review'}));
 assert.deepEqual(await websitePublishTarget(site,noRemote),{kind:'folder',directory});
 site.values.set(owners+'b'.repeat(64)+'.json',JSON.stringify({directory:path.resolve('other-output'),releaseId:'published'}));
 assert.deepEqual(await websitePublishTarget(site,noRemote),{kind:'choose'});
});
test('a delayed completion cannot redirect subsequent site updates to a previously selected folder',async()=>{
 const site=metadata(),directory=path.resolve('site-output');
 await rememberPublishTarget(site,'folder',directory,'2026-01-01T00:00:00Z');
 assert.deepEqual(await websitePublishTarget(site,()=>assert.fail('unexpected remote access')),{kind:'folder',directory});
 await rememberPublishTarget(site,'remote',undefined,'2026-01-03T00:00:00Z');
 await rememberPublishTarget(site,'folder',directory,'2026-01-02T00:00:00Z');
 const destination={configured:true,config:{kind:'ssh'}};
 assert.deepEqual(await websitePublishTarget(site,()=>destination),{kind:'remote',destination});
 assert.deepEqual(await websitePublishTarget(metadata(),noRemote),{kind:'choose'});
});
