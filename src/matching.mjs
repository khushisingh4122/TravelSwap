// Illustrative units per INR, fixed for this educational prototype. Not live FX rates.
export const demoRates={INR:1,TWD:0.38,AUD:0.018};
export function matchListings(a,b){
 const reciprocal=a.have===b.need&&a.need===b.have;
 const route=!!a.origin&&a.origin===b.destination&&a.destination===b.origin;
 const days=Math.abs(Date.parse(a.start_date)-Date.parse(b.start_date))/86400000;
 const datePoints=Number.isFinite(days)?Math.max(0,20*(1-days/90)):0;
 const av=a.amount/demoRates[a.have],bv=b.amount/demoRates[b.have];
 const amountPoints=av>0&&bv>0?20*Math.min(av,bv)/Math.max(av,bv):0;
 const components={currency:reciprocal?40:0,destination:route?20:0,date:Math.round(datePoints),amount:Math.round(amountPoints)};
 return {matchScore:Object.values(components).reduce((s,n)=>s+n,0),components,reasons:[reciprocal?'Opposite currency needs':'Currency directions differ',route?'Travel routes are reciprocal':'Travel routes differ',days===0?'Same travel month':days<=90?'Travel months are within 90 days':'Travel months are more than 90 days apart','Amount comparison uses fixed demo rates, not a quote'],compatible:reciprocal};
}

