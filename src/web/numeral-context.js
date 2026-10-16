// Interpretation travels with the value/schema, never a workspace-wide default.
export const NUMBER_REPRESENTATIONS=['decimal','integer','radix','radix-fraction','rational'];
export const numeralUsesRadix=representation=>['radix','radix-fraction'].includes(representation);
export function validNumeralContext(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===3&&value.version===1&&
  NUMBER_REPRESENTATIONS.includes(value.representation)&&Number.isInteger(value.radix)&&
  (numeralUsesRadix(value.representation)?value.radix>=2&&value.radix<=36:value.radix===10);
}
export const resultContext=(value,operation)=>value??{version:1,representation:operation==='count'?'integer':'rational',radix:10};
