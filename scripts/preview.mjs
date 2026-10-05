// Local-only authentication adapter. Never bundled into the Sites Worker.
import http from 'node:http';
import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import worker from '../dist/server/index.js';
import {database} from '../tests/helpers.mjs';
import {HttpError,mutationGuard,body,text,publicHeaders} from '../src/security.mjs';
const derive=promisify(scrypt),seconds=()=>Math.floor(Date.now()/1000),digest=v=>createHash('sha256').update(v).digest('hex');
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
export function openDatabase(file='work/preview.sqlite'){
 if(file!==':memory:')mkdirSync('work',{recursive:true});
 const fresh=file===':memory:'||!existsSync(file),DB=database(file);
 if(fresh&&file!==':memory:')DB.sql.exec(readFileSync('db/schema.sql','utf8'));
 if(!DB.sql.prepare("SELECT 1 FROM sqlite_master WHERE name='interests'").get())DB.sql.exec(readFileSync('drizzle/0001_interest_pilot.sql','utf8'));
 if(!DB.sql.prepare('PRAGMA table_info(profiles)').all().some(c=>c.name==='country'))DB.sql.exec(readFileSync('drizzle/0002_student_prototype.sql','utf8'));
 DB.sql.exec("CREATE TABLE IF NOT EXISTS local_accounts(user_id TEXT PRIMARY KEY REFERENCES profiles(user_id),email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS local_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES profiles(user_id),expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_local_session_expiry ON local_sessions(expires_at);");
 return DB;
}
function seedDemo(DB){
 const travel=new Date();travel.setUTCMonth(travel.getUTCMonth()+2,1);const start=travel.toISOString().slice(0,10),month=start.slice(0,7);travel.setUTCMonth(travel.getUTCMonth()+1);travel.setUTCDate(0);const end=travel.toISOString().slice(0,10);
 for(const u of [{id:'demo-ananya',name:'Ananya',country:'India',dest:'Taiwan',have:'INR',need:'TWD',amount:1000000,wanted:380000},{id:'demo-wei',name:'Wei',country:'Taiwan',dest:'India',have:'TWD',need:'INR',amount:380000,wanted:1000000}]){
  DB.sql.prepare('INSERT OR IGNORE INTO profiles(user_id,public_id,display_name,country,preferred_currency,destination,travel_month,is_demo,created_at) VALUES(?,?,?,?,?,?,?,1,?)').run(u.id,u.id,u.name,u.country,u.have,u.dest,month,seconds());
  if(!DB.sql.prepare("SELECT 1 FROM listings WHERE owner_id=? AND status IN ('open','matched') AND end_date>=? AND deleted_at IS NULL").get(u.id,start))DB.sql.prepare("INSERT INTO listings(id,owner_id,have,need,amount,wanted,city,start_date,end_date,note,status,created_at,origin,destination) VALUES(?,?,?,?,?,?,'',?,?,?,'open',?,?,?)").run(crypto.randomUUID(),u.id,u.have,u.need,u.amount,u.wanted,start,end,'Sample listing for a simulated exchange only.',seconds(),u.country,u.dest);
 }
}
export function createServer({DB=openDatabase(),port=4174}={}){
 let boundPort=port;
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.headers.host!=='127.0.0.1:'+boundPort){res.writeHead(403).end('Invalid host');return;}
   const url=new URL(req.url,'http://127.0.0.1:'+boundPort),headers=new Headers();
   for(const [key,value] of Object.entries(req.headers))if(!key.startsWith('oai-')&&!['cf-connecting-ip','cookie'].includes(key)&&value)headers.set(key,Array.isArray(value)?value.join(','):value);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413,publicHeaders()).end(JSON.stringify({error:'Request is too large.'}));return;}chunks.push(chunk);}
   const makeRequest=()=>new Request(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const token=req.headers.cookie?.match(/(?:^|;\s*)travelswap_session=([a-f0-9]{64})(?:;|$)/)?.[1];
   const session=token?DB.sql.prepare('SELECT s.user_id,a.email,p.is_demo FROM local_sessions s JOIN profiles p ON p.user_id=s.user_id LEFT JOIN local_accounts a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND p.deleted=0 AND p.suspended=0').get(digest(token),seconds()):null;
   if(url.pathname.startsWith('/api/auth/')){
    if(req.method!=='POST')throw new HttpError(405,'Use a POST request.');
    const request=makeRequest();mutationGuard(request);const b=await body(request),kind=url.pathname.slice(10);
    const key='auth:'+req.socket.remoteAddress,w=Math.floor(seconds()/60);
    const limit=DB.sql.prepare('INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.count+1 ELSE 1 END RETURNING count').get(key,w);
    if(limit.count>30)throw new HttpError(429,'Too many sign-in attempts. Wait a minute.');
    if(kind==='logout'){if(token)DB.sql.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(digest(token));res.writeHead(200,{...publicHeaders(),'Set-Cookie':'travelswap_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}).end('{"ok":true}');return;}
    let uid;
    if(kind==='demo'){
     if(!['ananya','wei'].includes(b.account))throw new HttpError(400,'Choose a demo account.');
     seedDemo(DB);uid='demo-'+b.account;
     if(!DB.sql.prepare('SELECT 1 FROM profiles WHERE user_id=? AND deleted=0 AND suspended=0').get(uid))throw new HttpError(403,'This demo account is unavailable.');
    }else if(['signup','login'].includes(kind)){
     const email=text(b.email,5,254,'Email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid email.');
     if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new HttpError(400,'Use a password of 12–128 characters.');
     if(kind==='signup'){
      const name=text(b.name,2,40,'Name');
      if(DB.sql.prepare('SELECT 1 FROM local_accounts WHERE email=?').get(email))throw new HttpError(409,'An account exists for this email. Log in instead.');
      const salt=randomBytes(16).toString('hex'),hash=(await derive(b.password,salt,64,options)).toString('hex');uid=crypto.randomUUID();
      DB.sql.exec('BEGIN');try{DB.sql.prepare('INSERT INTO profiles(user_id,public_id,display_name,created_at) VALUES(?,?,?,?)').run(uid,crypto.randomUUID(),name,seconds());DB.sql.prepare('INSERT INTO local_accounts VALUES(?,?,?,?)').run(uid,email,salt,hash);DB.sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(crypto.randomUUID(),uid,'signup',uid,seconds());DB.sql.exec('COMMIT');}catch(e){DB.sql.exec('ROLLBACK');if(String(e.message).includes('UNIQUE'))throw new HttpError(409,'This email is already registered.');throw e;}
     }else{
      const row=DB.sql.prepare('SELECT a.*,p.deleted,p.suspended FROM local_accounts a JOIN profiles p ON p.user_id=a.user_id WHERE a.email=?').get(email);
      const computed=await derive(b.password,row?.salt||'00000000000000000000000000000000',64,options),expected=row?Buffer.from(row.password_hash,'hex'):Buffer.alloc(64);
      if(!timingSafeEqual(computed,expected)||!row||row.deleted||row.suspended)throw new HttpError(401,'Email or password is incorrect.');
      uid=row.user_id;
     }
    }else throw new HttpError(404,'Not found.');
    const sessionToken=randomBytes(32).toString('hex');
    DB.sql.exec('BEGIN');try{if(token)DB.sql.prepare('DELETE FROM local_sessions WHERE token_hash=?').run(digest(token));DB.sql.prepare('DELETE FROM local_sessions WHERE expires_at<=?').run(seconds());DB.sql.prepare('INSERT INTO local_sessions VALUES(?,?,?)').run(digest(sessionToken),uid,seconds()+86400);DB.sql.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(crypto.randomUUID(),uid,'login',uid,seconds());DB.sql.exec('COMMIT');}catch(e){DB.sql.exec('ROLLBACK');throw e;}
    res.writeHead(200,{...publicHeaders(),'Set-Cookie':'travelswap_session='+sessionToken+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'}).end('{"ok":true}');return;
   }
   if(session){headers.set('oai-authenticated-user-id',session.user_id);headers.set('oai-authenticated-user-email',session.email||session.user_id+'@example.test');}
   const response=await worker.fetch(makeRequest(),{DB,LOCAL_AUTH:true,ADMIN_USER_ID:process.env.ADMIN_USER_ID||''});
   const responseHeaders=Object.fromEntries(response.headers);
   if(url.pathname==='/api/profile/delete'&&response.ok&&session){
    DB.sql.exec('BEGIN');try{DB.sql.prepare('DELETE FROM local_sessions WHERE user_id=?').run(session.user_id);DB.sql.prepare('DELETE FROM local_accounts WHERE user_id=?').run(session.user_id);DB.sql.exec('COMMIT');}catch(e){DB.sql.exec('ROLLBACK');throw e;}
    responseHeaders['Set-Cookie']='travelswap_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
   }
   res.writeHead(response.status,responseHeaders);res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e instanceof HttpError?e.status:503,publicHeaders()).end(JSON.stringify({error:e instanceof HttpError?e.message:'Unable to complete this request. Please try again.'}));}
 });
 server.on('listening',()=>{boundPort=server.address().port;});
 return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createServer().listen(4174,'127.0.0.1',()=>console.log('TravelSwap student prototype: http://127.0.0.1:4174/'));

