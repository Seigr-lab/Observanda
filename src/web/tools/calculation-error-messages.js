// Interpret known engine diagnostics only at the presentation boundary. Raw
// worker errors, saved calculations, code identifiers and numeric tokens stay
// unchanged; an unfamiliar library diagnostic remains available verbatim.
import messages from '../locales/en/calculator.json' with {type:'json'};
const policyKeys={CALCULATION_POLICY_LEGACY:'policyLegacyError',CALCULATION_POLICY_INVALID:'invalidPolicy',CALCULATION_LIBRARY_UNAVAILABLE:'policyLibraryError',CALCULATION_REAL_RESULT:'policyRealError',CALCULATION_STRUCTURED_SHAPE:'structuredShapeError',CALCULATION_STRUCTURED_UNSUPPORTED:'structuredUnsupportedError',CALCULATION_STRUCTURED_RESOURCE:'structuredResourceError',CALCULATION_STRUCTURED_ZERO_DIVISOR:'structuredZeroDivisorError'};
const literals=new Map(Object.entries(messages).filter(([key,value])=>key.startsWith('mathError')&&typeof value==='string'&&!/\{[a-zA-Z]\w*\}/.test(value)).map(([key,value])=>[value,key]));
literals.set('Number of decimals in function round must be an integer','mathErrorRounding');
const matchers=[
 [/^Function is not available: (.+)$/s,'mathErrorFunction',['name']],
 [/^Operator is not available: (.+)$/s,'mathErrorOperator',['operator']],
 [/^Unknown value: (.+)$/s,'mathErrorUnknownValue',['name']],
 [/^Digit (.) is not valid in base (\d+)$/s,'mathErrorDigitBase',['digit','base']],
 [/^Circular reference at ([A-Z]+[0-9]+)$/,'mathErrorCircular',['cell']],
 [/^Invalid cell (.+)$/s,'mathErrorCell',['cell']],
 [/^Cell (.+) is outside the sheet\.$/s,'mathErrorOutsideSheet',['cell']],
 [/^Cell (.+) is not numeric\.$/s,'mathErrorCellNumeric',['cell']],
 [/^Unexpected number of arguments for (.+)\.$/s,'mathErrorArguments',['name']],
 [/^Units do not match \((.+) != (.+)\)$/s,'mathErrorUnitPair',['left','right']],
 [/^Unit in function \w+ is no angle$/,'mathErrorAngle',[]],
 [/^Digit expected, got "(.*)"$/s,'mathErrorSyntaxDigit',['token']],
 [/^Syntax error in part "(.*)"$/s,'mathErrorSyntaxPart',['token']],
 [/^Unexpected part "(.*)"$/s,'mathErrorSyntaxUnexpectedPart',['token']],
 [/^Unexpected operator (.+)$/s,'mathErrorSyntaxOperator',['operator']],
 [/^Column dimensions mismatch \((\d+) !== (\d+)\)$/,'mathErrorSyntaxColumns',['actual','expected']],
 [/^Property name expected after (.+)$/s,'mathErrorSyntaxProperty',['token']],
 [/^Invalid unicode character (.+)$/s,'mathErrorSyntaxUnicode',['token']],
 [/^Bad escape character (.+)$/s,'mathErrorSyntaxEscape',['token']],
 [/^End of string (.+) expected$/s,'mathErrorSyntaxString',['token']]
];
const typedMessage=message=>{
 let match=/^Too few arguments in function (\w+) \(expected: (.+), index: (\d+)\)$/.exec(message);
 if(match)return {key:'mathErrorTooFewArguments',parameters:{name:match[1],expected:match[2].split(' or '),position:Number(match[3])+1}};
 match=/^Too many arguments in function (\w+) \(expected: (\d+), actual: (\d+)\)$/.exec(message);
 if(match)return {key:'mathErrorTooManyArguments',parameters:{name:match[1],expected:match[2],actual:match[3]}};
 match=/^Unexpected type of argument in function (\w+) \(expected: (.+), actual: (.+), index: (\d+)\)$/.exec(message);
 return match?{key:'mathErrorArgumentType',parameters:{name:match[1],expected:match[2].split(' or '),actual:match[3].split(' or '),position:Number(match[4])+1}}:null;
};
export function calculationErrorMessage(value){
 const code=value?.errorCode;
 if(Object.hasOwn(policyKeys,code??''))return {key:policyKeys[code],parameters:{}};
 if(typeof value?.error!=='string')return null;
 const location=/^(.*) \(char (\d+)\)$/s.exec(value.error),message=location?location[1]:value.error,character=location?.[2];
 if(literals.has(message))return {key:literals.get(message),parameters:{},character};
 for(const [pattern,key,names] of matchers){const matched=pattern.exec(message);if(matched)return {key,parameters:Object.fromEntries(names.map((name,i)=>[name,matched[i+1]])),character};}
 const typed=typedMessage(message);return typed?{...typed,character}:null;
}
