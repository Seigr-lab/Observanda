import {create} from 'fontkit';
import {createHash} from 'node:crypto';
export const MAX_FONT_BYTES=8*1024*1024;
const MAX_EXPANDED=32*1024*1024;
export function fontContainer(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<64||bytes.length>MAX_FONT_BYTES)throw Error('Invalid font size');
 const signature=bytes.toString('ascii',0,4),format=signature==='wOFF'?'woff':signature==='wOF2'?'woff2':signature==='OTTO'?'otf':bytes.readUInt32BE(0)===0x10000?'ttf':null;
 if(!format)throw Error('Unsupported font container');
 const web=format==='woff'||format==='woff2',count=bytes.readUInt16BE(web?12:4);
 if(!count||count>256)throw Error('Invalid table count');
 if(web&&(bytes.readUInt32BE(8)!==bytes.length||bytes.readUInt32BE(16)>MAX_EXPANDED||bytes.readUInt32BE(16)<12+count*16))throw Error('Invalid expanded font size');
 if(!web){
  if(12+count*16>bytes.length)throw Error('Invalid font directory');
  const ranges=[],tags=new Set();for(let i=0;i<count;i++){const p=12+i*16,tag=bytes.toString('ascii',p,p+4),start=bytes.readUInt32BE(p+8),length=bytes.readUInt32BE(p+12);if(tags.has(tag)||start<12+count*16||start+length>bytes.length)throw Error('Invalid font table');tags.add(tag);if(length)ranges.push([start,start+length]);}
  ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((r,i)=>i&&r[0]<ranges[i-1][1]))throw Error('Overlapping font tables');
 }
 return format;
}
export function inspectFont(bytes){
 const extension=fontContainer(bytes),font=create(bytes);
 const tables=Object.values(font.directory.tables);let expanded=0;
 for(const table of tables){if(!Number.isInteger(table.length)||table.length<0)throw Error('Invalid table');expanded+=Math.max(table.length,table.transformLength??0);if(expanded>MAX_EXPANDED)throw Error('Invalid expanded size');if(extension==='woff'&&(table.offset<44+tables.length*20||table.compLength>table.length||table.offset+table.compLength>bytes.length))throw Error('Invalid compressed table');}
 const flavor=(extension==='woff'||extension==='woff2')?bytes.toString('ascii',4,8):bytes.toString('ascii',0,4),tableNames=font.directory.tables;
 if(!tableNames.head||!tableNames.name||!tableNames.cmap||!tableNames.maxp||(flavor==='OTTO'?!tableNames['CFF ']&&!tableNames.CFF2:!tableNames.glyf||!tableNames.loca))throw Error('Missing required font tables');
 const axes=font.variationAxes??{};
 if(!font.familyName||font.familyName.length>160||!font.numGlyphs||!font.unitsPerEm||Object.keys(axes).length>16)throw Error('Invalid font metrics');
 for(const [tag,a] of Object.entries(axes))if(!/^[A-Za-z][A-Za-z0-9]{3}$/.test(tag)||![a.min,a.default,a.max].every(Number.isFinite)||a.min< -32768||a.max>32767||a.min>a.default||a.default>a.max)throw Error('Invalid variable axis');
 const weight=axes.wght?[axes.wght.min,axes.wght.max]:[font['OS/2']?.usWeightClass??400];if(weight.some(w=>w<1||w>1000))throw Error('Invalid font weight');
 if(!font.characterSet.length)throw Error('Missing character mapping');
 const flags=font['OS/2']?.fsType??{};
 return {label:(font.fullName||font.familyName).slice(0,160),extension,style:font.italicAngle?'italic':'normal',weight,axes,restricted:!!(flags.noEmbedding||flags.bitmapOnly),metadata:JSON.stringify(font.name.records),extraMetadata:!!(font.directory.privLength||font.directory.metaLength||font.directory.tables.meta||font.directory.tables['SVG ']),sha256:createHash('sha256').update(bytes).digest('hex')};
}
