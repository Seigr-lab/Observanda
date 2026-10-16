import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inventoryWindow,websiteMediaItems,websiteMediaItem,websiteAssetUsed,contentProjects,contentRecords} from '../src/web/website-inventory.js';

test('inventory windows stream a large label source, clamp after removal and never read body fields',()=>{
 const source=function*(count){for(let i=0;i<count;i++)yield {label:'Item '+i,get body(){throw Error('Original read');}};};
 const first=inventoryWindow(source(10003)),last=inventoryWindow(source(10003),{offset:9996});
 assert.equal(first.items.length,12);assert.equal(first.total,10003);assert.equal(last.items.length,7);assert.equal(last.next,null);assert.equal(last.previous,9984);
 const removed=inventoryWindow(source(9990),{offset:9996});assert.equal(removed.offset,9984);assert.equal(removed.items.length,6);assert.equal(removed.items[0].label,'Item 9984');
 const found=inventoryWindow(source(10003),{query:'item 10002'});assert.equal(found.total,1);assert.equal(found.items[0].label,'Item 10002');
 assert.equal(inventoryWindow(source(0),{offset:24}).offset,0);assert.throws(()=>inventoryWindow([],{offset:Infinity}));
});

test('website and research media stay distinct and reuse checks include saved layouts and shared regions',()=>{
 const image={id:'image',kind:'image',caption:'Grid',alt:'',get transcript(){throw Error('Transcript read');}},audio={id:'audio',kind:'audio',caption:'Tone',alt:''};
 const book={website:{assets:[image,audio],home:{sections:[]},layouts:[],templates:[{sections:[{kind:'gallery',assetIds:['image']}]}],design:{regions:{definitions:[{sections:[{assetId:'audio'}]}]}}},pages:[],entries:[{id:'r1',title:'Inspection',share:false,attachments:[{...audio,share:false}],get body(){throw Error('Original read');}}]};
 assert.deepEqual([...websiteMediaItems(book,{kind:'image'})].map(i=>i.key),['image']);assert.equal([...websiteMediaItems(book,{research:true})][0].key,'r1:audio');
 assert.equal(websiteMediaItem(book,'r1:audio',{research:true}).label,'Inspection / Tone');assert.equal(websiteMediaItem(book,'missing'),null);
 assert.equal(websiteAssetUsed(book,'image'),true);assert.equal(websiteAssetUsed(book,'audio'),true);assert.equal(websiteAssetUsed(book,'unused'),false);assert.equal(book.entries[0].share,false);
});

test('public-content windows find records across projects without copying bodies or changing sharing',()=>{
 const book={projects:Array.from({length:40},(_,i)=>({id:'p'+i,title:'Project '+i,share:i%2===0})),notebooks:Array.from({length:40},(_,i)=>({id:'n'+i,projectId:'p'+i})),entries:[]};
 book.entries=Array.from({length:4000},(_,i)=>({id:'r'+i,notebookId:'n'+Math.floor(i/100),title:'Record '+i,share:i%3===0,get body(){throw Error('Original read');}}));
 const projects=inventoryWindow(contentProjects(book),{limit:5});assert.equal(projects.total,40);assert.equal(projects.items.length,5);assert.equal(projects.items[0].total,100);assert.equal(projects.items[0].included,34);
 const found=inventoryWindow(contentProjects(book,'Record 3999'),{limit:5});assert.equal(found.total,1);assert.equal(found.items[0].project.id,'p39');
 const records=inventoryWindow(contentRecords(book,found.items[0].project,'Record 3999'),{limit:10});assert.equal(records.items[0],book.entries[3999]);assert.equal(records.total,1);
 assert.equal(inventoryWindow(contentRecords(book,book.projects[39],'Project 39'),{limit:10}).total,100);assert.equal(book.projects[39].share,false);
});
