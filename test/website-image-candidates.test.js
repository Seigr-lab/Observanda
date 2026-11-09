import test from 'node:test';
import assert from 'node:assert/strict';
import {imageCandidates,mapImageCandidates} from '../src/web/website-image-candidates.js';
import {validateWebsiteHTML,draftWebsiteMediaReferences} from '../src/website-file-policy.js';
import {websiteFileReferences} from '../src/website-page-dependencies.js';
import {movedWebsiteText} from '../src/website-page-paths.js';
import {authoredPageVersion} from '../src/website-version-document.js';
import {feedContentAtPage} from '../src/website-feed-template.js';

test('both HTML image descriptor families identify local candidate dependencies, including in nested pages and protected history',()=>{
 const raw='../pictures/a,b.png 320w,\t../pictures/large.png 640w';
 assert.deepEqual(imageCandidates(raw).map(c=>c.url),['../pictures/a,b.png','../pictures/large.png']);
 assert.equal(mapImageCandidates(raw,url=>url.slice(3)),'pictures/a,b.png 320w,\tpictures/large.png 640w');
 assert.deepEqual(imageCandidates('small.png, large.png 2x').map(c=>c.descriptor),['','2x']);
 const html='<picture><source media="(min-width: 800px)" srcset="'+raw+'" sizes="80vw"><img src="../pictures/small.png" alt="sample"></picture>';
 const expected=['pictures/a,b.png','pictures/large.png','pictures/small.png'];
 const pictures=new Set();validateWebsiteHTML(html,{file:'nested/page.html',pictures});assert.deepEqual([...pictures].sort(),expected);
 assert.deepEqual(websiteFileReferences(html,'nested/page.html').map(r=>r.name),expected);
 assert.deepEqual([...draftWebsiteMediaReferences(html,'','nested/page.html','style.css').pictures].sort(),expected);
 assert.match(movedWebsiteText(html,'nested/page.html','new/dir/page.html','nested/page.html','new/dir/page.html'),/\.\.\/\.\.\/pictures\/large\.png 640w/);
 const version=authoredPageVersion(html,'nested/page.html',new Set(['pictures/large.png']));
 assert.deepEqual(version.slots.map(row=>row.kind),['resource']);assert.ok(!version.chunks.join('').includes('large.png'));
 const file='assets/'+'b'.repeat(64)+'.png';assert.match(feedContentAtPage('<img srcset="'+file+' 480w">','more/fields/plate.html','owner'),/\.\.\/\.\.\/assets\/.+ 480w/);
 for(const value of ['small.png 2w, large.png 2x','small.png, large.png 1x','small.png 0w','small.png 1x,','small.png 4x, external.png bogus']){
  assert.equal(imageCandidates(value),null);assert.throws(()=>validateWebsiteHTML('<img srcset="'+value+'">'),{code:'INVALID'});
 }
});
