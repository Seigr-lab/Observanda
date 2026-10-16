import {legacyRecords} from './legacy-records.js';
import {upgradeRecord} from '../src/web/record-model.js';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection} from '../src/publication.js';
const image=()=>({id:randomUUID(),kind:'image',caption:'A research image',alt:'A leaf',transcript:'',share:true});
test('format 10 migration preserves old excluded pages and original research without mutating source',()=>{
 const b=legacyRecords(sampleNotebook());b.formatVersion=10;delete b.website.presentation;delete b.website.palette;b.pages.push({id:randomUUID(),title:'Excluded page',body:'Private notes',share:false,sections:[]});const raw=JSON.stringify(b),next=upgradeNotebook(b);assert.equal(JSON.stringify(b),raw);assert.deepEqual(next.entries,b.entries.map(upgradeRecord));assert.equal(next.pages[0].share,false);assert.deepEqual(next.website.presentation,{media:[],covers:[]});
});
test('only approved images become record covers; per-use presentation leaves originals unchanged',()=>{
 const b=sampleNotebook(),e=b.entries[0],a=image(),privateImage=image();privateImage.share=false;e.attachments=[privateImage,a];const raw=JSON.stringify(e);
 b.website.presentation.media.push({scope:'cover:'+e.id,id:a.id,width:60,ratio:'wide',fit:'cover',link:'https://example.org/evidence',target:'_blank',alt:'Public description'});
 const files=new Map([[a.id,{kind:'image',extension:'png',bytes:readFileSync('src/preview-assets/image.png')}]]),out=buildPublication(b,{mediaFiles:files});
 assert.match(out.files.get('index.html'),new RegExp('data-media-id="'+a.id+'"'));assert.ok(!out.files.get('index.html').includes(privateImage.id));assert.match(out.files.get('index.html'),/Public description/);assert.match(out.files.get('styles.css'),/aspect-ratio:16\/9/);assert.match(out.files.get('index.html'),/href="https:\/\/example.org\/evidence" target="_blank" rel="noopener noreferrer"/);assert.equal(JSON.stringify(e),raw);
 b.website.presentation.covers=[{entryId:e.id,attachmentId:null}];assert.ok(!buildPublication(b,{mediaFiles:files}).files.get('index.html').includes('data-media-id="'+a.id+'"'));
 for(const value of [0,101,NaN]){b.website.presentation.media[0].width=value;assert.throws(()=>validateNotebook(b));}b.website.presentation.media[0].width=60;b.website.presentation.media[0].link='javascript:alert(1)';assert.throws(()=>validateNotebook(b));
});


test('saved layouts and duplicates keep independent image settings and excluded uses never enter the public projection',async()=>{
 const {copySectionPresentation,clearSectionPresentation}=await import('../src/web/media-presentation.js');
 const b=sampleNotebook(),asset={id:randomUUID(),kind:'image',caption:'Shared image',alt:'A leaf',transcript:''},section={id:randomUUID(),kind:'asset',assetId:asset.id,title:'',show:true};b.website.assets=[asset];b.website.home.sections=[section];
 b.website.presentation.media=[{scope:'home#'+section.id,id:asset.id,width:65,ratio:'wide',fit:'cover',link:'https://example.org/leaf',target:'_blank'}];
 const template={id:randomUUID(),name:'Image layout',sections:structuredClone([section])};b.website.templates=[template];copySectionPresentation(b.website,'home',[section],'template:'+template.id,template.sections);
 b.website.presentation.media[0].width=80;const page={id:randomUUID(),title:'Article',body:'',share:true,sections:[{...section,id:randomUUID()}]};b.pages=[page];copySectionPresentation(b.website,'template:'+template.id,template.sections,'page:'+page.id,page.sections);
 assert.equal(b.website.presentation.media.find(m=>m.scope==='page:'+page.id+'#'+page.sections[0].id).width,65);
 const duplicate={...section,id:randomUUID()};copySectionPresentation(b.website,'home',[section],'home',[duplicate]);b.website.home.sections.push(duplicate);assert.equal(b.website.presentation.media.find(m=>m.scope==='home#'+duplicate.id).width,80);
 validateNotebook(b);page.share=false;const publicMedia=publicProjection(b).website.presentation.media;assert.equal(publicMedia.length,2);assert.ok(publicMedia.every(m=>m.scope.startsWith('home#')));
 clearSectionPresentation(b.website,'home',[duplicate]);b.website.home.sections.pop();assert.equal(publicProjection(b).website.presentation.media.length,1);assert.equal(b.website.presentation.media.filter(m=>m.scope.startsWith('template:')).length,1);
});
