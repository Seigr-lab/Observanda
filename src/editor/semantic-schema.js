import {validSemanticRole} from '../web/semantic-text-styles.js';

export const optionalSemanticRole={default:null};
export function readSemanticRole(element,node,level){
 const role=element.dataset.obsRole;
 return validSemanticRole(node,role,level)?role:null;
}
export function semanticDomAttributes(node,other={}){
 const role=node.attrs.semanticRole;if(!validSemanticRole(node.type.name,role,node.attrs.level))return other;
 return {...other,'data-obs-role':role,class:[other.class,'rt-semantic-v1-'+role].filter(Boolean).join(' '),...(role==='note'?{role:'note'}:{})};
}
