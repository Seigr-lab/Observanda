import {test as base,expect} from '@playwright/test';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export {expect};

// The default journey loads the shipped editor. The opt-in source journey
// serves the same modules individually so contributors can inspect an edit
// before regenerating the shared distribution file.
const root=fileURLToPath(new URL('../../',import.meta.url));
const web=resolve(root,'src/web'),editor=resolve(root,'src/editor');
function inside(directory,file){
 const path=relative(directory,file);
 return path!==''&&path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);
}
const loopback=url=>['localhost','127.0.0.1','[::1]'].includes(url.hostname);
export const test=base.extend({
 sourceEditor:[process.env.OBSERVANDA_TEST_EDITOR_FROM_SOURCE==='1',{option:true}],
 page:async({page,context,sourceEditor},use)=>{
  if(!sourceEditor){await use(page);return;}
  const packages=await realpath(resolve(root,'node_modules'));
  const files=new Map(),routes=new Map(),prefix='/test-document-editor/';
  let served=false;
  function moduleURL(file){
   if(inside(web,file))return '/'+relative(web,file).split(sep).join('/');
   if(!inside(editor,file)&&!inside(packages,file))throw Error('Unexpected editor dependency');
   if(!routes.has(file)){const url=prefix+routes.size;routes.set(file,url);files.set(url,file);}
   return routes.get(file);
  }
  const entry=resolve(editor,'rich-text-editor.js');
  await context.route(url=>loopback(url)&&url.pathname==='/vendor/rich-text-editor.js',route=>
   route.fulfill({contentType:'text/javascript',body:'export * from '+JSON.stringify(moduleURL(entry))+';'}));
  await context.route(url=>loopback(url)&&url.pathname.startsWith(prefix),async route=>{
   const file=files.get(new URL(route.request().url()).pathname);
   if(!file){await route.abort();return;}
   const source=await readFile(file,'utf8');
   // Local editor modules and the locked library distributions use static
   // ES imports. Browser modules under src/web already use application URLs.
   const body=source.replace(/^(\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s*)?)(['"])([^'"]+)\2/gm,(statement,start,quote,specifier)=>{
    const path=specifier.startsWith('.')?resolve(dirname(file),specifier):fileURLToPath(import.meta.resolve(specifier));
    return start+JSON.stringify(moduleURL(path));
   });
   await route.fulfill({contentType:'text/javascript',body});if(file===entry)served=true;
  });
  await use(page);
  expect(served,'the browser loaded the unbundled editor entry point').toBe(true);
 }
});
