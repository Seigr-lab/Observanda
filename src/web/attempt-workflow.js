import messages from './locales/en/attempts.json' with {type:'json'};

// A method selected during preparation must also be discoverable through the
// ordinary research graph. Keep all earlier exact method revisions and do not
// repurpose or remove separately authored relationships.
export function preparationMethodLinks(relations,attempt,{uuid=()=>crypto.randomUUID(),label=messages.usesMethod}={}){
 const links=structuredClone(relations);
 for(const preparation of attempt.preparations)for(const method of preparation.protocols){
  if(links.some(link=>link.role==='uses-method'&&link.target.workspaceId===method.workspaceId&&link.target.id===method.id&&link.target.revision===method.revision))continue;
  const {label:methodLabel,...target}=method;
  links.push({id:uuid(),type:label,role:'uses-method',target,label:methodLabel});
 }
 return links;
}
