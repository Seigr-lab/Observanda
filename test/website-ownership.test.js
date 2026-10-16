import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {websiteBook,websiteDocument,validWebsites} from '../src/web/website-sites-model.js';
import {projectSourcePublicationOwner} from '../src/project-source-publication-owner.js';
import {ProjectSourceAuthority} from '../src/project-source-authority.js';

function site(metadata,projectId=null){return {id:id(),name:'Independent website',projectId,document:websiteDocument(metadata),projects:metadata.projects.map(({id,logoId})=>({id,logoId,share:true})),selection:{defaultShare:false,includeProjects:[],records:[]}};}

test('website scope is independent while earlier scoped documents retain their original selection boundary',()=>{
 const book=sampleNotebook(),other={...book.projects[0],id:id(),title:'Another project'},notebook={...book.notebooks[0],id:id(),projectId:other.id};book.projects.push(other);book.notebooks.push(notebook);
 const independent=site(book);assert.equal(validWebsites([independent],book),true);assert.equal(websiteBook(book,independent).notebooks.length,2);
 const previous={...site(book,book.projects[0].id),projects:[independent.projects[0]]};assert.equal(validWebsites([previous],book),true);assert.deepEqual(websiteBook(book,previous).notebooks,[book.notebooks[0]]);
 const many=Array.from({length:150},()=>site(book));assert.equal(validWebsites(many,book),true);many[1].id=many[0].id;assert.equal(validWebsites(many,book),false);
});

test('independent website files and retained edition addresses never belong to a research project',async()=>{
 const siteId=id(),metadataKey='.observanda/websites/'+siteId+'/publishing.json',inventory={website:async requested=>requested===siteId?{id:siteId,projectId:null,ambiguous:false}:null};
 const owner=projectSourcePublicationOwner({object:async()=>({text:JSON.stringify({websiteId:siteId})})},inventory);
 assert.deepEqual(await owner('metadata:'+metadataKey),{kind:'workspace',selected:false});
 assert.deepEqual(await owner('metadata:.observanda/website-editions/'+'a'.repeat(64)+'.json'),{kind:'workspace',selected:false});
 await assert.rejects(owner('metadata:.observanda/websites/'+id()+'/publishing.json'),{code:'PROJECT_MIGRATION_OWNERSHIP'});
 const saved={id:siteId,projectId:null,ambiguous:false},authority=new ProjectSourceAuthority({db:{get:async()=>({payload:saved})},decode:(_kind,_slot,value)=>value});
 assert.deepEqual(await authority.scope('website',siteId,{websites:[]}),saved);
 await assert.rejects(authority.scope('notebook',siteId,{notebooks:[]}),{code:'CATALOGUE_DAMAGED'});
});
