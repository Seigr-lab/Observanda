import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {websitePageAtPath,websitePageTarget,websitePageChoices,websitePageWindow} from '../src/web/website-page-targets.js';

test('page choices retain only a small window and the active page without reading originals',()=>{
 const entries=Array.from({length:10000},(_,i)=>({id:randomUUID(),title:'Record '+i,get body(){throw Error('Body read');}}));
 const book={website:{home:{enabled:true}},pages:[],projects:[],notebooks:[],entries};
 const last='entries/'+entries.at(-1).id+'.html',result=websitePageChoices(book,last);
 assert.equal(result.more,true);assert.equal(result.choices.length,26);assert.equal(result.choices[0].path,last);
 assert.equal(websitePageAtPath(book,last).title,'Record 9999');assert.equal(websitePageAtPath(book,'unrelated.html'),null);assert.equal(websitePageTarget(book,'entry:'+randomUUID()),null);
 const window=websitePageWindow(book,{kind:'entry',search:'Record 99',offset:25});
 assert.equal(window.items.length,25);assert.equal(window.total,111);assert.equal(window.previousCursor,0);assert.equal(window.nextCursor,50);
 assert.ok(window.items.every(item=>Object.keys(item).sort().join()==='path,target,title'));
});

test('unsaved website pages are discoverable and empty homes do not invent destinations',()=>{
 const book={website:{home:{enabled:false}},pages:[],projects:[],notebooks:[],entries:[]};
 assert.deepEqual(websitePageChoices(book,''),{choices:[],more:false});assert.equal(websitePageAtPath(book,'index.html'),null);
 book.pages.push({id:randomUUID(),title:'Unpublished field journal',get body(){throw Error('Body read');}});
 assert.equal(websitePageWindow(book,{kind:'site',search:'field'}).items[0].title,book.pages[0].title);
 book.pages[0].title='Renamed draft';assert.equal(websitePageWindow(book,{kind:'site',search:'field'}).total,0);
 book.website.home.enabled=true;assert.equal(websitePageWindow(book,{kind:'site',search:'Home'}).total,1);
});
