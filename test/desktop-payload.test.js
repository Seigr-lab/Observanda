import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,cp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {payloadFiles,verifyDesktopPayload,desktopLocalizationFiles} from '../scripts/desktop-payload.js';
import {githubRuntimeFiles} from '../scripts/github-runtime.js';
import {pdfValidationRuntimeFiles} from '../scripts/pdf-validation-runtime.js';
import {buildBrowser} from '../scripts/browser-build.js';
test('desktop packaging rejects changed, extra or incomplete runtime payloads',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-payload-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const suffix=process.platform==='win32'?'.exe':'';
 for(const file of [...githubRuntimeFiles(),...pdfValidationRuntimeFiles(),...desktopLocalizationFiles(),'service/src/desktop-service.js','service/node_modules/pg/package.json',process.platform==='win32'?'runtime/node.exe':'runtime/bin/node','postgresql/bin/postgres'+suffix,'media/bin/ffmpeg'+suffix,'media/bin/ffprobe'+suffix,'media/LICENSE']){
  await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),'Synthetic payload bytes');
 }
 const manifest={format:1,platform:process.platform,arch:process.arch,files:await payloadFiles(root)};
 await writeFile(path.join(root,'payload.json'),JSON.stringify(manifest));await verifyDesktopPayload(root);
 await writeFile(path.join(root,'media/LICENSE'),'Changed bytes');await assert.rejects(verifyDesktopPayload(root),/changed/);
 await writeFile(path.join(root,'media/LICENSE'),'Synthetic payload bytes');await writeFile(path.join(root,'private-notes.txt'),'Private sentinel');await assert.rejects(verifyDesktopPayload(root),/changed/);await rm(path.join(root,'private-notes.txt'));
 await rm(path.join(root,'media/bin/ffprobe'+suffix));manifest.files=await payloadFiles(root);await writeFile(path.join(root,'payload.json'),JSON.stringify(manifest));await assert.rejects(verifyDesktopPayload(root),/Missing desktop dependency/);
});
test('desktop payload inspection refuses directory links that can include outside files',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-payload-links-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'payload'));await mkdir(path.join(root,'private'));
 await symlink(path.join(root,'private'),path.join(root,'payload','escape'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(payloadFiles(path.join(root,'payload')),/Unsafe payload symlink/);
});

test('packaging refuses a valid but stale payload and mismatched application versions',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-payload-source-')),root=path.join(directory,'payload'),sourceRoot=path.join(directory,'source');t.after(()=>rm(directory,{recursive:true,force:true}));
 const write=async(base,name,value)=>{await mkdir(path.dirname(path.join(base,name)),{recursive:true});await writeFile(path.join(base,name),value);};
 for(const [name,value] of Object.entries({'src/desktop-service.js':'Synthetic service','src/web/locales/en/test.json':'{"label":"Original"}','package.json':'{"version":"0.3.0"}','package-lock.json':'{}','desktop/icon_black.svg':'<svg/>','desktop/icon_white.svg':'<svg/>','desktop/package.json':'{"version":"0.3.0"}'}))await write(sourceRoot,name,value);
 for(const [name,value] of Object.entries({'src/web/index.html':'<head><link rel="stylesheet" href="/app.css"></head><script type="module" src="/app.js"></script>','src/web/app.js':'document.body.dataset.started="yes";','src/web/app.css':'body { color: #123456; }'}))await write(sourceRoot,name,value);
 for(const name of desktopLocalizationFiles())await write(sourceRoot,name.slice('service/'.length),'Synthetic localization bytes');
 await cp(sourceRoot,path.join(root,'service'),{recursive:true});
 const browser=await buildBrowser({root:sourceRoot,out:path.join(root,'service/src/web-build')});
 const suffix=process.platform==='win32'?'.exe':'';
 for(const name of [...githubRuntimeFiles(),...pdfValidationRuntimeFiles(),'service/node_modules/pg/package.json',process.platform==='win32'?'runtime/node.exe':'runtime/bin/node','postgresql/bin/postgres'+suffix,'media/bin/ffmpeg'+suffix,'media/bin/ffprobe'+suffix,'media/LICENSE'])await write(root,name,'Synthetic runtime');
 await write(root,'payload.json',JSON.stringify({format:1,platform:process.platform,arch:process.arch,files:await payloadFiles(root)}));
 await verifyDesktopPayload(root,{sourceRoot});
 const chunk='service/src/web-build/'+browser.manifest.entry,original=await readFile(path.join(root,chunk));
 await write(root,chunk,'document.body.textContent="Substituted";');
 await write(root,'payload.json',JSON.stringify({format:1,platform:process.platform,arch:process.arch,files:await payloadFiles(root)}));
 await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/browser payload is stale/);
 await write(root,chunk,original);await write(root,'payload.json',JSON.stringify({format:1,platform:process.platform,arch:process.arch,files:await payloadFiles(root)}));
 await write(sourceRoot,'desktop/icon_white.svg','<svg><!-- Updated artwork --></svg>');await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/stale/);
 await write(sourceRoot,'desktop/icon_white.svg','<svg/>');
 await write(sourceRoot,'src/web/locales/en/test.json','{"label":"Updated"}');await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/stale/);
 await write(sourceRoot,'src/web/locales/en/test.json','{"label":"Original"}');await write(sourceRoot,'src/new-owner.js','New owner');await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/stale/);
 await rm(path.join(sourceRoot,'src/new-owner.js'));await rm(path.join(sourceRoot,'src/desktop-service.js'));await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/stale/);
 await write(sourceRoot,'src/desktop-service.js','Synthetic service');await write(sourceRoot,'desktop/package.json','{"version":"0.4.0"}');await assert.rejects(verifyDesktopPayload(root,{sourceRoot}),/versions must match/);
});
