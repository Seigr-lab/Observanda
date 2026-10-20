// Initialize the storage graph in the same order as the application.
import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebsiteSites} from '../src/website-sites.js';
import {publicationSource} from '../src/publication-source.js';

// Obsolete input is recognized, never extended with another website backend.
test('website editing and publication reject obsolete storage before reading or writing website data',async()=>{
 const workspace=new Proxy({storageKind:async()=> 'document'}, {get(target,key){if(key in target)return target[key];if(['websiteContext','websiteId'].includes(key))return undefined;throw Error('Unexpected obsolete-storage operation: '+String(key));}});
 const sites=new WebsiteSites(workspace),expected={code:'STORAGE_UPGRADE_REQUIRED'};
 for(const operation of [()=>sites.list(),()=>sites.version(null),()=>sites.read(null),()=>sites.change({}),()=>sites.save(null,{}),()=>publicationSource(workspace,{})])await assert.rejects(operation,expected);
});
