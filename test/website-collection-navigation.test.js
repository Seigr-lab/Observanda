import test from 'node:test';
import assert from 'node:assert/strict';
import {WebsiteCollectionNavigation} from '../src/web/website-collection-navigation.js';

test('collection reading state compares complete pin values independently of JSON property order',()=>{
 const navigation=new WebsiteCollectionNavigation(),context=JSON.stringify(['workspace',null,null,true,null]);
 const book={website:{layouts:[],design:{},home:{sections:[{id:'records',kind:'records',show:true}]}},pages:[]};
 const pin={researchSnapshotId:'a'.repeat(64),websiteId:null,websiteRevision:'b'.repeat(64)},request={key:'section:records',query:'feed=section%3Arecords&feedSearch=Selected',definition:'c'.repeat(64)};
 navigation.prepare(context,'home',{websitePin:pin},book);
 // Model a fully applied visitor filter before another editor checkpoint.
 navigation.queries.set(request.key,request);
 const reordered={websiteId:pin.websiteId,websiteRevision:pin.websiteRevision,researchSnapshotId:pin.researchSnapshotId};
 assert.deepEqual(navigation.prepare(context,'home',{websitePin:reordered},book).collections,[request]);
 for(const [field,value] of [['researchSnapshotId','d'.repeat(64)],['websiteId','00000000-0000-4000-8000-000000000001'],['websiteRevision','e'.repeat(64)]]){
  navigation.prepare(context,'home',{websitePin:pin},book);navigation.queries.set(request.key,request);
  assert.deepEqual(navigation.prepare(context,'home',{websitePin:{...pin,[field]:value}},book).collections,[],field+' must invalidate the old reading state');
 }
 navigation.prepare(context,'home',{websitePin:pin},book);navigation.queries.set(request.key,request);
 assert.deepEqual(navigation.prepare(JSON.stringify(['another-workspace',null,null,true,null]),'home',{websitePin:pin},book).collections,[]);
});
