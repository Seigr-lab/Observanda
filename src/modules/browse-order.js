// Fixed-width UTF-16 keys preserve the module reader's explicit JS string
// order, including prefixes, case folding, separators and surrogate pairs.
const textKey=(value,reverse=false)=>{let key='';for(let i=0;i<value.length;i++)key+=(reverse?65535-value.charCodeAt(i):value.charCodeAt(i)).toString(16).padStart(4,'0');return key;};
export const moduleBrowsePoint=(view,sort)=>textKey(sort==='title'?view.title.toLowerCase():view.createdAt,sort==='created-desc')+'!'+view.id;
