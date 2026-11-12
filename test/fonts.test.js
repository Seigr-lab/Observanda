import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {BUNDLED_FONTS,fontStack} from '../src/web/font-catalogue.js';
import {fontCSS,bundledFonts} from '../src/fonts.js';
import {WorkspaceFonts,inspectUploadedFont} from '../src/workspace-fonts.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {buildPublication,publicProjection,verifyPublication} from '../src/publication.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {woffFixture} from './font-fixture.js';
import {assertPublicFiles} from '../src/privacy.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {WebsiteSites} from '../src/website-sites.js';
const bytes=()=>readFile(new URL('../src/fonts/dm-sans.ttf',import.meta.url));
test('OTF, WOFF and WOFF2 preserve their real font formats and variation axes',async()=>{
 for(const [extension,source] of [['otf',await readFile(new URL('./fixtures/fonts/source-serif.otf',import.meta.url))],['woff2',await readFile(new URL('./fixtures/fonts/dm-sans.woff2',import.meta.url))],['woff',woffFixture(await bytes())]]){
  const info=await inspectUploadedFont(source);assert.equal(info.extension,extension);assert.equal(Object.hasOwn(info.axes,'wght'),extension!=='otf');
  assertPublicFiles(new Map([['fonts/custom-'+info.sha256+'.'+extension,source]]));
 }
 const oversized=woffFixture(await bytes());oversized.writeUInt32BE(0x40000000,16);await assert.rejects(inspectUploadedFont(oversized),{code:'FONT_INVALID'});
});
test('font metadata with private paths cannot enter an exported edition',async()=>{
 const source=await bytes(),from=Buffer.from('DM Sans','utf16le').swap16(),to=Buffer.from('C:\\path','utf16le').swap16();let offset=0,changed=0;
 while((offset=source.indexOf(from,offset))>=0){to.copy(source,offset);offset+=to.length;changed++;}assert.ok(changed);
 const info=await inspectUploadedFont(source);assert.throws(()=>assertPublicFiles(new Map([['fonts/custom-'+info.sha256+'.ttf',source]])),{code:'PRIVACY'});
});
test('bundled editions match original hashes and actual variable axes, weights and styles',async()=>{
 const provenance=JSON.parse(await readFile(new URL('../src/fonts/provenance.json',import.meta.url),'utf8'));
 for(const family of BUNDLED_FONTS){const files=new Map(),css=fontCSS([family.id],files);assert.ok(css.includes(family.family));assert.ok(files.has('fonts/'+family.license));assert.equal(createHash('sha256').update(files.get('fonts/'+family.license)).digest('hex'),provenance.find(p=>p.file===family.license).sha256);for(const face of family.faces){const source=files.get('fonts/'+face.file),info=await inspectUploadedFont(source);assert.equal(createHash('sha256').update(source).digest('hex'),provenance.find(p=>p.file===face.file).sha256);assert.deepEqual(info.axes,face.axes);assert.deepEqual(info.weight,face.weight);assert.equal(info.style,face.style);}}
 assert.equal(BUNDLED_FONTS.length,15);assert.deepEqual(BUNDLED_FONTS.find(f=>f.id==='aref-ruqaa').faces.map(face=>face.weight),[[400],[700]]);assert.ok(BUNDLED_FONTS.some(f=>f.id==='aref-ruqaa-ink'));assert.deepEqual(Object.keys(BUNDLED_FONTS.find(f=>f.id==='dm-sans').faces[0].axes),['opsz','wght']);
 assert.deepEqual(BUNDLED_FONTS.find(f=>f.id==='poiret-one').faces[0].weight,[400]);
 const scheherazade=BUNDLED_FONTS.find(f=>f.id==='scheherazade-new');assert.equal(scheherazade.family,'Scheherazade New');assert.equal(scheherazade.license,'scheherazade-new-OFL.txt');
 assert.deepEqual(scheherazade.faces.map(({file,style,weight,axes})=>({file,style,weight,axes})),[['scheherazade-new.ttf',400],['scheherazade-new-1.ttf',500],['scheherazade-new-2.ttf',600],['scheherazade-new-3.ttf',700]].map(([file,weight])=>({file,style:'normal',weight:[weight],axes:{}})));
 assert.deepEqual(Object.fromEntries(provenance.filter(p=>p.file.startsWith('scheherazade-new')).map(p=>[p.file,[p.sha256,p.source.split('/').at(-1)]])),{'scheherazade-new.ttf':['794bac8dc9e83d1d620bc471ea694f5f31d0965ce8006490a79dfc51a2d283b3','ScheherazadeNew-Regular.ttf'],'scheherazade-new-1.ttf':['060b801307ec55d996d635578fffba0d95169f63e1d0f6061402185eaf4fa6af','ScheherazadeNew-Medium.ttf'],'scheherazade-new-2.ttf':['155056d27ea5a34ab739170abeff8d45b44a494e39be329f0a4d1e6cbd173390','ScheherazadeNew-SemiBold.ttf'],'scheherazade-new-3.ttf':['91363517a63dbc7448b5814226d33d845b26b32a461cd159ea0b3f23c7effd2d','ScheherazadeNew-Bold.ttf'],'scheherazade-new-OFL.txt':['5b9fd21ce2377fc542debebd9edfe1c48f2d3525e78a2a8abdba4a0ec3280163','OFL.txt']});
 assert.equal(fontStack('url(https://remote.example/font)'),undefined);
});
test('custom variable fonts survive encrypted backup; only publicly used font bytes are exported',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-fonts-')),root=path.join(directory,'workspace'),access=await createAccess('','Synthetic font test password'),vault=takeCreatedVault(access),book=upgradeNotebook(sampleNotebook());
 t.after(async()=>{await clearVault(vault);await rm(directory,{recursive:true,force:true});});await initializeLocation(root,book,access,vault);const ws=new Workspace(root,vault),fonts=new WorkspaceFonts(ws),original=await bytes();
 const added=await fonts.import(original);assert.equal(added.embed,false);assert.equal((await fonts.import(original)).id,added.id);assert.equal((await fonts.list()).length,1);assert.deepEqual((await fonts.get(added.id)).bytes,original);
 book.appearance.font=added.id;book.appearance.headingFont='dm-sans';book.appearance.fontAxes={wght:475,opsz:18};validateNotebook(book);
 assert.throws(()=>buildPublication(book,{fontFiles:new Map([[added.id,{...added,bytes:original}]])}),{code:'FONT_EMBED'});
 await fonts.update(added.id,{embed:true,hidden:false});const files=await fonts.files(publicProjection(book)),candidate=buildPublication(book,{fontFiles:files});verifyPublication(candidate);
 const name='fonts/'+added.faces[0].file;assert.deepEqual(candidate.files.get(name),original);assert.ok(candidate.files.get('styles.css').includes('--reading-weight:475'));assert.ok(candidate.files.get('styles.css').includes('"opsz" 18'));
 // Appearance is a website document field: creation already moved it out of
 // the research metadata, so the author saves it through the website owner.
 const sites=new WebsiteSites(ws),site=await sites.read(null);await sites.save(null,{workspaceId:book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{appearance:{...site.book.appearance,font:added.id,headingFont:'dm-sans',fontAxes:{wght:475,opsz:18}}},projects:[],changes:[],removed:[]});
 const backup=await copyWorkspace(await copyPlan(root,path.join(directory,'restored'),{vault}),{vault}),restored=new WorkspaceFonts(new Workspace(backup,vault));assert.deepEqual((await restored.get(added.id)).bytes,original);assert.deepEqual((await new WebsiteSites(new Workspace(backup,vault)).read(null)).book.appearance.fontAxes,{wght:475,opsz:18});
 await fonts.update(added.id,{embed:true,hidden:true});assert.deepEqual((await fonts.get(added.id)).bytes,original);
 book.appearance.font='atkinson';book.appearance.fontAxes={};book.entries.find(e=>!e.share).body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Private font specimen',marks:[{type:'font_family',attrs:{font:added.id}}]}]}]};
 const publicFonts=await fonts.files(publicProjection(book));assert.equal(publicFonts.size,0);assert.ok(!buildPublication(book,{fontFiles:publicFonts}).files.has(name));
 const modified=new Map(candidate.files);modified.set(name,Buffer.concat([original,Buffer.from('private addition')]));assert.throws(()=>verifyPublication({...candidate,files:modified}));
});
test('invalid and cancelled uploads cannot create library entries; CSS identities cannot inject URLs',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-font-errors-'));t.after(()=>rm(directory,{recursive:true,force:true}));const ws=new Workspace(directory);await ws.create(sampleNotebook());const fonts=new WorkspaceFonts(ws);
 await assert.rejects(fonts.import(Buffer.from('<script>not a font</script>')),{code:'FONT_INVALID'});
 const invalid=Buffer.from(await bytes());invalid.writeUInt32BE(0xffffffff,20);await assert.rejects(fonts.import(invalid),{code:'FONT_INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(fonts.import(await bytes(),{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(await fonts.list(),[]);
 const b=upgradeNotebook(sampleNotebook());b.appearance.headingFont='custom-";src:url(https://bad)';assert.throws(()=>validateNotebook(b));assert.equal(fontStack('remote-url'),undefined);
});
