import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesignCandidates} from '../src/design-candidates.js';
import {FileContent} from '../src/file-content.js';

const candidate=text=>({files:new Map([['page.html',text]]),pages:[{path:'page.html',title:'A page'}]});
test('ephemeral previews evict whole old candidates by both count and retained byte budget',()=>{
 const cache=new DesignCandidates({maxEntries:2,maxBytes:1800});
 cache.set('a',candidate('a'));cache.set('b',candidate('b'));cache.set('c',candidate('c'));
 assert.equal(cache.get('a'),undefined);assert.equal(cache.size,2);
 cache.set('d',candidate('d'.repeat(700)));assert.ok(cache.bytes<=1800);assert.ok(cache.get('d'));
 cache.set('d',candidate('short'));assert.equal(cache.size,2);assert.ok(cache.bytes<500);
 assert.equal(cache.delete('missing'),false);cache.clear();assert.equal(cache.size,0);assert.equal(cache.bytes,0);
});
test('a rejected oversized preview retains the previous page and streamed media does not count as buffered bytes',()=>{
 const cache=new DesignCandidates({maxBytes:4096});cache.set('saved',candidate('Previous preview'));
 assert.throws(()=>cache.set('large',candidate('x'.repeat(4096))),{code:'DESIGN_PREVIEW_LIMIT'});assert.ok(cache.get('saved'));
 const value=candidate('Page'),descriptor=new FileContent(null,'synthetic-video',400*1024*1024,'0'.repeat(64));value.files.set('media/video.mp4',descriptor);
 cache.set('video',value);assert.ok(cache.get('video'));assert.ok(cache.bytes<4096);
});
