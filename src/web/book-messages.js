import messages from './locales/en/book.json' with {type:'json'};
export const bookText=(key,args={})=>(messages[key]??key).replace(/\{(\w+)\}/g,(token,name)=>Object.hasOwn(args,name)?String(args[name]):token);
