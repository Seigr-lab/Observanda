// A fragment stays in the visitor's browser. Only the file portion is used
// for a saved-site lookup, and keeps the ordinary local path restrictions.
export function websiteReferencePath(value){
 const hash=value.indexOf('#'),path=hash<0?value:value.slice(0,hash);
 if(!value||path.startsWith('/')||/[\\\u0000-\u0020%:?]/.test(path))return null;
 if(hash>=0){
  try{if(/[\u0000-\u001f\u007f]/.test(decodeURIComponent(value.slice(hash+1))))return null;}
  catch{return null;}
 }
 return path;
}
