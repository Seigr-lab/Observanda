import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleNotebook} from '../src/sample.js';
import {websitePreviewPage} from '../src/website-preview-page.js';
import {newElement} from '../src/web/composition-tree.js';

test('a text page requests neither corpus counts nor records; browse navigation asks only for existence',async()=>{
 const metadata=sampleNotebook();metadata.website.home.enabled=true;metadata.website.home.sections=[newElement('text')];metadata.website.layouts=[];metadata.website.regions=[];
 let existence=0;
 const records={store:{},descriptors:new Map(),async counts(){throw Error('Text page requested exact corpus counts');},async hasRecords(){existence++;return true;},async get(){throw Error('Text page loaded a record');},async original(){throw Error('Text page loaded raw content');}};
 metadata.website.design.navigation='none';
 const hidden=await websitePreviewPage(records,metadata,{designTarget:'home',selectiveCounts:true});
 assert.equal(existence,0);assert.equal(hidden.context.previewBrowseAvailable,false);assert.equal(hidden.context.previewCounts,undefined);
 metadata.website.design.navigation='top';metadata.website.design.browseLink=true;
 const visible=await websitePreviewPage(records,metadata,{designTarget:'home',selectiveCounts:true});
 assert.equal(existence,1);assert.equal(visible.context.previewBrowseAvailable,true);assert.equal(visible.context.previewCounts,undefined);
});
