import {contentBuffer} from '../../src/file-content.js';

// A record's website copy placed on a page the way the website editor places
// it: one source section holding the copy, its scoped stylesheet and its own
// assets, served from the given origin.
export function recordCopyPage(copy,{lang='en'}={}){
 return '<!doctype html><html lang="'+lang+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Record</title><link rel="stylesheet" href="record.css"></head><body><main><section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'">'+copy.html+'</section></main></body></html>\n';
}
export async function routeRecordCopy(context,origin,copy,options){
 const page=recordCopyPage(copy,options),assets=new Map();
 for(const asset of copy.assets)assets.set(asset.path,{type:asset.contentType,body:asset.bytes?Buffer.from(asset.bytes):await contentBuffer(asset.content)});
 await context.route(origin+'/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(name===''||name==='index.html')return route.fulfill({status:200,contentType:'text/html',body:page});
  if(name==='record.css')return route.fulfill({status:200,contentType:'text/css',body:copy.css});
  const asset=assets.get(name);
  return route.fulfill(asset?{status:200,contentType:asset.type,body:asset.body}:{status:404,body:''});
 });
 return origin+'/index.html';
}
