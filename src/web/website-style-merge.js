import {literal,mergeOrder} from './website-three-way.js';
import {decodedWebsiteCSS,websiteCSSURLs} from './website-css-urls.js';

// Keep the exact stylesheet bytes, including duplicate declarations and
// comments. CSSOM would silently discard unknown syntax and fallback values.
function blocks(text){
 const items=[];let start=0,brace=-1,depth=0,group=0,quote='',comment=false;
 for(let i=0;i<text.length;i++){
  const c=text[i],next=text[i+1];
  if(comment){if(c==='*'&&next==='/'){i++;comment=false;}continue;}
  if(c==='\\'){i++;continue;}
  if(quote){if(c===quote)quote='';continue;}
  if(c==='/'&&next==='*'){comment=true;i++;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='('||c==='['){group++;continue;}
  if(c===')'||c===']'){if(--group<0)return null;continue;}
  if(group)continue;
  if(c==='{'){if(depth++===0)brace=i;continue;}
  if(c==='}'){
   if(--depth<0)return null;
   if(!depth){items.push({prefix:text.slice(start,brace),body:text.slice(brace+1,i),raw:text.slice(start,i+1)});start=i+1;}
  }else if(c===';'&&!depth){items.push({raw:text.slice(start,i+1)});start=i+1;}
 }
 if(depth||group||quote||comment)return null;
 if(start<text.length)items.push({raw:text.slice(start)});
 return items;
}
const clean=value=>value.replace(/\/\*[\s\S]*?\*\//g,'').trim();
function keyed(text){
 const items=blocks(text),map=new Map();if(!items)return null;
 for(const row of items){
  const rule=row.body!==undefined;
  const tokens=clean(rule?row.prefix:row.raw);
  const colon=tokens.indexOf(':'),property=colon>0?tokens.slice(0,colon).trim():null;
  const key=rule?'rule '+tokens:property&&/^(?:--|[-a-z])[-\w]*$/i.test(property)?'property '+(property.startsWith('--')?property:property.toLowerCase()):'raw '+tokens;
  // Repeated fallbacks and selectors form one cascade unit if changed on
  // both sides. It cannot be split safely without stable occurrence IDs.
  if(map.has(key))return null;
  map.set(key,row);
 }
 return map;
}
export function websiteStyleMerge(base,draft,current,choices,governedURL){
 const protectedCSS=value=>value!==null&&governedURL&&[...websiteCSSURLs(decodedWebsiteCSS(value))].some(governedURL);
 function merge(old,local,remote,address,level){
  if(local===old||local===remote)return literal(remote);
  if(remote===old&&!protectedCSS(local))return literal(local);
  if(old!==null&&local!==null&&remote!==null&&level<64){
   const a=keyed(old),b=keyed(local),c=keyed(remote);
   if(a&&b&&c){
    const keys=new Set([...a.keys(),...b.keys(),...c.keys()]),children=new Map();
    const order=mergeOrder([...a.keys()],[...b.keys()],[...c.keys()],address,'css',address,choices);
    for(const key of keys){
     const x=a.get(key),y=b.get(key),z=c.get(key),name=address+' › '+key.slice(key.indexOf(' ')+1);
     if(x?.body!==undefined&&y?.body!==undefined&&z?.body!==undefined){
      const prefix=choices.choose(name+'/selector','css',name,x.prefix,y.prefix,z.prefix);
      const child=merge(x.body,y.body,z.body,name,level+1);
      children.set(key,()=>prefix()+'{'+child()+'}');
     }else{
      const values=[x?.raw??null,y?.raw??null,z?.raw??null];
      children.set(key,values.some(protectedCSS)?literal(values[2]):choices.choose(name,'css',name,...values));
     }
    }
    return ()=>order().map(k=>children.get(k)()??'').join('');
   }
  }
  if([old,local,remote].some(protectedCSS))return literal(remote);
  return choices.choose(address,'css',address,old,local,remote);
 }
 return merge(base,draft,current,'CSS',0);
}
