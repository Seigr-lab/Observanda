import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import configuration from '../electron-builder.config.js';
import {packagerDependency,packagerInternal} from './packager-fixture.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-packager-contract-'));
 t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('observanda-packager-contract-'));await rm(root,{recursive:true,force:true});});return root;
}

test('the packager accepts the canonical configuration and preserves signing and runtime protections',async()=>{
 const {validateConfiguration}=await packagerDependency('app-builder-lib/internal');await validateConfiguration(configuration,{isEnabled:false});
 assert.equal(configuration.forceCodeSigning,true);assert.equal(configuration.nativeModules.npmRebuild,false);assert.equal(configuration.mac.sign.hardenedRuntime,true);
 assert.equal(configuration.asar,true);assert.equal(configuration.electronFuses.onlyLoadAppFromAsar,true);assert.equal(configuration.electronFuses.enableEmbeddedAsarIntegrityValidation,true);
 assert.equal(configuration.electronFuses.runAsNode,false);assert.equal(configuration.publish,null);
});

test('builder matching preserves nested includes, exclusions, re-includes, dotfiles and resource filters',async t=>{
 const root=await fixture(t),{FileMatcher}=await packagerDependency('app-builder-lib/internal');
 const filter=new FileMatcher(root,path.join(root,'out'),value=>value,['**/*','!**/*.map','!private/**','private/public.json']).createFilter();
 const file={isDirectory:()=>false},directory={isDirectory:()=>true};
 for(const name of ['main.js','nested/data.json','.hidden','private/public.json'])assert.equal(filter(path.join(root,name),file),true,name);
 for(const name of ['nested/main.js.map','private/secret.json'])assert.equal(filter(path.join(root,name),file),false,name);
 assert.equal(filter(path.join(root,'nested'),directory),true);
 const resources=new FileMatcher(root,path.join(root,'out'),value=>value,['**/*','!**/.package-lock.json']).createFilter();
 assert.equal(resources(path.join(root,'service/node_modules/.package-lock.json'),file),false);assert.equal(resources(path.join(root,'service/node_modules/pg/package.json'),file),true);
});

test('builder ASAR streams preserve packed and unpacked bytes and file integrity',async t=>{
 const root=await fixture(t),{AsarPackager}=await packagerInternal('asar/asarUtil.js'),asar=await packagerDependency('@electron/asar');
 const contents=new Map([['main.js',Buffer.from('export const answer=42;')],['native.bin',Buffer.from([0,255,1,42])]]),streams=[];
 for(const [name,bytes]of contents){const source=path.join(root,name);await writeFile(source,bytes);streams.push({path:name,type:'file',unpacked:name==='native.bin',stat:await stat(source),streamGenerator:()=>Readable.from([bytes])});}
 const builder=new AsarPackager({}, {resourcePath:root,options:{}});await builder.executeElectronAsar(streams);const archive=path.join(root,'app.asar');
 try{for(const [name,bytes]of contents){assert.deepEqual(asar.extractFile(archive,name),bytes);const info=asar.statFile(archive,name);assert.equal(info.integrity.algorithm,'SHA256');assert.equal(info.integrity.hash,createHash('sha256').update(bytes).digest('hex'));}assert.deepEqual(await readFile(archive+'.unpacked/native.bin'),contents.get('native.bin'));}finally{asar.uncacheAll();}
});

test('ASAR directory packaging retains glob and unpack-directory semantics',async t=>{
 const root=await fixture(t),source=path.join(root,'source'),asar=await packagerDependency('@electron/asar');await mkdir(path.join(source,'native'),{recursive:true});
 await writeFile(path.join(source,'package.json'),'{}');await writeFile(path.join(source,'native/addon.node'),'Synthetic module');await writeFile(path.join(source,'.hidden'),'Retained hidden file');const archive=path.join(root,'directory.asar');
 await asar.createPackageWithOptions(source,archive,{unpackDir:'**/native'});
 try{assert.equal(asar.extractFile(archive,'.hidden').toString(),'Retained hidden file');assert.equal(asar.statFile(archive,'native/addon.node').unpacked,true);assert.equal(await readFile(archive+'.unpacked/native/addon.node','utf8'),'Synthetic module');}finally{asar.uncacheAll();}
});

test('the installer compiles its trusted MSI template and escapes metadata as XML',async()=>{
 const {default:MsiTarget}=await packagerInternal('targets/win/MsiTarget.js');const target=new MsiTarget({config:{},getOptionsForTarget:()=>({}),buildResourcesDir:os.tmpdir()},os.tmpdir());
 const render=await target.projectTemplate.value,xml=render({wixNamespace:'http://schemas.microsoft.com/wix/2006/wi',productName:'A <B> & "C"',upgradeCode:'SYNTHETIC',version:'1.2.3',manufacturer:'Research & Development',compressionLevel:'none',installationDirectoryWixName:'Synthetic',iconPath:null,isRunAfterFinish:false,isAssisted:false,isPerMachine:false,programFilesId:'ProgramFiles64Folder',companyDirectories:[],componentGroupDirectoryAttribute:' Directory="APPLICATIONFOLDER"',isCreateDesktopShortcut:false,isCreateStartMenuShortcut:false,dirs:'<Directory Id="Synthetic"/>',files:'<Component Id="Synthetic"/>'});
 assert.match(xml,/A &lt;B&gt; &amp; &#34;C&#34;/);assert.match(xml,/Research &amp; Development/);assert.ok(xml.includes('<Component Id="Synthetic"/>'));assert.ok(!xml.includes('Name="A <B>'));
});

test('the patched matcher bounds adversarial preprocessing without changing ordinary matches',async()=>{
 const {Minimatch}=await packagerDependency('minimatch');const pattern=Array(30).fill('**/../a/b').join('/'),matcher=new Minimatch(pattern,{optimizationLevel:2,braceExpandMax:64});assert.equal(matcher.set.length,64);
 const ordinary=new Minimatch('**/../a/b/**/../c/d',{optimizationLevel:2});assert.equal(ordinary.match('../a/b/../c/d'),true);assert.equal(ordinary.match('x/a/b/y/c/d'),true);
});

test('packaged metadata cleanup preserves dependency identity and executable fields',async t=>{
 const root=await fixture(t),{createTransformer}=await packagerInternal('fileTransformer.js'),dependency=path.join(root,'node_modules/synthetic/package.json');await mkdir(path.dirname(dependency),{recursive:true});
 const metadata={name:'synthetic',version:'1.0.0',main:'index.js',exports:{'.':'./index.js'},dependencies:{retained:'1.0.0'},devDependencies:{tool:'1.0.0'},scripts:{prepare:'never run'},keywords:['synthetic'],bugs:'https://example.invalid/issues',_private:'omit',dist:{synthetic:true},babel:{synthetic:true},retainedMetadata:{exact:true}};
 await writeFile(dependency,JSON.stringify(metadata));await writeFile(path.join(root,'package.json'),JSON.stringify(metadata));
 const transform=createTransformer(root,configuration,{homepage:'https://example.invalid/retained'},null),dep=JSON.parse(await transform(dependency)),main=JSON.parse(await transform(path.join(root,'package.json')));
 const kept={name:metadata.name,version:metadata.version,main:metadata.main,exports:metadata.exports,dependencies:metadata.dependencies,retainedMetadata:metadata.retainedMetadata};
 assert.deepEqual(dep,{...kept,devDependencies:metadata.devDependencies});assert.deepEqual(main,{...kept,bugs:metadata.bugs,homepage:'https://example.invalid/retained'});
 const payload=path.join(root,'node_modules/synthetic/index.js');await writeFile(payload,'Exact source');assert.equal(await transform(payload),null);assert.equal(await readFile(payload,'utf8'),'Exact source');
});
