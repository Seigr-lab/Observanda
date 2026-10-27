import {build} from 'esbuild';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Called by packaging, or against a disposable output directory for source
// qualification. Only source application assets enter the manifest.
export async function buildBrowser({root=fileURLToPath(new URL('..',import.meta.url)),out}){
 if(!out||!path.isAbsolute(out))throw Error('An absolute browser output directory is required.');
 await mkdir(out,{recursive:true});if((await readdir(out)).length)throw Error('Browser output directory must be empty.');
 const web=path.join(root,'src/web'),html=await readFile(path.join(web,'index.html'),'utf8'),styleLinks=/<link rel="stylesheet" href="\/([^"]+)"(?: data-document-styles)?>/g,styles=[...html.matchAll(styleLinks)].map(match=>match[1]).filter(name=>name!=='bundled-fonts.css');
 const common={absWorkingDir:root,bundle:true,minify:true,format:'esm',target:['chrome130','firefox128'],write:false,metafile:true,logLevel:'silent',outdir:path.join(out,'assets'),entryNames:'[name]-[hash]',chunkNames:'chunk-[hash]',assetNames:'resource-[hash]',legalComments:'inline'};
 const javascript=await build({...common,entryPoints:[path.join(web,'app.js')],splitting:true,platform:'browser'});
 const css=await build({...common,stdin:{contents:styles.map(name=>'@import "./'+name+'";').join('\n'),resolveDir:web,sourcefile:'styles.css',loader:'css'},entryNames:'styles-[hash]',external:['/fonts/*']});
 const files=[];for(const output of [...javascript.outputFiles,...css.outputFiles]){
  const relative=path.relative(out,output.path).split(path.sep).join('/');if(!/^assets\/[A-Za-z0-9_-]+-[A-Z0-9]+\.(?:js|css)$/.test(relative))throw Error('Unexpected browser output.');
  await mkdir(path.dirname(output.path),{recursive:true});await writeFile(output.path,output.contents);files.push({path:relative,size:output.contents.length,sha256:createHash('sha256').update(output.contents).digest('hex')});
 }
 const entry=files.find(file=>/^assets\/app-/.test(file.path))?.path,style=files.find(file=>file.path.endsWith('.css'))?.path;if(!entry||!style)throw Error('Incomplete browser output.');
 const outputEntries=Object.entries(javascript.metafile.outputs),visited=new Set();let initialBytes=0;
 function visit(name){if(visited.has(name))return;visited.add(name);const output=javascript.metafile.outputs[name];if(!output)throw Error('Missing browser graph output.');initialBytes+=output.bytes;for(const imported of output.imports)if(!imported.external&&imported.kind==='import-statement')visit(imported.path);}
 const main=outputEntries.find(([,value])=>value.entryPoint===path.relative(root,path.join(web,'app.js')).split(path.sep).join('/'));if(!main)throw Error('Missing browser entry graph.');visit(main[0]);
 const sourceVisited=new Set();function visitSource(name){if(sourceVisited.has(name))return;sourceVisited.add(name);for(const imported of javascript.metafile.inputs[name].imports)if(!imported.external&&imported.kind==='import-statement')visitSource(imported.path);}visitSource(main[1].entryPoint);
 const preload=[...visited].filter(name=>name!==main[0]).map(name=>'<link rel="modulepreload" href="/'+path.relative(out,path.resolve(root,name)).split(path.sep).join('/')+'">').join('\n');
 let replaced=false;const index=html.replace(styleLinks,(match,name)=>{if(name==='bundled-fonts.css')return match;if(replaced)return '';replaced=true;return '<link rel="stylesheet" href="/'+style+'" data-document-styles>';}).replace('src="/app.js"','src="/'+entry+'"').replace('</head>',preload+'\n</head>');
 const bytes=Buffer.from(index);await writeFile(path.join(out,'index.html'),bytes);files.push({path:'index.html',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const manifest={version:1,entry,files:files.sort((a,b)=>a.path.localeCompare(b.path))};await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest));
 return {manifest,initialJavaScriptBytes:initialBytes,initialJavaScriptFiles:visited.size,sourceStaticFiles:sourceVisited.size,initialSources:[...sourceVisited].sort(),javascriptFiles:javascript.outputFiles.length,stylesheetBytes:files.find(file=>file.path===style).size};
}
