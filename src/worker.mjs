import {HttpError,fail,text,currency,money,id,mutationGuard,body,publicHeaders} from './security.mjs';
import {matchListings,demoRates} from './matching.mjs';
import {assets} from './assets.mjs';
const now=()=>Math.floor(Date.now()/1000),uuid=()=>crypto.randomUUID();
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:publicHeaders()});
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await statement(db,sql,...args).all()).results;
const one=(db,sql,...args)=>statement(db,sql,...args).first();
const run=(db,sql,...args)=>statement(db,sql,...args).run();
function fields(b,allowed){if(Object.keys(b).some(k=>!allowed.includes(k)))fail(400,'Unexpected fields. Do not send identity documents or bank details.');}
function month(value){const s=text(value,7,7,'Travel month'),last=new Date();last.setUTCMonth(last.getUTCMonth()+18,1);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)||s<new Date().toISOString().slice(0,7)||s>last.toISOString().slice(0,7))fail(400,'Choose a travel month within the next 18 months.');return s;}
const countries=['India','Taiwan','Australia'];
function country(s){if(!countries.includes(s))fail(400,'Choose India, Taiwan or Australia.');return s;}
function identity(req){const uid=req.headers.get('oai-authenticated-user-id'),email=req.headers.get('oai-authenticated-user-email');return uid&&email?{id:uid,email}:null;}
async function actor(req,env){const u=identity(req);if(!u)fail(401,'Please log in to continue.');const p=await one(env.DB,'SELECT * FROM profiles WHERE user_id=?',u.id);if(p?.deleted||p?.suspended)fail(403,'This profile is unavailable.');return {...u,profile:p,admin:env.LOCAL_AUTH?!!env.ADMIN_USER_ID&&u.id===env.ADMIN_USER_ID:!!env.ADMIN_EMAIL&&u.email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase()};}
function requireProfile(a){if(!a.profile)fail(409,'Complete your profile first.');}
async function limit(db,key,max,seconds){const w=Math.floor(now()/seconds),r=await one(db,'INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.count+1 ELSE 1 END RETURNING count',key,w);if(r.count>max)fail(429,'Too many requests. Please wait before trying again.');}
const audit=(db,a,action,target)=>statement(db,'INSERT INTO audit_events VALUES(?,?,?,?,?)',uuid(),a.id,action,target,now());
function closeRelatedListings(db,user){return statement(db,"UPDATE listings SET status='closed' WHERE status='matched' AND id IN (SELECT r.listing_id FROM requests r JOIN listings t ON t.id=r.listing_id WHERE r.status='accepted' AND r.completed_at IS NULL AND (r.sender_id=? OR t.owner_id=?) UNION SELECT r.source_listing_id FROM requests r JOIN listings t ON t.id=r.listing_id WHERE r.status='accepted' AND r.completed_at IS NULL AND (r.sender_id=? OR t.owner_id=?))",user,user,user,user);}
async function blocked(db,a,b){return !!await one(db,'SELECT 1 FROM blocks WHERE (owner_id=? AND target_id=?) OR (owner_id=? AND target_id=?)',a,b,b,a);}
const listingSelect='SELECT l.*,p.display_name,p.public_id,p.country,p.is_demo FROM listings l JOIN profiles p ON p.user_id=l.owner_id';
function publicListing(l){const {owner_id,...rest}=l;return rest;}
function publicProfile(p){return {public_id:p.public_id,display_name:p.display_name,country:p.country,preferred_currency:p.preferred_currency,destination:p.destination,travel_month:p.travel_month,is_demo:p.is_demo};}
async function listings(db,a,mine=false){return all(db,listingSelect+(mine?" WHERE l.owner_id=? AND l.deleted_at IS NULL":" WHERE l.owner_id<>? AND l.status='open' AND l.deleted_at IS NULL AND l.end_date>=? AND p.suspended=0 AND p.deleted=0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.owner_id=? AND b.target_id=l.owner_id) OR (b.target_id=? AND b.owner_id=l.owner_id))")+' ORDER BY l.created_at DESC,l.id LIMIT 100',...(mine?[a.id]:[a.id,new Date().toISOString().slice(0,10),a.id,a.id]));}
async function requestRecord(db,rid,a){const r=await one(db,'SELECT r.*,l.owner_id,l.have,l.need,l.amount,l.wanted,l.origin,l.destination,l.start_date,l.status AS listing_status FROM requests r JOIN listings l ON l.id=r.listing_id WHERE r.id=? AND (r.sender_id=? OR l.owner_id=?)',id(rid),a.id,a.id);if(!r)fail(404,"Conversation or request not found for your account.");return r;}
const status=r=>r.completed_at?'completed':r.status;
async function requestList(db,a){const rows=await all(db,"SELECT r.*,l.have,l.need,l.amount,l.wanted,l.origin,l.destination,l.start_date,CASE WHEN l.owner_id=? THEN 'incoming' ELSE 'outgoing' END AS direction,p.display_name,p.public_id,p.is_demo,s.amount AS sender_amount,s.have AS sender_have,s.need AS sender_need,s.origin AS sender_origin,s.destination AS sender_destination,s.start_date AS sender_start_date FROM requests r JOIN listings l ON l.id=r.listing_id LEFT JOIN listings s ON s.id=r.source_listing_id JOIN profiles p ON p.user_id=CASE WHEN l.owner_id=? THEN r.sender_id ELSE l.owner_id END WHERE r.sender_id=? OR l.owner_id=? ORDER BY r.created_at DESC,r.id LIMIT 100",a.id,a.id,a.id,a.id);return rows.map(r=>{const {sender_id,...rest}=r;return {...rest,status:status(r)};});}
function listingInput(b){fields(b,['have','need','amount','wanted','origin','destination','travelMonth','note']);const have=currency(b.have),need=currency(b.need);if(have===need)fail(400,'Choose two different currencies.');const amount=money(b.amount),wanted=b.wanted?money(b.wanted):Math.max(100,Math.min(100000000,Math.round(amount/demoRates[have]*demoRates[need])));const origin=country(b.origin),destination=country(b.destination);if(origin===destination)fail(400,'Choose different origin and destination countries.');const travel=month(b.travelMonth),start=travel+'-01',d=new Date(start);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return {have,need,amount,wanted,origin,destination,start,end:d.toISOString().slice(0,10),note:text(b.note||'',0,300,'Note')};}
export async function handle(req,env){
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(!path.startsWith('/api/')){
  if(!['GET','HEAD'].includes(method))return json({error:'Method not allowed.'},405);
  const spa=/^\/(dashboard|discover|listings|requests|profile|notifications|login|signup|demo|conversation\/[a-zA-Z0-9_-]+)$/.test(path);
  const asset=assets[path==='/'||spa?'/index.html':path];if(!asset)return json({error:'Page not found.'},404);
  return new Response(method==='HEAD'?null:asset.body,{headers:publicHeaders(asset.type)});
 }
 try{
  if(!env.DB)fail(503,'Service temporarily unavailable.');
  if(path==='/api/session'&&method==='GET'){const u=identity(req);if(!u)return json({user:null,authMode:env.LOCAL_AUTH?'local':'chatgpt',prototype:true});const a=await actor(req,env);return json({user:{...(a.profile?publicProfile(a.profile):{}),email:a.email,admin:a.admin},authMode:env.LOCAL_AUTH?'local':'chatgpt',prototype:true});}
  const a=await actor(req,env),db=env.DB;
  await limit(db,'api:'+a.id,240,60);
  if(method==='GET'){
   if(path==='/api/profile')return json({profile:a.profile?{...publicProfile(a.profile),email:a.email}:null});
   if(path==='/api/mine')return json({listings:(await listings(db,a,true)).map(publicListing)});
   if(path==='/api/listings'||path==='/api/dashboard'){
    const mine=await listings(db,a,true),source=url.searchParams.get('source'),selected=source?mine.find(l=>l.id===source&&l.status==='open'):mine.find(l=>l.status==='open');if(source&&!selected)fail(404,'Your active source listing was not found.');
    let found=(await listings(db,a)).map(l=>({...publicListing(l),...(selected?matchListings(selected,l):{matchScore:null,reasons:['Create a listing to calculate your match score.'],compatible:false})}));
    for(const k of ['have','need'])if(url.searchParams.get(k))found=found.filter(l=>l[k]===currency(url.searchParams.get(k)));
    if(url.searchParams.get('destination'))found=found.filter(l=>l.destination===country(url.searchParams.get('destination')));
    if(url.searchParams.get('compatible')==='1')found=found.filter(l=>l.compatible);
    found.sort((x,y)=>(y.matchScore??-1)-(x.matchScore??-1)||x.id.localeCompare(y.id));
    if(path==='/api/listings')return json({listings:found,source: selected?.id??null,rates:demoRates});
    const counts=await one(db,"SELECT SUM(CASE WHEN r.status='pending' AND l.owner_id=? THEN 1 ELSE 0 END) AS incoming,SUM(CASE WHEN r.status='pending' AND r.sender_id=? THEN 1 ELSE 0 END) AS outgoing,SUM(CASE WHEN r.status='accepted' AND r.completed_at IS NULL THEN 1 ELSE 0 END) AS conversations,SUM(CASE WHEN r.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed FROM requests r JOIN listings l ON l.id=r.listing_id WHERE r.sender_id=? OR l.owner_id=?",a.id,a.id,a.id,a.id);
    return json({counts:{activeListings:mine.filter(l=>l.status==='open').length,potentialMatches:found.filter(l=>l.compatible).length,...Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v||0]))},listings:mine.map(publicListing),matches:found.filter(l=>l.compatible).slice(0,3)});
   }
   const p=path.match(/^\/api\/profiles\/([^/]+)$/);if(p){const row=await one(db,'SELECT * FROM profiles WHERE public_id=? AND deleted=0 AND suspended=0',id(p[1]));if(!row||await blocked(db,a.id,row.user_id))fail(404,'Profile not available.');return json({profile:publicProfile(row)});}
   if(path==='/api/requests')return json({requests:await requestList(db,a)});
   const chat=path.match(/^\/api\/requests\/([^/]+)\/messages$/);if(chat){const r=await requestRecord(db,chat[1],a);if(!['accepted','completed'].includes(status(r)))fail(409,'Conversation opens after acceptance.');if(await blocked(db,r.owner_id,r.sender_id))fail(403,'This connection is blocked.');return json({request:{id:r.id,status:status(r)},messages:(await all(db,'SELECT id,body,created_at,CASE WHEN sender_id=? THEN 1 ELSE 0 END AS mine FROM messages WHERE request_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200',a.id,r.id)).reverse()});}
   if(path==='/api/notifications')return json({notifications:await all(db,'SELECT id,request_id,kind,body,read_at,created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',a.id),unread:(await one(db,'SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',a.id)).n});
   if(path==='/api/blocks')return json({blocks:await all(db,'SELECT p.public_id,p.display_name FROM blocks b JOIN profiles p ON p.user_id=b.target_id WHERE b.owner_id=?',a.id)});
   if(path==='/api/admin'){if(!a.admin)fail(403,'Owner access required.');return json({reports:await all(db,'SELECT r.id,r.reason,r.status,r.listing_id,p.public_id,p.display_name FROM reports r JOIN profiles p ON p.user_id=r.target_id ORDER BY r.created_at DESC LIMIT 100')});}
   if(path==='/api/interest')return json({interest:await one(db,'SELECT direction,travel_month,updated_at FROM interests WHERE user_id=?',a.id)});
   if(path==='/api/export')return json({profile:a.profile?publicProfile(a.profile):null,listings:(await listings(db,a,true)).map(publicListing),requests:await requestList(db,a),messages:await all(db,'SELECT body,created_at FROM messages WHERE sender_id=?',a.id),interest:await one(db,'SELECT direction,travel_month FROM interests WHERE user_id=?',a.id)});
   fail(404,'Not found.');
  }
  if(method!=='POST')fail(405,'Method not allowed.');mutationGuard(req);await limit(db,'write:'+a.id,40,60);const b=await body(req);
  if(path==='/api/profile'){
   fields(b,['displayName','country','preferredCurrency','destination','travelMonth']);
   const name=text(b.displayName,2,40,'Name'),home=country(b.country),preferred=currency(b.preferredCurrency),dest=country(b.destination),travel=month(b.travelMonth);
   await db.batch([statement(db,'INSERT INTO profiles(user_id,public_id,display_name,country,preferred_currency,destination,travel_month,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name,country=excluded.country,preferred_currency=excluded.preferred_currency,destination=excluded.destination,travel_month=excluded.travel_month WHERE profiles.deleted=0 AND profiles.suspended=0',a.id,uuid(),name,home,preferred,dest,travel,now()),audit(db,a,'profile_saved',a.id)]);return json({ok:true});
  }
  requireProfile(a);
  if(path==='/api/listings'){
   const l=listingInput(b),lid=uuid();await limit(db,'listing:'+a.id,20,86400);
   const results=await db.batch([statement(db,"INSERT INTO listings(id,owner_id,have,need,amount,wanted,city,start_date,end_date,note,status,created_at,origin,destination) SELECT ?,?,?,?,?,?,'',?,?,?,'open',?,?,? WHERE (SELECT COUNT(*) FROM listings WHERE owner_id=? AND status='open' AND deleted_at IS NULL)<10",lid,a.id,l.have,l.need,l.amount,l.wanted,l.start,l.end,l.note,now(),l.origin,l.destination,a.id),audit(db,a,'listing_created',lid)]);if(!results[0].meta.changes)fail(409,'Close an older listing first. Maximum ten active listings.');return json({id:lid},201);
  }
  const edit=path.match(/^\/api\/listings\/([^/]+)\/(edit|close|delete)$/);if(edit){
   const lid=id(edit[1]),l=await one(db,'SELECT * FROM listings WHERE id=? AND owner_id=? AND deleted_at IS NULL',lid,a.id);if(!l)fail(404,'Your listing was not found.');if(l.status==='matched')fail(409,'End or complete the accepted exchange first.');
   if(edit[2]==='edit'){if(l.status!=='open')fail(409,'Only open listings can be edited.');const v=listingInput(b);const result=await db.batch([statement(db,"UPDATE listings SET have=?,need=?,amount=?,wanted=?,origin=?,destination=?,start_date=?,end_date=?,note=? WHERE id=? AND owner_id=? AND status='open' AND NOT EXISTS(SELECT 1 FROM requests WHERE status='pending' AND (listing_id=? OR source_listing_id=?))",v.have,v.need,v.amount,v.wanted,v.origin,v.destination,v.start,v.end,v.note,lid,a.id,lid,lid),audit(db,a,'listing_edited',lid)]);if(!result[0].meta.changes)fail(409,'Resolve pending requests before editing this listing.');
   }else{fields(b,[]);await db.batch([statement(db,"UPDATE listings SET status='closed',deleted_at=? WHERE id=? AND owner_id=? AND status<>'matched'",edit[2]==='delete'?now():null,lid,a.id),statement(db,"UPDATE requests SET status='cancelled' WHERE status='pending' AND (listing_id=? OR source_listing_id=?)",lid,lid),audit(db,a,'listing_'+edit[2],lid)]);}return json({ok:true});
  }
  if(path==='/api/requests'){
   fields(b,['listingId','sourceListingId']);await limit(db,'request:'+a.id,30,86400);
   const target=await one(db,listingSelect+" WHERE l.id=? AND l.status='open' AND l.deleted_at IS NULL AND p.deleted=0 AND p.suspended=0",id(b.listingId));
   if(!target)fail(404,'This listing is no longer available.');if(target.owner_id===a.id)fail(400,'You cannot request your own listing.');
   const source=await one(db,"SELECT * FROM listings WHERE id=? AND owner_id=? AND status='open' AND deleted_at IS NULL",id(b.sourceListingId),a.id);
   if(!source)fail(404,'Your active listing was not found.');if(!matchListings(source,target).compatible)fail(400,'The listings must have opposite currency needs.');if(await blocked(db,a.id,target.owner_id))fail(403,'This connection is blocked.');
   if(await one(db,"SELECT 1 FROM requests WHERE (listing_id=? AND sender_id=?) OR (listing_id=? AND source_listing_id=? AND status IN ('pending','accepted'))",target.id,a.id,source.id,target.id))fail(409,'You already have a request for these listings.');
   const rid=uuid();const result=await db.batch([
    statement(db,"INSERT INTO requests(id,listing_id,sender_id,status,created_at,source_listing_id) SELECT ?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM listings t, listings s WHERE t.id=? AND s.id=? AND t.status='open' AND s.status='open' AND t.deleted_at IS NULL AND s.deleted_at IS NULL AND t.end_date>=? AND s.end_date>=? AND t.have=s.need AND t.need=s.have AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.owner_id=t.owner_id AND bl.target_id=s.owner_id) OR (bl.owner_id=s.owner_id AND bl.target_id=t.owner_id)) AND (SELECT COUNT(*) FROM profiles p WHERE p.user_id IN (t.owner_id,s.owner_id) AND p.deleted=0 AND p.suspended=0)=2)",rid,target.id,a.id,now(),source.id,target.id,source.id,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10)),
    statement(db,"INSERT INTO notifications(id,user_id,request_id,kind,body,created_at) SELECT ?,?,?,'request','New demo exchange request',? WHERE EXISTS(SELECT 1 FROM requests WHERE id=?)",uuid(),target.owner_id,rid,now(),rid),audit(db,a,'request_created',rid)
   ]);if(!result[0].meta.changes)fail(409,'This listing is no longer available.');return json({id:rid},201);
  }
  const action=path.match(/^\/api\/requests\/([^/]+)\/(accept|decline|cancel|complete|messages)$/);if(action){
   const r=await requestRecord(db,action[1],a),kind=action[2],other=r.owner_id===a.id?r.sender_id:r.owner_id;
   if(await blocked(db,a.id,other))fail(403,'This connection is blocked.');
   if(!await one(db,'SELECT 1 FROM profiles WHERE user_id=? AND suspended=0 AND deleted=0',other))fail(403,'This connection is unavailable.');
   if(kind==='messages'){
    fields(b,['message']);if(status(r)!=='accepted')fail(409,'Messages can only be sent in an accepted exchange.');await limit(db,'message:'+a.id,20,60);
    const mid=uuid();const result=await db.batch([statement(db,"INSERT INTO messages(id,request_id,sender_id,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM requests r JOIN listings l ON l.id=r.listing_id WHERE r.id=? AND r.status='accepted' AND r.completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.owner_id=r.sender_id AND bl.target_id=l.owner_id) OR (bl.owner_id=l.owner_id AND bl.target_id=r.sender_id)) AND (SELECT COUNT(*) FROM profiles p WHERE p.user_id IN(r.sender_id,l.owner_id) AND p.deleted=0 AND p.suspended=0)=2)",mid,r.id,a.id,text(b.message,1,1000,'Message'),now(),r.id),statement(db,"INSERT INTO notifications(id,user_id,request_id,kind,body,created_at) SELECT ?,?,?,'message','New message in your demo conversation',? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)",uuid(),other,r.id,now(),mid),audit(db,a,'message_sent',r.id)]);if(!result[0].meta.changes)fail(409,'This conversation has closed.');return json({ok:true},201);
   }
   fields(b,[]);if(['accept','decline'].includes(kind)&&r.owner_id!==a.id)fail(403,'Only the listing owner can accept or decline.');
   const current=status(r);if(kind==='complete'&&current!=='accepted'||['accept','decline'].includes(kind)&&current!=='pending'||kind==='cancel'&&!['pending','accepted'].includes(current))fail(409,'This request has already changed. Refresh to see its status.');
   const commands=[];
   if(kind==='accept'){
    commands.push(statement(db,"UPDATE requests SET status='accepted' WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM listings t,listings s WHERE t.id=? AND s.id=? AND t.status='open' AND s.status='open' AND t.deleted_at IS NULL AND s.deleted_at IS NULL AND t.end_date>=? AND s.end_date>=? AND t.have=s.need AND t.need=s.have AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.owner_id=t.owner_id AND bl.target_id=s.owner_id) OR (bl.owner_id=s.owner_id AND bl.target_id=t.owner_id)) AND (SELECT COUNT(*) FROM profiles p WHERE p.user_id IN (t.owner_id,s.owner_id) AND p.deleted=0 AND p.suspended=0)=2)",r.id,r.listing_id,r.source_listing_id,new Date().toISOString().slice(0,10),new Date().toISOString().slice(0,10)));
    commands.push(statement(db,"UPDATE listings SET status='matched' WHERE id IN (?,?) AND EXISTS(SELECT 1 FROM requests WHERE id=? AND status='accepted')",r.listing_id,r.source_listing_id,r.id));
    commands.push(statement(db,"UPDATE requests SET status='declined' WHERE id<>? AND status='pending' AND (listing_id IN (?,?) OR source_listing_id IN (?,?)) AND EXISTS(SELECT 1 FROM requests WHERE id=? AND status='accepted')",r.id,r.listing_id,r.source_listing_id,r.listing_id,r.source_listing_id,r.id));
   }else if(kind==='complete')commands.push(statement(db,"UPDATE requests SET completed_at=? WHERE id=? AND status='accepted' AND completed_at IS NULL",now(),r.id));
   else commands.push(statement(db,"UPDATE requests SET status=? WHERE id=? AND status=? AND completed_at IS NULL",kind==='decline'?'declined':'cancelled',r.id,r.status));
   if(kind==='complete'||kind==='cancel'&&r.status==='accepted')commands.push(statement(db,"UPDATE listings SET status='closed' WHERE id IN (?,?) AND EXISTS(SELECT 1 FROM requests WHERE id=? AND (completed_at IS NOT NULL OR status='cancelled'))",r.listing_id,r.source_listing_id,r.id));
   commands.splice(1,0,statement(db,"INSERT INTO notifications(id,user_id,request_id,kind,body,created_at) SELECT ?,?,?,?,?,? WHERE changes()>0",uuid(),other,r.id,kind,({accept:"Request accepted",decline:"Request declined",cancel:"Request cancelled",complete:"Demo exchange completed — no money moved"})[kind],now()),statement(db,"INSERT INTO audit_events SELECT ?,?,?,?,? WHERE changes()>0",uuid(),a.id,"request_"+kind,r.id,now()));
   const result=await db.batch(commands);if(!result[0].meta.changes)fail(409,'Another action changed this request. Refresh and try again.');return json({ok:true});
  }
  if(path==='/api/notifications/read'){fields(b,['id']);if(b.id)await run(db,'UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',now(),id(b.id),a.id);else await run(db,'UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),a.id);return json({ok:true});}
  if(path==='/api/blocks'){
   fields(b,['publicId','remove']);const p=await one(db,'SELECT user_id FROM profiles WHERE public_id=?',id(b.publicId));if(!p||p.user_id===a.id)fail(400,'Choose another traveller.');
   if(b.remove===true)await db.batch([statement(db,'DELETE FROM blocks WHERE owner_id=? AND target_id=?',a.id,p.user_id),audit(db,a,'unblock',p.user_id)]);
   else await db.batch([statement(db,'INSERT OR IGNORE INTO blocks VALUES(?,?,?)',a.id,p.user_id,now()),statement(db,"UPDATE listings SET status='closed' WHERE status='matched' AND id IN (SELECT listing_id FROM requests r JOIN listings l ON l.id=r.listing_id WHERE r.status='accepted' AND ((r.sender_id=? AND l.owner_id=?) OR (r.sender_id=? AND l.owner_id=?)) UNION SELECT source_listing_id FROM requests r JOIN listings l ON l.id=r.listing_id WHERE r.status='accepted' AND ((r.sender_id=? AND l.owner_id=?) OR (r.sender_id=? AND l.owner_id=?)))",a.id,p.user_id,p.user_id,a.id,a.id,p.user_id,p.user_id,a.id),statement(db,"UPDATE requests SET status='cancelled' WHERE completed_at IS NULL AND status IN ('pending','accepted') AND ((sender_id=? AND listing_id IN (SELECT id FROM listings WHERE owner_id=?)) OR (sender_id=? AND listing_id IN (SELECT id FROM listings WHERE owner_id=?)))",a.id,p.user_id,p.user_id,a.id),audit(db,a,'block',p.user_id)]);return json({ok:true});
  }
  if(path==='/api/reports'){fields(b,['publicId','reason']);const p=await one(db,'SELECT user_id FROM profiles WHERE public_id=?',id(b.publicId));if(!p||p.user_id===a.id)fail(400,'Choose another traveller.');await limit(db,'report:'+a.id,10,86400);await db.batch([statement(db,"INSERT INTO reports(id,reporter_id,target_id,reason,status,created_at) VALUES(?,?,?,?,'open',?)",uuid(),a.id,p.user_id,text(b.reason,10,1000,'Report'),now()),audit(db,a,'report',p.user_id)]);return json({ok:true},201);}
  if(path==='/api/admin'){if(!a.admin)fail(403,'Owner access required.');fields(b,['reportId','action']);const r=await one(db,'SELECT * FROM reports WHERE id=?',id(b.reportId));if(!r)fail(404,'Report not found.');if(!['resolve','suspend'].includes(b.action))fail(400,'Invalid moderation action.');const commands=[];if(b.action==='suspend')commands.push(closeRelatedListings(db,r.target_id),statement(db,'UPDATE profiles SET suspended=1 WHERE user_id=?',r.target_id),statement(db,"UPDATE listings SET status='hidden' WHERE owner_id=?",r.target_id),statement(db,"UPDATE requests SET status='cancelled' WHERE completed_at IS NULL AND (sender_id=? OR listing_id IN (SELECT id FROM listings WHERE owner_id=?))",r.target_id,r.target_id));commands.push(statement(db,"UPDATE reports SET status='resolved' WHERE id=?",r.id),audit(db,a,b.action,r.target_id));await db.batch(commands);return json({ok:true});}
  if(path==='/api/interest/delete'){await run(db,'DELETE FROM interests WHERE user_id=?',a.id);return json({ok:true});}
  if(path==='/api/profile/delete'){fields(b,['confirm']);if(b.confirm!=='DELETE')fail(400,'Type DELETE to confirm.');await db.batch([closeRelatedListings(db,a.id),statement(db,'DELETE FROM interests WHERE user_id=?',a.id),statement(db,"UPDATE profiles SET display_name='Deleted traveller',country='',destination='',travel_month='',deleted=1 WHERE user_id=?",a.id),statement(db,"UPDATE listings SET status='closed',note='',origin='',destination='',start_date='',end_date='',deleted_at=? WHERE owner_id=?",now(),a.id),statement(db,"UPDATE messages SET body='[Deleted by author]' WHERE sender_id=?",a.id),statement(db,"UPDATE requests SET status='cancelled' WHERE completed_at IS NULL AND (sender_id=? OR listing_id IN(SELECT id FROM listings WHERE owner_id=?))",a.id,a.id),statement(db,'DELETE FROM notifications WHERE user_id=?',a.id),audit(db,a,'profile_deleted',a.id)]);return json({ok:true});}
  fail(404,'Not found.');
 }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);if(String(e?.message).includes('UNIQUE constraint failed: requests'))return json({error:'You already sent a request.'},409);console.error(JSON.stringify({event:'request_failed',incident:uuid()}));return json({error:'We could not save this change. Please try again; your form has been kept.'},503);}
}
export default {fetch:handle};

