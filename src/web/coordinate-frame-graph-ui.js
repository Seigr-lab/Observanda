import {coordinateFrameText} from './coordinate-frame-ui.js';
import {validMaterialReference} from './material-reference.js';
export function coordinateTransformControls(node,{esc,address,text=coordinateFrameText}){
 return address('left',text('graphOperand'),node.left)+'<div data-graph-coordinate-model><input data-value type="hidden" value=""></div>'+(node.model?'<p>'+esc(text('graphPinnedModel',{revision:node.model.revision.slice(0,12)}))+'</p>':'')+'<p>'+esc(text('graphHelp'))+'</p>';
}
export function readCoordinateTransform(root,node,index,model,{text=coordinateFrameText}={}){
 const value=root.querySelector('[data-graph-field="left"]').value,left=value?JSON.parse(value):null;
 if(!left||!Number.isSafeInteger(left.position)||left.position<0||left.position>=index)throw Error(text('graphOperandRequired'));
 if(!validMaterialReference(model)||model.kind!=='analysis')throw Error(text('graphModelRequired'));
 return {id:node.id,kind:'coordinate-transform',left,model};
}
