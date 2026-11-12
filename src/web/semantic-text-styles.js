// A role names the author's intent. Each output may change the appearance
// while retaining the same role and the same authored heading anchor.
export const semanticRoles=Object.freeze(['body','heading1','heading2','heading3','heading4','heading5','heading6','caption','quotation','code','note']);
export const semanticSurfaces=Object.freeze(['reading','website','pdf']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names)=>object(value)&&Object.keys(value).every(k=>names.includes(k));
const heading=role=>/^heading[1-6]$/.test(role);
export function semanticNode(role){
 if(!semanticRoles.includes(role))return null;
 if(heading(role))return 'heading';
 if(role==='code')return 'code_block';
 if(role==='quotation')return 'blockquote';
 return 'paragraph';
}
export function validSemanticRole(node,role,level){
 return semanticNode(role)===node&&(node!=='heading'||level===Number(role.slice(-1)));
}
function validAppearance(value){
 return keys(value,['size','weight','color','italic'])&&Object.keys(value).length>0
  &&(!Object.hasOwn(value,'size')||Number.isInteger(value.size)&&value.size>=8&&value.size<=96)
  &&(!Object.hasOwn(value,'weight')||[400,500,600,700].includes(value.weight))
  &&(!Object.hasOwn(value,'color')||typeof value.color==='string'&&/^#[a-f0-9]{6}$/.test(value.color))
  &&(!Object.hasOwn(value,'italic')||typeof value.italic==='boolean');
}
export function validSemanticStyles(styles){
 if(!keys(styles,['version','roles'])||styles.version!==1||!keys(styles.roles,semanticRoles))return false;
 return Object.values(styles.roles).every(overrides=>keys(overrides,['default',...semanticSurfaces])&&Object.keys(overrides).length>0&&Object.values(overrides).every(validAppearance));
}
export function semanticAppearance(styles,role,surface='reading'){
 if(!semanticRoles.includes(role)||!semanticSurfaces.includes(surface))return null;
 const override=styles?.roles?.[role];
 const base=role==='note'?{italic:true}:role==='caption'?{weight:500}:{};
 return {...base,...override?.default,...override?.[surface]};
}
// A finite class vocabulary keeps two independently styled fields on the same
// page from overwriting one another and keeps authored data out of CSS syntax.
export function semanticClasses(role,appearance={}){
 if(!semanticRoles.includes(role))return [];
 const classes=['rt-semantic-v1-'+role];
 if(!validAppearance(appearance))return classes;
 if(appearance.size!==undefined)classes.push('rt-semantic-size-'+appearance.size);
 if(appearance.weight!==undefined)classes.push('rt-semantic-weight-'+appearance.weight);
 if(appearance.color!==undefined)classes.push('rt-semantic-color-'+appearance.color.slice(1));
 if(appearance.italic!==undefined)classes.push('rt-semantic-italic-'+Number(appearance.italic));
 return classes;
}
export function semanticStyleRules(role,appearance){
 if(!semanticRoles.includes(role))return [];
 const css=[];
 for(const cls of semanticClasses(role,appearance).slice(1)){
  const declaration=cls.startsWith('rt-semantic-size-')?'font-size:'+appearance.size+'px':cls.startsWith('rt-semantic-weight-')?'font-weight:'+appearance.weight:cls.startsWith('rt-semantic-color-')?'color:'+appearance.color:'font-style:'+(appearance.italic?'italic':'normal');
  css.push('.'+cls+'{'+declaration+'}');
 }
 return css;
}
export function documentHasSemanticStyles(doc){
 if(!doc||typeof doc!=='object')return false;
 if(doc.attrs?.semanticStyles||doc.attrs?.semanticRole)return true;
 return (doc.content??[]).some(documentHasSemanticStyles);
}
// Preserve the authored rank on the node. Nest only beneath heading ranks
// that exist in the output, including its enclosing record or document section.
export function semanticHeadingLevels(doc,sectionLevel=0){
 const levels=new WeakMap(),stack=[];
 function visit(node){
  const role=node.attrs?.semanticRole;
  if(node.type==='heading'&&role&&heading(role)){
   const rank=Number(role.slice(-1));
   while(stack.length&&stack.at(-1)>=rank)stack.pop();
   stack.push(rank);levels.set(node,sectionLevel+stack.length);
  }
  for(const child of node.content??[])visit(child);
 }
 visit(doc);return levels;
}
