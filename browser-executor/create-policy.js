// Only the checkout-approved, coordinate-confirmed basic flow can create a location.
export function validateCreate(job){
 const p=job?.proposal,z=job?.zone,s=p?.schedule;
 if(job?.action!=='create'||job.approvalSource!=='user_checkout'||!job.approvedAt||!p||z?.bindingStatus!=='draft'||z?.coordinateSource!=='user_map'||!z.pointConfirmedAt)throw Error('CREATE_NOT_APPROVED');
 if(!p.name?.trim()||p.name.length>120||!p.message?.trim()||p.message.length>240||p.message!==job.message||p.name!==z.name||p.message!==z.proposedMessage)throw Error('CREATE_CONTENT_MISMATCH');
 for(const [field,limit] of [['latitude',90],['longitude',180]])if(!Number.isFinite(p[field])||Math.abs(p[field])>limit||p[field]!==z[field])throw Error('CREATE_COORDINATES_MISMATCH');
 if(!Number.isFinite(p.radius)||p.radius<100||p.radius>150||p.radius!==z.observedRadiusMeters)throw Error('CREATE_RADIUS_INVALID');
 if(s?.mode!=='always'||!['entry','exit','dwell'].includes(s.trigger)||!Array.isArray(s.days)||s.days.length!==7||new Set(s.days).size!==7||s.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('CREATE_SCHEDULE_UNSUPPORTED');
 const delays={reentry:'5','12h':'43200','24h':'86400','2d':'172800','3d':'259200','2w':'1209600','1mo':'2628000'};
 if(!delays[s.repeat]||(s.trigger==='dwell'&&(!Number.isInteger(s.dwellMinutes)||s.dwellMinutes<1||s.dwellMinutes>1440)))throw Error('CREATE_REPEAT_INVALID');
 const destination=new URL(s.destination);if(destination.protocol!=='https:'||destination.username||destination.password)throw Error('CREATE_URL_INVALID');
 return {...p,sendOn:{entry:'1',exit:'2',dwell:'3'}[s.trigger],sendDelay:delays[s.repeat],destination:destination.href,marker:'MyCity '+job.id.slice(-12)};
}
