import {reconcileWebsiteMembership} from '../src/website-membership.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';

test('website presentation retains independent source destinations without adopting research metadata',()=>{
 const book=upgradeNotebook(sampleNotebook()),source=randomUUID(),project=randomUUID(),notebook=randomUUID(),record=randomUUID();
 const before=structuredClone({projects:book.projects,notebooks:book.notebooks,entries:book.entries});
 book.website.researchSources=[{workspaceId:source,projectIds:[],selection:{defaultShare:false,includeProjects:[],records:[]}}];
 book.website.layouts.push(defaultPageLayout('entry:'+record));book.website.layouts.push(defaultPageLayout('notebook:'+notebook));
 book.website.navigation.push({target:'project:'+project,label:'Selected research',show:true});book.branding.push({target:'notebook:'+notebook,logos:[]});
 assert.doesNotThrow(()=>validateNotebook(book));
 assert.deepEqual({projects:book.projects,notebooks:book.notebooks,entries:book.entries},before);
 book.website.researchSources=[];assert.doesNotThrow(()=>validateNotebook(book));
 delete book.website.researchSources;assert.throws(()=>validateNotebook(book),{code:'INVALID'});
 book.website.researchSources=[];
 for(const target of ['page:'+randomUUID(),'entry:not-an-id','file:private','project:'+project+':extra']){
  const bad=structuredClone(book);bad.website.layouts[0].target=target;
  assert.throws(()=>validateNotebook(bad),{code:'INVALID'});
 }
 book.website.navigation[0].target='entry:'+record;assert.throws(()=>validateNotebook(book),{code:'INVALID'});
});

test('local reconciliation preserves independent presentation targets and removes known local deletions',async()=>{
 const metadata=createHost(),previous=structuredClone(metadata),deleted=randomUUID(),foreign=randomUUID(),project=randomUUID();
 previous.projects.push({id:project,title:'Removed local project',description:'',share:false,logoId:null});
 const document=websiteDocument(metadata);document.website.researchSources=[];document.website.layouts=[defaultPageLayout('entry:'+deleted),defaultPageLayout('entry:'+foreign),defaultPageLayout('project:'+project)];
 metadata.websites=[{id:randomUUID(),name:'Independent website',projectId:null,document,projects:[],selection:{defaultShare:false,includeProjects:[],records:[]}}];
 await reconcileWebsiteMembership(metadata,async()=>null,{previous,removed:[deleted]});
 assert.deepEqual(metadata.websites[0].document.website.layouts.map(layout=>layout.target),['entry:'+foreign]);
});
function createHost(){const book=upgradeNotebook(sampleNotebook());return {...book,projects:[],notebooks:[],entries:[],branding:[],website:{...book.website,layouts:[],navigation:[]}};}
