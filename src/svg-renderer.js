// Isolated, static SVG preparation. The WASM renderer has no filesystem or network
// imports; only the supplied bytes and bundled fonts are available to the SVG.
// https://github.com/thx/resvg-js/tree/v2.6.2/wasm
import {readFile} from 'node:fs/promises';
import {Resvg,initWasm} from '@resvg/resvg-wasm';
import {SaxesParser} from 'saxes';
const invalid=20,external=21,limit=22,unsupported=23,policyLimit=24;
try {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw limit;chunks.push(chunk);}
  const bytes=Buffer.concat(chunks),utf16=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const xml=new TextDecoder(utf16,{fatal:true}).decode(bytes);
  let depth=0,nodes=0,root=false,style=false;
  const parser=new SaxesParser({xmlns:true});
  // saxes never resolves external entities. Reject custom declarations, so renderer
  // and validator cannot disagree about substituted content. Standard SVG DTDs
  // without entity declarations are tolerated but never loaded.
  parser.on('doctype',value=>{if(value.includes('['))throw external;});
  parser.on('processinginstruction',value=>{if(value.target!=='xml')throw external;});
  const css=value=>{if(/@import|url\(\s*['"]?\s*[^#\s'"]/i.test(value))throw external;};
  parser.on('opentag',node=>{
    if(++depth>256||++nodes>100000)throw limit;
    if(!root){if(node.local!=='svg'||node.uri!=='http://www.w3.org/2000/svg')throw invalid;root=true;}
    if(node.uri==='http://www.w3.org/2000/svg'){
      if(['script','foreignObject','animate','animateMotion','animateTransform','set'].includes(node.local))throw unsupported;
      style=node.local==='style';
      for(const attribute of Object.values(node.attributes)){
        if(/^on/i.test(attribute.local))throw unsupported;
        if(attribute.local==='href'&&!attribute.value.trim().startsWith('#')&&!/^data:image\/(png|jpeg|webp);base64,/i.test(attribute.value))throw external;
        if(attribute.local==='style'||attribute.value.includes('url('))css(attribute.value);
      }
    }
  });
  parser.on('text',value=>{if(style)css(value);});
  parser.on('cdata',value=>{if(style)css(value);});
  parser.on('closetag',()=>{depth--;style=false;});
  parser.write(xml).close();if(!root)throw invalid;
  await initWasm(await readFile(new URL(import.meta.resolve('@resvg/resvg-wasm/index_bg.wasm'))));
  const font=await readFile(new URL('./fonts/atkinson.ttf',import.meta.url));
  const renderer=new Resvg(xml,{font:{fontBuffers:[font],defaultFontFamily:'Atkinson Hyperlegible Next',sansSerifFamily:'Atkinson Hyperlegible Next'}});
  const pixels=renderer.width*renderer.height,maxPixels=Number(process.argv[2]);
  if(!Number.isFinite(pixels)||pixels<1||pixels>64000000)throw limit;
  if(maxPixels&&pixels>maxPixels)throw policyLimit;
  if(renderer.imagesToResolve().length)throw external;
  const rendered=renderer.render();
  process.stdout.write(rendered.asPng());
  rendered.free();renderer.free();
} catch(error) {
  // Never expose parser messages, paths or private source text.
  process.exitCode=[invalid,external,limit,unsupported,policyLimit].includes(error)?error:invalid;
}
