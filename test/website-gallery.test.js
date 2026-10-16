import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {assertPublicFiles} from '../src/privacy.js';
import {PUBLIC_GALLERY_SCRIPT} from '../src/publication-gallery.js';
import {newElement} from '../src/web/composition-tree.js';
import {mediaStyle} from '../src/web/media-presentation.js';

test('gallery viewer follows public selection, preserves image links and admits only its reviewed script',async()=>{
 const book=sampleNotebook(),assets=Array.from({length:4},()=>({id:randomUUID(),kind:'image',caption:'Selected image',alt:'Plant detail',transcript:''}));book.website.assets=assets;
 const gallery={...newElement('gallery',randomUUID),assetIds:assets.slice(0,3).map(a=>a.id)};book.website.home.sections=[gallery];
 book.pages.push({id:randomUUID(),title:'PRIVATE_GALLERY',body:'',share:false,sections:[{...newElement('gallery',randomUUID),assetIds:[assets[3].id]}]});
 const scope='home#'+gallery.id;book.website.presentation.media.push({...mediaStyle(book.website,scope,assets[2].id),scope,id:assets[2].id,link:'https://example.org/research'});
 const bytes=await readFile(new URL('../src/preview-assets/image.png',import.meta.url)),mediaFiles=new Map(assets.map(a=>[a.id,{kind:'image',extension:'png',bytes}]));validateNotebook(book);
 const site=buildPublication(book,{mediaFiles}),html=site.files.get('index.html');verifyPublication(site);
 assert.equal((html.match(/data-gallery-image/g)??[]).length,2);assert.ok(html.includes('href="https://example.org/research"'));assert.ok(html.includes('data-position="Image {current} of {total}"'));assert.ok(html.includes('src="public-gallery.js"'));assert.equal(site.files.get('public-gallery.js'),PUBLIC_GALLERY_SCRIPT);assert.ok(!site.files.has('media/'+assets[3].id+'.png'));assert.ok(!html.includes('PRIVATE_GALLERY'));
 assert.throws(()=>assertPublicFiles(new Map([['public-gallery.js',PUBLIC_GALLERY_SCRIPT+'alert(1)']])),{code:'UNSAFE'});
 gallery.viewer=false;validateNotebook(book);const disabled=buildPublication(book,{mediaFiles});assert.ok(!disabled.files.has('public-gallery.js'));assert.ok(!disabled.files.get('index.html').includes('data-gallery-image'));assert.ok(disabled.files.get('index.html').includes('https://example.org/research'));
 gallery.viewer='yes';assert.throws(()=>validateNotebook(book));
});

test('gallery membership is not truncated at one hundred images',()=>{
 const book=sampleNotebook();book.website.assets=Array.from({length:257},()=>({id:randomUUID(),kind:'image',caption:'Image',alt:'Detail',transcript:''}));
 book.website.home.sections=[{...newElement('gallery',randomUUID),assetIds:book.website.assets.map(a=>a.id)}];assert.doesNotThrow(()=>validateNotebook(book));
});
