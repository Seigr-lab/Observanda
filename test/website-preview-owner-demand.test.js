import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {newElement} from '../src/web/composition-tree.js';
import {websitePreviewOwnerDemand} from '../src/website-preview-owner-demand.js';
import {publicationOwnerId} from '../src/publication-owner-identities.js';
import {WebsitePreviewSources} from '../src/website-preview-sources.js';

function fixture(){const metadata=sampleNotebook();metadata.website.design.navigation='none';metadata.website.home.sections=[newElement('text')];metadata.website.layouts=[];metadata.website.design.regions={definitions:[],assignments:[]};metadata.website.presentation.media=[];return metadata;}
test('static canvas pages skip disconnected owners while navigation and visible research require them',async()=>{
 const metadata=fixture(),source={workspaceId:randomUUID(),projectIds:[randomUUID()]};
 assert.equal(websitePreviewOwnerDemand(metadata,'home').includes(source),false);
 const local={metadata},reader={use:()=>{throw Error('Static page opened an unrelated owner');}};
 const sources=Array.from({length:1000},()=>({workspaceId:randomUUID()}));
 const combined=await new WebsitePreviewSources(local,reader).initialize(sources,{designTarget:'home'});assert.equal(combined.owners.length,0);
 metadata.website.design.navigation='top';assert.equal(websitePreviewOwnerDemand(metadata,'home').includes(source),true);metadata.website.design.navigation='none';
 const hidden={...newElement('container'),show:false},records={...newElement('records'),parentId:hidden.id};metadata.website.home.sections=[hidden,records];assert.equal(websitePreviewOwnerDemand(metadata,'home').includes(source),false);
 hidden.show=true;assert.equal(websitePreviewOwnerDemand(metadata,'home').includes(source),true);
 metadata.website.home.sections=[{...newElement('link'),href:'entry:'+randomUUID()}];assert.equal(websitePreviewOwnerDemand(metadata,'home').includes(source),true);
});
test('a dedicated notebook page admits its namespace and conservatively retains legacy multi-book owners',()=>{
 const metadata=fixture(),sources=Array.from({length:1000},()=>({workspaceId:randomUUID(),labBookId:randomUUID()})),selected=sources[631],target='notebook:'+publicationOwnerId(metadata.id,selected.workspaceId,'notebook',selected.labBookId),demand=websitePreviewOwnerDemand(metadata,target);
 assert.deepEqual(sources.filter(source=>demand.includes(source)),[selected]);assert.equal(demand.includes({workspaceId:randomUUID()}),true);
 const local=websitePreviewOwnerDemand(metadata,'notebook:'+metadata.notebooks[0].id);assert.equal(local.includes(selected),false);
 assert.equal(websitePreviewOwnerDemand(metadata,'entry:'+randomUUID()).includes(selected),true);
});
