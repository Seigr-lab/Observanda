import './i18n/catalogues/calculatorResults.js';
import {validCalculatorRecipe,isCalculatorRecipe,validCalculatorResult} from './calculator-result-model.js';
import {t} from './i18n/index.js';
export const calculatorResultText=(key,values)=>t('calculatorResults',key,values);
export function calculatorRecipeView(content,esc,{button,readOnly=false}={}){
 if(!isCalculatorRecipe(content)||!validCalculatorRecipe(content.recipe))return '';
 const recipe=content.recipe,tr=calculatorResultText;
 return '<section data-calculator-recipe><h3>'+esc(tr('recipe'))+'</h3>'+(recipe.version===3?'<p><strong>'+esc(tr('approximate'))+'</strong></p><p>'+esc(tr('scopeApproximate'))+'</p>':'')+'<p>'+esc(tr('selected',{number:recipe.expressionIndex+1}))+'</p><dl><dt>'+esc(tr('expression'))+'</dt><dd><pre>'+esc(recipe.expression)+'</pre></dd><dt>'+esc(tr('engine'))+'</dt><dd>'+recipe.engine+' / '+esc(recipe.angle)+'</dd><dt>'+esc(tr('library'))+'</dt><dd>'+esc(recipe.library.name+' '+recipe.library.version)+'</dd><dt>'+esc(tr('source'))+'</dt><dd class="material-hash">'+esc(recipe.source.workspaceId+' / '+recipe.source.id+' / '+recipe.source.revision)+'</dd>'+(recipe.structuredEngine?'<dt>'+esc(tr('structuredEngine'))+'</dt><dd>'+esc(recipe.structuredEngine.name+' / '+recipe.structuredEngine.version)+'</dd>':'')+'</dl>'+(recipe.policy?'<details><summary>'+esc(tr('policy'))+'</summary><pre>'+esc(JSON.stringify(recipe.policy,null,2))+'</pre></details>':'')+'<p>'+esc(tr('repeatHelp'))+'</p>'+(!readOnly&&button?button(esc(tr('resume')),'calculator-resume'):'')+'</section>';
}
export function calculatorResultActions(content,{esc,button,readOnly=false}){
 if(!validCalculatorResult(content.calculatorResult))return '';
 return button(esc(calculatorResultText('recipe')),'reference','data-ref="'+esc(JSON.stringify(content.calculatorResult.recipe))+'"')+(readOnly?'':button(esc(calculatorResultText('repeat')),'calculator-repeat'));
}
