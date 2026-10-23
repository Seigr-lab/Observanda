import {composeFigureText} from './retained-figure-text.js';
import {numeralUsesRadix} from './numeral-context.js';
import messages from './locales/en/measurementTransform.json' with {type:'json'};

// Headers have already been validated. Their long spellings are authenticated
// text references, so preserve selections instead of coercing them to strings.
export function retainedProjectionLines(figure,{axisName,selection}){
 return ['x','y'].filter(axis=>figure.projection?.[axis]).map(axis=>{
  const transform=figure.projection[axis],parts=[];
  for(const token of messages.formula.split(/(\{axis\}|\{origin\}|\{scale\})/)){
   if(token==='{axis}'){parts.push({value:axisName(axis)});continue;}
   if(token==='{origin}'||token==='{scale}'){
    const kind=token.slice(1,-1),quantity=transform[kind],radix=numeralUsesRadix(quantity.representation);
    if(radix)parts.push({value:quantity.radix+'#('});
    parts.push({value:quantity.spelling,selection:selection('projection.'+axis+'.'+kind+'.spelling')});
    if(radix)parts.push({value:')'});
   }else parts.push({value:token});
  }
  return composeFigureText(parts);
 });
}
