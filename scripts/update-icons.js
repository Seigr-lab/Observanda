import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initWasm,Resvg} from '@resvg/resvg-wasm';

const root=fileURLToPath(new URL('..',import.meta.url));
let initialized;
export async function updateDesktopIcons({png=false}={}){
 await (initialized??=(async()=>initWasm(await readFile(path.join(root,'node_modules/@resvg/resvg-wasm/index_bg.wasm'))))());
 const black=await readFile(path.join(root,'desktop/icon_black.svg'),'utf8'),white=await readFile(path.join(root,'desktop/icon_white.svg'),'utf8');
 const render=(size,svg=black,background)=>{
  const renderer=new Resvg(svg,{fitTo:{mode:'width',value:size},...(background?{background}:{})});
  try{
   const result=renderer.render();
   try{if(result.width!==size||result.height!==size)throw Error('The desktop icon must have a square SVG viewBox.');return Buffer.from(result.asPng());}
   finally{result.free();}
  }finally{renderer.free();}
 };
 // Executable and shortcut icons cannot adapt to the desktop wallpaper.
 // Give the black artwork a light backing; window icons follow the OS theme.
 const sizes=[16,20,24,32,40,48,64,96,128,256],images=sizes.map(size=>render(size,black,'#ffffff'));
 const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);
 let offset=header.length;
 for(let i=0;i<images.length;i++){
  const entry=6+16*i;header[entry]=header[entry+1]=sizes[i]===256?0:sizes[i];
  header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
 }
 await writeFile(path.join(root,'desktop/icon.ico'),Buffer.concat([header,...images]));
 if(png){
  await writeFile(path.join(root,'desktop/icon.png'),render(512,black,'#ffffff'));
  await writeFile(path.join(root,'desktop/icon-black.png'),render(512));
  await writeFile(path.join(root,'desktop/icon-white.png'),render(512,white));
 }
 return sizes;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const sizes=await updateDesktopIcons({png:true});console.log('Created desktop icons from icon_black.svg and icon_white.svg: '+sizes.join(', ')+' px.');
}
