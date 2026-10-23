// Shared exact arithmetic limits; browser and native engines use the same checks.
const absolute=n=>n<0n?-n:n;
const bitLength=n=>absolute(n).toString(2).length;
export class ArithmeticBudget {
 constructor({maxBits=65536,maxOperations=50000,maxMilliseconds=2500}={}) {
  if(![maxBits,maxOperations,maxMilliseconds].every(Number.isSafeInteger)||maxBits<64||maxBits>1048576||maxOperations<1||maxOperations>1000000||maxMilliseconds<1||maxMilliseconds>30000)throw Error('Invalid arithmetic resource policy.');
  Object.assign(this,{maxBits,maxOperations,deadline:Date.now()+maxMilliseconds,operations:0});
 }
 step(){if(++this.operations>this.maxOperations||Date.now()>this.deadline)throw Error('Exact arithmetic exceeded the calculation resource budget.');}
 size(...values){this.step();if(values.some(v=>bitLength(v)>this.maxBits))throw Error('Exact result exceeds the calculation resource budget.');}
 product(a,b){this.step();if(a!==0n&&b!==0n&&bitLength(a)+bitLength(b)-1>this.maxBits)throw Error('Exact intermediate exceeds the calculation resource budget.');return a*b;}
 power(a,n){this.step();if(n<0n||n>BigInt(this.maxBits)||absolute(a)>1n&&BigInt(bitLength(a)-1)*n>BigInt(this.maxBits))throw Error('Exact power exceeds the calculation resource budget.');const r=a**n;this.size(r);return r;}
}
