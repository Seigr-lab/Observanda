// One link contract for buttons, media and rich text. Fragment-only links are
// relative to the current generated page; page references survive URL changes.
export function websiteLink(value){
 if(typeof value!=='string'||!value||/[\s\\]/u.test(value))return null;
 if(/^https:\/\//i.test(value)){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?{external:true,href:value}:null;}catch{return null;}
 }
 const [target,fragment,...extra]=value.split('#');
 if(extra.length||!target&&fragment===undefined||fragment!==undefined&&!/^[a-zA-Z0-9_:.%-]+$/.test(fragment))return null;
 if(fragment!==undefined){try{decodeURIComponent(fragment);}catch{return null;}}
 if(target&&!/^(?:home|(?:project|notebook|entry|page):[a-f0-9-]{36})$/.test(target))return null;
 return {external:false,target,fragment:fragment??null};
}
export const safeWebsiteLink=value=>websiteLink(value)!==null;
export function websiteLinkPath(value,prefix=''){
 const link=websiteLink(value);if(!link)return null;if(link.external)return link.href;
 const suffix=link.fragment===null?'':'#'+link.fragment;if(!link.target)return suffix;
 if(link.target==='home')return prefix+'index.html'+suffix;
 const [kind,id]=link.target.split(':');return prefix+{project:'projects',notebook:'notebooks',entry:'entries',page:'pages'}[kind]+'/'+id+'.html'+suffix;
}
