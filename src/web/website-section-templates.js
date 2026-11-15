// Ready-made page sections an author adds in one step and then rewrites in place.
// Their look follows the website's own theme variables, with neutral fallbacks.
export const sectionTemplates=['heroSection','featuresSection','ctaSection','quoteSection','stepsSection','contactSection'];

export const sectionCSS=`
/* Observanda ready-made sections */
.ow-hero,.ow-features,.ow-cta,.ow-quote,.ow-steps,.ow-contact{margin:var(--section-space,2.5rem) 0}
.ow-hero{padding:clamp(2.5rem,6vw,5rem) 1.5rem;text-align:center;background:var(--page-surface,#f4f6fa);border:1px solid var(--page-border,#d5dae3);border-radius:var(--corner-radius,12px)}
.ow-hero h2{font-size:clamp(2rem,4vw,3rem);line-height:1.1;margin:0 0 .75rem}
.ow-hero p{max-width:40rem;margin:0 auto 1.4rem;font-size:1.15em}
.ow-features h2,.ow-steps h2,.ow-contact h2{margin:0 0 1.2rem}
.ow-feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:1.25rem}
.ow-feature-grid>section{padding:1.25rem;background:var(--page-surface,#fff);border:1px solid var(--page-border,#d5dae3);border-radius:var(--corner-radius,12px)}
.ow-feature-grid h3{margin:0 0 .4rem}
.ow-feature-grid p{margin:0}
.ow-cta{padding:clamp(1.8rem,4vw,3rem);text-align:center;color:var(--on-accent,#fff);background:var(--accent,#2457d6);border-radius:var(--corner-radius,12px)}
.ow-cta h2{color:inherit;margin:0 0 .5rem}
.ow-cta p{margin:0 0 1.2rem}
.ow-cta .website-button{color:inherit}
.ow-quote blockquote{margin:0;padding:1.5rem 1.75rem;font-size:1.35em;line-height:1.45;border-left:4px solid var(--accent,#2457d6);background:var(--page-surface,#f4f6fa);border-radius:0 var(--corner-radius,12px) var(--corner-radius,12px) 0}
.ow-quote p{margin:.75rem 0 0;color:var(--page-muted,#5b6575)}
.ow-steps ol{display:grid;gap:.9rem;margin:0;padding:0;list-style:none;counter-reset:ow-step}
.ow-steps li{counter-increment:ow-step;display:grid;grid-template-columns:2.4rem 1fr;gap:.9rem;align-items:start}
.ow-steps li::before{content:counter(ow-step);display:grid;place-items:center;width:2.4rem;height:2.4rem;font-weight:700;color:var(--on-accent,#fff);background:var(--accent,#2457d6);border-radius:50%}
.ow-contact dl{display:grid;grid-template-columns:max-content 1fr;gap:.5rem 1.25rem;margin:0}
.ow-contact dt{font-weight:700}
.ow-contact dd{margin:0}
`;

const identity=()=>'ow-section-'+crypto.randomUUID();
export function createSection(doc,type,t){
 const el=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const root=el('section',undefined,{heroSection:'ow-hero',featuresSection:'ow-features',ctaSection:'ow-cta',quoteSection:'ow-quote',stepsSection:'ow-steps',contactSection:'ow-contact'}[type]);
 root.dataset.sectionId=identity();
 const button=label=>{const p=el('p'),a=el('a',label,'website-button');a.setAttribute('href','#');p.append(a);return p;};
 if(type==='heroSection')root.append(el('h2',t('template_heroTitle')),el('p',t('template_heroText')),button(t('template_heroAction')));
 else if(type==='featuresSection'){
  const grid=el('div',undefined,'ow-feature-grid');
  for(const n of [1,2,3]){const card=el('section');card.append(el('h3',t('template_feature'+n+'Title')),el('p',t('template_feature'+n+'Text')));grid.append(card);}
  root.append(el('h2',t('template_featuresTitle')),grid);
 }
 else if(type==='ctaSection')root.append(el('h2',t('template_ctaTitle')),el('p',t('template_ctaText')),button(t('template_ctaAction')));
 else if(type==='quoteSection'){const quote=el('blockquote');quote.append(el('p',t('template_quoteText')));root.append(quote,el('p',t('template_quoteSource')));}
 else if(type==='stepsSection'){const list=el('ol');for(const n of [1,2,3])list.append(el('li',t('template_step'+n)));root.append(el('h2',t('template_stepsTitle')),list);}
 else if(type==='contactSection'){
  const list=el('dl');for(const key of ['Email','Place','Hours'])list.append(el('dt',t('template_contact'+key)),el('dd',t('template_contact'+key+'Value')));
  root.append(el('h2',t('template_contactTitle')),el('p',t('template_contactText')),list);
 }
 return root;
}
