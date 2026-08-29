import OpenAI from "openai";
import { google } from "googleapis";
import http from "node:http";

const PORT = Number(process.env.PORT || 3000);
const DOC_ID = process.env.SMILE_DOC_ID || "1eDqcVLJTiXMIIQRTuIDebQSXxFBy2afCAipk-2kyzpg";
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const FACE_DECK = ["🙂","😄","😁","😂","😇","😎","🤓","🤠","🥳","🤩"];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/documents"]
});
const docs = google.docs({ version: "v1", auth });
let running = true;
let lastStatus = { state: "starting", message: "Dispatcher starting" };

http.createServer((req,res)=>{
  res.writeHead(200, {"content-type":"application/json"});
  res.end(JSON.stringify({service:"SMILE-01 dispatcher",running,...lastStatus}));
}).listen(PORT, "0.0.0.0", ()=>console.log(`Health server listening on ${PORT}`));

function parseState(text){
  const lines=text.split("\n");
  const get=k=>lines.find(x=>x.startsWith(`${k}:`))?.slice(k.length+1).trim();
  const i=lines.findIndex(x=>x.trim()==="HISTORY:");
  return {protocol:get("PROTOCOL"),cycle:Number(get("CYCLE")),turn:get("TURN"),
    lastActor:get("LAST_ACTOR"),lastFace:get("LAST_FACE"),status:get("STATUS"),
    revision:Number(get("REVISION")),history:i>=0?lines.slice(i+1).filter(Boolean):[]};
}
function serializeState(s){return [`PROTOCOL: ${s.protocol}`,`CYCLE: ${s.cycle}`,`TURN: ${s.turn}`,
 `LAST_ACTOR: ${s.lastActor}`,`LAST_FACE: ${s.lastFace}`,`STATUS: ${s.status}`,
 `REVISION: ${s.revision}`,"","HISTORY:",...s.history,""].join("\n");}
function usedFaces(h,a){return h.filter(x=>x.includes(`ACTOR ${a}`)).map(x=>x.match(/FACE (.*?) \|/)?.[1]).filter(Boolean);}

async function readState(){
 const d=await docs.documents.get({documentId:DOC_ID}); const a=[];
 for(const x of d.data.body.content??[]) for(const e of x.paragraph?.elements??[]) if(e.textRun?.content)a.push(e.textRun.content);
 return {text:a.join(""),revisionId:d.data.revisionId};
}
async function runTwin(actor,state){
 const available=FACE_DECK.filter(f=>!usedFaces(state.history,actor).includes(f));
 if(!available.length)return {exhausted:true};
 const other=actor==="🙂"?"😎":"🙂";
 const input=`You are Twin ${actor==="🙂"?"A":"B"}, actor ${actor}. Protocol SMILE-01.
Act exactly once. Choose exactly one unused face from AVAILABLE_FACES.
Increment cycle and revision exactly one. Set last_actor=${actor}, last_face=chosen face, turn=${other}.
Return JSON only with keys: chosen_face, cycle, turn, last_actor, last_face, revision, history_line.
history_line format: TXN <cycle> | ACTOR <actor> | FACE <face> | CYCLE <old>→<new> | TURN <old>→<new actor> | REVISION <old>→<new>
CURRENT_STATE:${JSON.stringify(state)}
AVAILABLE_FACES:${JSON.stringify(available)}`;
 const r=await openai.responses.create({model:MODEL,input});
 return JSON.parse(r.output_text);
}
function validate(b,a,actor){
 const other=actor==="🙂"?"😎":"🙂";
 if(b.turn!==actor)throw new Error("Wrong actor");
 if(a.cycle!==b.cycle+1)throw new Error("Bad cycle");
 if(a.revision!==b.revision+1)throw new Error("Bad revision");
 if(a.last_actor!==actor||a.last_face!==a.chosen_face||a.turn!==other)throw new Error("Bad actor/face/turn");
 if(!FACE_DECK.includes(a.chosen_face)||usedFaces(b.history,actor).includes(a.chosen_face))throw new Error("Invalid/reused face");
}
async function writeState(b,t,requiredRevisionId){
 const n={...b,cycle:t.cycle,turn:t.turn,lastActor:t.last_actor,lastFace:t.last_face,revision:t.revision,
 history:[...b.history,t.history_line]};
 const d=await docs.documents.get({documentId:DOC_ID});
 const end=d.data.body.content.at(-1)?.endIndex??1;
 await docs.documents.batchUpdate({documentId:DOC_ID,requestBody:{writeControl:{requiredRevisionId},requests:[
  {deleteContentRange:{range:{startIndex:1,endIndex:end-1}}},
  {insertText:{location:{index:1},text:serializeState(n)}}]}});
}
async function loop(){
 console.log("SMILE-01 Railway dispatcher engaged.");
 while(running){
  const {text,revisionId}=await readState(); const s=parseState(text);
  lastStatus={state:"running",cycle:s.cycle,turn:s.turn,revision:s.revision,lastFace:s.lastFace};
  if(s.protocol!=="SMILE-01")throw new Error("Wrong protocol");
  if(s.status!=="READY"){console.log("Not READY; waiting.");await new Promise(r=>setTimeout(r,3000));continue;}
  const aDone=usedFaces(s.history,"🙂").length>=FACE_DECK.length;
  const bDone=usedFaces(s.history,"😎").length>=FACE_DECK.length;
  if(aDone&&bDone){lastStatus={state:"complete",cycle:s.cycle,message:"Both face decks exhausted."};console.log(lastStatus.message);return;}
  const actor=s.turn;
  if(!["🙂","😎"].includes(actor))throw new Error(`Invalid TURN ${actor}`);
  const t=await runTwin(actor,s);
  if(t.exhausted){lastStatus={state:"waiting",message:`${actor} exhausted; waiting for other actor/state.`};await new Promise(r=>setTimeout(r,3000));continue;}
  validate(s,t,actor);
  await writeState(s,t,revisionId);
  const v=parseState((await readState()).text);
  if(v.revision!==s.revision+1||v.lastActor!==actor)throw new Error("READBACK FAILED");
  console.log(`PASS: ${actor} played ${v.lastFace}; cycle=${v.cycle}; next=${v.turn}`);
  lastStatus={state:"running",cycle:v.cycle,turn:v.turn,revision:v.revision,lastFace:v.lastFace};
  await new Promise(r=>setTimeout(r,1000));
 }
}
loop().catch(e=>{console.error("DISPATCHER STOPPED:",e);lastStatus={state:"error",message:String(e)};});
