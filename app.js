import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot,
  getDocs, getDoc, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, sendEmailVerification, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD68eZtjE-tsweX6evcgSWJjaIznfApSdI",
  authDomain: "panda-fc-449f7.firebaseapp.com",
  projectId: "panda-fc-449f7",
  storageBucket: "panda-fc-449f7.firebasestorage.app",
  messagingSenderId: "854268170585",
  appId: "1:854268170585:web:1f1cadb971677f59a97c48",
  measurementId: "G-GF5664G8HQ"
};

const APP_BUILD = "auth-firebase-2026-08-19-v2";
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
setPersistence(auth, browserLocalPersistence).catch(console.error);

const DIRECTORIA_EMAILS = new Set([
  "abimaeltablet@gmail.com",
  "marcelo.vst@hotmail.com",
  "marcioviniciustabosa@gmail.com"
]);
let currentUser = null;
let currentRole = "JOGADOR";
let realtimeStarted = false;

let presenceTimer=null, presenceUnsubscribe=null, chatUnsubscribe=null, pinnedUnsubscribe=null;
let onlineUsers=[], chatMessages=[], pinnedChatMessage=null, lastChatSignature="";
const PRESENCE_HEARTBEAT_MS=60000, PRESENCE_ONLINE_WINDOW_MS=125000;

function safeText(value=""){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function displayUserName(){return currentUser?.displayName||currentUser?.email?.split("@")[0]||"Usuário";}
function roleLabel(){return isDirector()?"DIRETORIA":"JOGADOR";}

function normalizedEmail(user=currentUser){ return String(user?.email || "").trim().toLowerCase(); }
function isDirectorEmail(user=currentUser){ return DIRECTORIA_EMAILS.has(normalizedEmail(user)); }
function isDirector(){ return !!currentUser && isDirectorEmail(currentUser) && currentUser.emailVerified; }
function requireDirector(){
  if(isDirector()) return true;
  toast("Apenas a DIRETORIA pode alterar informações.");
  return false;
}

const PUSH_WORKER_URL = "https://pandas-fc-push.abimaeltablet.workers.dev/";

function getAlertLabel(value){
  const labels={
    "none":"sem alerta",
    "15":"15 min antes",
    "30":"30 min antes",
    "60":"1 hora antes",
    "120":"2 horas antes",
    "360":"6 horas antes",
    "720":"12 horas antes",
    "1440":"1 dia antes",
    "custom":"horário personalizado"
  };
  return labels[String(value)] || "1 hora antes";
}

function getAlertDateISO(date,time,alertValue,customValue=""){
  if(alertValue==="custom"){
    if(!customValue) throw new Error("Escolha o horário personalizado do alerta.");
    const customDate=new Date(customValue);
    if(Number.isNaN(customDate.getTime())) throw new Error("Horário personalizado inválido.");
    return customDate.toISOString();
  }

  const matchDate=new Date(`${date}T${time}:00`);
  if(Number.isNaN(matchDate.getTime())) throw new Error("Data ou hora da partida inválida.");

  const minutes=Number(alertValue || 60);
  return new Date(matchDate.getTime() - minutes*60*1000).toISOString();
}

async function callPushWorker(payload){
  const response=await fetch(PUSH_WORKER_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });

  let result={};
  try{ result=await response.json(); }catch{}

  if(!response.ok || result.ok===false){
    const detail=result?.details?.errors?.join?.(" • ") ||
                 result?.details?.errors?.[0] ||
                 result?.error ||
                 `Erro HTTP ${response.status}`;
    throw new Error(detail);
  }

  return result;
}

const state = {
  players: [],
  events: [],
  teamLogo: "",
  selectedLineup: [],
  lineupPositions: {},
  music: {
    youtubePlaylistUrl: "",
    youtubePlaylistId: "",
    youtubeVideoId: "",
    youtubeSourceType: "",
    customAudios: [],
    announcement: null
  },
  dashboardMedia: {
    type: "",
    data: "",
    url: "",
    urlMode: "auto"
  }
};

let firebaseReady = false;
const syncStatus = document.getElementById("syncStatus");
function setSyncStatus(text, type=""){
  if(!syncStatus) return;
  syncStatus.textContent = text;
  syncStatus.className = `sync-status ${type}`.trim();
}

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function fileToCompressedDataURL(file, maxSize=500, quality=.72){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}


async function presenceBeat(){
  if(!currentUser)return;
  try{
    await setDoc(doc(db,"presence",currentUser.uid),{
      uid:currentUser.uid,
      name:displayUserName(),
      role:roleLabel(),
      lastSeen:serverTimestamp()
    },{merge:true});
  }catch(err){
    console.warn("presence:",err);
  }
}
function activeOnlineUsers(){
  const now=Date.now();
  return onlineUsers.filter(u=>{const t=u.lastSeen?.toMillis?.()||0;return t&&now-t<=PRESENCE_ONLINE_WINDOW_MS;});
}
function renderPresence(){
  const active=activeOnlineUsers(), n=active.length;
  document.getElementById("onlineCount")?.replaceChildren(document.createTextNode(String(n)));
  document.getElementById("chatOnlineCount")?.replaceChildren(document.createTextNode(String(n)));
  const list=document.getElementById("onlineUsersList");
  if(list)list.innerHTML=active.length?active.map(u=>`<span class="online-user-chip">🟢 ${safeText(u.name||"Usuário")}${u.role==="DIRETORIA"?" • DIRETORIA":""}</span>`).join(""):'<span class="muted">Ninguém online agora.</span>';
}
function stopPresence(){
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
  if(presenceUnsubscribe){presenceUnsubscribe();presenceUnsubscribe=null;}
  onlineUsers=[];renderPresence();
}
function startPresence(){
  stopPresence(); if(!currentUser)return;
  presenceBeat();
  presenceTimer=setInterval(()=>{presenceBeat();renderPresence();},PRESENCE_HEARTBEAT_MS);
  presenceUnsubscribe=onSnapshot(collection(db,"presence"),snap=>{onlineUsers=snap.docs.map(d=>({id:d.id,...d.data()}));renderPresence();},err=>console.warn("presence realtime:",err));
}
function chatTime(ts){try{return ts?.toDate?.().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})||"agora";}catch{return"agora";}}
function renderChat(){
  const box=document.getElementById("chatMessages"); if(!box)return;
  const msgs=[...chatMessages].sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0));
  box.innerHTML=msgs.length?msgs.map(m=>{
    const mine=m.uid===currentUser?.uid, canDelete=isDirector()||mine;
    return `<article class="chat-message ${mine?"mine":""}"><div class="chat-message-head"><strong>${safeText(m.name||"Usuário")}</strong><span class="chat-role">${safeText(m.role||"JOGADOR")}</span><span>${m.pending?"enviando...":chatTime(m.createdAt)}</span></div><div class="chat-message-text">${safeText(m.text||"")}</div>${(canDelete||isDirector())?`<div class="chat-message-actions">${isDirector()?`<button type="button" data-chat-pin="${m.id}">📌 Fixar</button>`:""}${canDelete?`<button type="button" data-chat-delete="${m.id}">🗑️ Apagar</button>`:""}</div>`:""}</article>`;
  }).join(""):'<div class="muted">Nenhuma mensagem ainda. Seja o primeiro a escrever. 🐼</div>';
  const sig=msgs.map(m=>m.id).join("|");if(sig!==lastChatSignature){lastChatSignature=sig;box.scrollTop=box.scrollHeight;}
  const pin=document.getElementById("chatPinned");
  if(pin){if(pinnedChatMessage?.text){pin.classList.remove("hidden");pin.innerHTML=`📌 <strong>Recado fixado:</strong> ${safeText(pinnedChatMessage.text)} ${isDirector()?'<button id="unpinChatBtn" type="button">Remover</button>':""}`;}else{pin.classList.add("hidden");pin.innerHTML="";}}
}
function stopChat(){
  if(chatUnsubscribe){chatUnsubscribe();chatUnsubscribe=null;}if(pinnedUnsubscribe){pinnedUnsubscribe();pinnedUnsubscribe=null;}
}
function setChatRealtimeStatus(text,type=""){
  const el=document.getElementById("chatRealtimeStatus");if(!el)return;el.textContent=text;el.classList.remove("ok","err");if(type)el.classList.add(type);
}
function startChat(){
  stopChat();if(!currentUser)return;setChatRealtimeStatus("🟡 Conectando ao bate-papo...");
  chatUnsubscribe=onSnapshot(collection(db,"chatMessages"),snap=>{
    chatMessages=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)).slice(-100);
    setChatRealtimeStatus("🟢 Bate-papo conectado","ok");renderChat();
  },async err=>{
    console.warn("chat realtime:",err);setChatRealtimeStatus("🔴 Realtime indisponível — tentando atualizar...","err");
    try{const snap=await getDocs(collection(db,"chatMessages"));chatMessages=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)).slice(-100);renderChat();}
    catch(readErr){console.warn("chat fallback:",readErr);const box=document.getElementById("chatMessages");if(box)box.innerHTML='<div class="muted">Não foi possível carregar o bate-papo.</div>';}
  });
  pinnedUnsubscribe=onSnapshot(doc(db,"settings","chat"),snap=>{pinnedChatMessage=snap.exists()?(snap.data().pinned||null):null;renderChat();},err=>console.warn("pin:",err));
}

async function sendChat(text){
  const clean=String(text||"").trim().slice(0,300);if(!clean||!currentUser)return false;
  const tempId=`local-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  chatMessages=[...chatMessages,{id:tempId,uid:currentUser.uid,name:displayUserName(),role:roleLabel(),text:clean,createdAt:null,pending:true}].slice(-100);renderChat();
  try{await setDoc(doc(collection(db,"chatMessages")),{uid:currentUser.uid,name:displayUserName(),role:roleLabel(),text:clean,createdAt:serverTimestamp()});setChatRealtimeStatus("🟢 Mensagem enviada","ok");return true;}
  catch(err){chatMessages=chatMessages.filter(m=>m.id!==tempId);renderChat();console.warn("send chat:",err);setChatRealtimeStatus("🔴 Falha ao enviar mensagem","err");toast(err?.code==="permission-denied"?"Sem permissão para enviar. Publique as novas regras do Firestore.":"Não foi possível enviar a mensagem.");return false;}
}

async function removeChat(id){
  const m=chatMessages.find(x=>x.id===id);if(!m||(!isDirector()&&m.uid!==currentUser?.uid))return;
  try{await deleteDoc(doc(db,"chatMessages",id));}catch{toast("Não foi possível apagar.");}
}
async function pinChat(id){
  if(!requireDirector())return;const m=chatMessages.find(x=>x.id===id);if(!m)return;
  try{await setDoc(doc(db,"settings","chat"),{pinned:{id:m.id,uid:m.uid,name:m.name,role:m.role,text:m.text},updatedAt:serverTimestamp()},{merge:true});toast("Recado fixado.");}catch{toast("Não foi possível fixar.");}
}
async function unpinChat(){if(!requireDirector())return;try{await setDoc(doc(db,"settings","chat"),{pinned:null,updatedAt:serverTimestamp()},{merge:true});}catch{}}


function markWriting(){
  setSyncStatus("☁️ Sincronizando...");
}

async function connectRealtime(){
  if(realtimeStarted) return;

  setSyncStatus("☁️ Conectando...");

  /*
   * Faz primeiro uma sincronização inicial por requisições normais.
   * Isso evita o cabeçalho ficar eternamente em "Conectando..."
   * enquanto o canal realtime/WebChannel ainda está sendo aberto.
   */
  try{
    const timeout=(promise,ms=12000,label="Firebase")=>Promise.race([
      promise,
      new Promise((_,reject)=>setTimeout(
        ()=>reject(new Error(`${label}: tempo limite de ${Math.round(ms/1000)}s.`)),
        ms
      ))
    ]);

    const [
      playersSnap,
      eventsSnap,
      teamSnap,
      dashboardSnap,
      lineupSnap,
      musicSnap
    ]=await timeout(Promise.all([
      getDocs(collection(db,"players")),
      getDocs(collection(db,"events")),
      getDoc(doc(db,"settings","team")),
      getDoc(doc(db,"settings","dashboard")),
      getDoc(doc(db,"lineup","current")),
      getDoc(doc(db,"settings","music"))
    ]),15000,"Sincronização inicial");

    state.players=playersSnap.docs.map(d=>({id:d.id,...d.data()}));
    state.players.sort((a,b)=>
      (Number(a.number)||0)-(Number(b.number)||0) ||
      String(a.name||"").localeCompare(String(b.name||""))
    );

    state.events=eventsSnap.docs.map(d=>({id:d.id,...d.data()}));

    state.teamLogo=teamSnap.exists()?(teamSnap.data().teamLogo||""):"";

    const dashboardData=dashboardSnap.exists()?dashboardSnap.data():{};
    state.dashboardMedia={
      type:dashboardData.mediaType||"",
      data:dashboardData.mediaData||"",
      url:dashboardData.mediaUrl||"",
      urlMode:dashboardData.urlMode||"auto"
    };

    const lineupData=lineupSnap.exists()?lineupSnap.data():{};
    state.selectedLineup=lineupData.playerIds||[];
    state.lineupPositions=lineupData.positions||{};

    const musicData=musicSnap.exists()?musicSnap.data():{};
    state.music={
      youtubePlaylistUrl:musicData.youtubePlaylistUrl||"",
      youtubePlaylistId:musicData.youtubePlaylistId||"",
      youtubeVideoId:musicData.youtubeVideoId||"",
      youtubeSourceType:musicData.youtubeSourceType||(
        musicData.youtubePlaylistId ? "playlist" :
        musicData.youtubeVideoId ? "video" : ""
      ),
      customAudios:Array.isArray(musicData.customAudios)?musicData.customAudios:[],
      announcement:musicData.announcement||null
    };

    const typeSelect=document.getElementById("dashboardMediaUrlType");
    const urlInput=document.getElementById("dashboardMediaUrl");
    if(typeSelect)typeSelect.value=state.dashboardMedia.urlMode;
    if(urlInput && state.dashboardMedia.url)urlInput.value=state.dashboardMedia.url;

    firebaseReady=true;
    realtimeStarted=true;
    setSyncStatus("☁️ Sincronizado","ok");

    renderPlayers();
    renderLineup();
    renderScorers();
    renderEvents();
    renderMatches();
    renderStats();
    renderCalendar();
    checkTodayMatches();
    renderLogo();
    renderDashboardMedia();
    renderMusicAdmin();
    applyMusicConfiguration();
    handleRemoteAnnouncement(state.music.announcement);

  }catch(err){
    console.error("Sincronização inicial Firebase:",err);
    realtimeStarted=false;
    setSyncStatus("⚠️ Erro de sincronização","err");
    toast(`Firebase: ${err?.message||"falha na sincronização"}`);
    return;
  }

  /*
   * Após a leitura inicial ter funcionado, liga os listeners realtime.
   * Se o canal realtime demorar, o app continua utilizável e já aparece
   * como sincronizado porque os dados iniciais foram confirmados.
   */
  onSnapshot(collection(db,"players"),snap=>{
    state.players=snap.docs.map(d=>({id:d.id,...d.data()}));
    state.players.sort((a,b)=>
      (Number(a.number)||0)-(Number(b.number)||0) ||
      String(a.name||"").localeCompare(String(b.name||""))
    );
    setSyncStatus("☁️ Sincronizado","ok");
    renderPlayers(); renderLineup(); renderScorers();
  },err=>realtimeSyncError("players",err));

  onSnapshot(collection(db,"events"),snap=>{
    state.events=snap.docs.map(d=>({id:d.id,...d.data()}));
    setSyncStatus("☁️ Sincronizado","ok");
    renderEvents(); renderMatches(); renderStats(); renderCalendar(); checkTodayMatches();
  },err=>realtimeSyncError("events",err));

  onSnapshot(doc(db,"settings","team"),snap=>{
    state.teamLogo=snap.exists()?(snap.data().teamLogo||""):"";
    setSyncStatus("☁️ Sincronizado","ok");
    renderLogo();
  },err=>realtimeSyncError("team",err));

  onSnapshot(doc(db,"settings","dashboard"),snap=>{
    const d=snap.exists()?snap.data():{};
    state.dashboardMedia={
      type:d.mediaType||"",
      data:d.mediaData||"",
      url:d.mediaUrl||"",
      urlMode:d.urlMode||"auto"
    };
    setSyncStatus("☁️ Sincronizado","ok");
    renderDashboardMedia();
  },err=>realtimeSyncError("dashboard",err));

  onSnapshot(doc(db,"lineup","current"),snap=>{
    const d=snap.exists()?snap.data():{};
    state.selectedLineup=d.playerIds||[];
    state.lineupPositions=d.positions||{};
    setSyncStatus("☁️ Sincronizado","ok");
    renderLineup();
  },err=>realtimeSyncError("lineup",err));

  onSnapshot(doc(db,"settings","music"),snap=>{
    const d=snap.exists()?snap.data():{};
    state.music={
      youtubePlaylistUrl:d.youtubePlaylistUrl||"",
      youtubePlaylistId:d.youtubePlaylistId||"",
      youtubeVideoId:d.youtubeVideoId||"",
      youtubeSourceType:d.youtubeSourceType||(
        d.youtubePlaylistId ? "playlist" :
        d.youtubeVideoId ? "video" : ""
      ),
      customAudios:Array.isArray(d.customAudios)?d.customAudios:[],
      announcement:d.announcement||null
    };
    setSyncStatus("☁️ Sincronizado","ok");
    renderMusicAdmin();
    applyMusicConfiguration();
    handleRemoteAnnouncement(state.music.announcement);
  },err=>realtimeSyncError("music",err));
}

function realtimeSyncError(source,err){
  console.error(`Realtime Firebase (${source}):`,err);
  /*
   * Não derruba os dados já carregados pela sincronização inicial.
   * Apenas informa a falha.
   */
  setSyncStatus("⚠️ Realtime indisponível","err");
  toast(`Falha realtime (${source}). Os dados iniciais continuam disponíveis.`);
}

function syncError(err){
  console.error(err);
  setSyncStatus("⚠️ Erro de sincronização","err");
  toast("Erro ao acessar o Firebase. Verifique as regras do Firestore.");
}

document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.page).classList.add('active');
}));

const playerForm = document.getElementById('playerForm');
playerForm.addEventListener('submit', async e=>{
  e.preventDefault();
  if(!requireDirector()) return;
  const id=document.getElementById('playerId').value || uid();
  const old=state.players.find(p=>p.id===id);
  const obj={
    name:document.getElementById('playerName').value.trim(),
    position:document.getElementById('playerPosition').value,
    number:Number(document.getElementById('playerNumber').value),
    goals:Number(old?.goals||0),
    updatedAt:serverTimestamp()
  };
  try{
    markWriting();
    await setDoc(doc(db,"players",id),obj,{merge:true});
    playerForm.reset(); document.getElementById('playerId').value='';
    toast('Jogador salvo e sincronizado.');
  }catch(err){ syncError(err); }
});
document.getElementById('cancelPlayerEdit').onclick=()=>{playerForm.reset();document.getElementById('playerId').value='';};
document.getElementById('playerSearch').addEventListener('input',renderPlayers);

function editPlayer(id){
  const p=state.players.find(x=>x.id===id); if(!p)return;
  document.getElementById('playerId').value=p.id; document.getElementById('playerName').value=p.name||'';
  document.getElementById('playerPosition').value=p.position||''; document.getElementById('playerNumber').value=p.number??'';
  document.querySelector('[data-page="cadastro"]').click();
}
async function deletePlayer(id){
  if(!requireDirector()) return;
  if(!confirm('Excluir este jogador em todos os dispositivos?'))return;
  try{
    markWriting();
    await deleteDoc(doc(db,"players",id));
    const ids=state.selectedLineup.filter(x=>x!==id);
    const positions={...(state.lineupPositions||{})};
    delete positions[id];
    await setDoc(doc(db,"lineup","current"),{
      playerIds:ids,
      positions,
      updatedAt:serverTimestamp()
    },{merge:true});
  }catch(err){syncError(err);}
}
function renderPlayers(){
  const q=document.getElementById('playerSearch').value.toLowerCase();
  const arr=state.players.filter(p=>`${p.name} ${p.position} ${p.number}`.toLowerCase().includes(q));
  document.getElementById('playersList').innerHTML=arr.length?arr.map(p=>`
    <div class="list-row">
      <div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div>
      ${isDirector()?`<div class="actions"><button onclick="editPlayer('${p.id}')">✏️ Editar</button><button onclick="deletePlayer('${p.id}')">🗑️ Excluir</button></div>`:''}
    </div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}

function renderLineup(){
  const selectorCard=document.getElementById('lineupSelectorCard');
  const lineupLayout=document.querySelector('.lineup-layout');
  const downloadBtn=document.getElementById('downloadLineup');
  const pageDescription=document.getElementById('lineupDescription');

  if(selectorCard) selectorCard.classList.toggle('hidden',!isDirector());
  if(lineupLayout) lineupLayout.classList.toggle('viewer-lineup',!isDirector());
  if(downloadBtn) downloadBtn.classList.toggle('hidden',!isDirector());

  if(pageDescription){
    pageDescription.textContent=isDirector()
      ? 'Selecione os jogadores e arraste-os livremente pelo campo.'
      : 'Escalação definida pela DIRETORIA.';
  }

  const list=document.getElementById('lineupPlayers');
  if(list && isDirector()){
    list.innerHTML=state.players.length?state.players.map(p=>`
      <label class="check-item">
        <input type="checkbox"
          ${state.selectedLineup.includes(p.id)?'checked':''}
          onchange="toggleLineup('${p.id}',this.checked)">
        <span><strong>#${p.number} ${esc(p.name)}</strong><br><span class="muted">${esc(p.position)}</span></span>
      </label>`).join(''):'<p class="muted">Cadastre jogadores primeiro.</p>';
  }

  renderField();
}

async function toggleLineup(id,on){
  if(!requireDirector()){ renderLineup(); return; }

  let ids=[...state.selectedLineup];
  const positions={...(state.lineupPositions||{})};

  if(on&&!ids.includes(id)) ids.push(id);

  if(!on){
    ids=ids.filter(x=>x!==id);
    delete positions[id];
  }

  try{
    markWriting();
    await setDoc(doc(db,"lineup","current"),{
      playerIds:ids,
      positions,
      updatedAt:serverTimestamp()
    },{merge:true});
  }catch(err){syncError(err);}
}

const positionSlots={
 'Goleiro':[[50,91],[50,9]],
 'Zagueiro':[[30,77],[50,80],[70,77],[35,23],[65,23]],
 'Lateral':[[12,70],[88,70],[12,30],[88,30]],
 'Volante':[[38,62],[62,62],[38,38],[62,38]],
 'Meio-campo':[[25,52],[50,54],[75,52],[50,46]],
 'Atacante':[[30,24],[50,19],[70,24],[30,76],[70,76]]
};

function getDefaultPlayerSlots(players){
  const used={};
  return players.map((p,idx)=>{
    const slots=positionSlots[p.position]||[[20+((idx*17)%60),50]];
    used[p.position]=(used[p.position]||0);
    const pos=slots[used[p.position]%slots.length];
    used[p.position]++;
    return {p,x:pos[0],y:pos[1]};
  });
}

function getPlayerSlots(players){
  const defaults=getDefaultPlayerSlots(players);

  return defaults.map(item=>{
    const saved=state.lineupPositions?.[item.p.id];

    if(saved &&
       Number.isFinite(Number(saved.x)) &&
       Number.isFinite(Number(saved.y))){
      return {
        p:item.p,
        x:Math.max(3,Math.min(97,Number(saved.x))),
        y:Math.max(3,Math.min(97,Number(saved.y)))
      };
    }

    return item;
  });
}

let draggingPlayer=null;
let dragPointerId=null;

function renderField(){
  const players=state.selectedLineup
    .map(id=>state.players.find(p=>p.id===id))
    .filter(Boolean);

  const slots=getPlayerSlots(players);
  const root=document.getElementById('fieldPlayers');
  if(!root)return;

  root.innerHTML=slots.map(({p,x,y})=>`
    <div
      class="field-player ${isDirector()?'draggable-player':'viewer-player'}"
      data-player-id="${p.id}"
      style="left:${x}%;top:${y}%"
      ${isDirector()?'title="Arraste para posicionar"':''}>
      #${p.number}<br>${esc(p.name)}
    </div>
  `).join('');

  if(isDirector()) enableLineupDragging();
}

function getPointerPercentOnField(event,field){
  const rect=field.getBoundingClientRect();
  const clientX=event.clientX;
  const clientY=event.clientY;

  let x=((clientX-rect.left)/rect.width)*100;
  let y=((clientY-rect.top)/rect.height)*100;

  // Mantém o marcador inteiro dentro da arte.
  x=Math.max(4,Math.min(96,x));
  y=Math.max(3,Math.min(97,y));

  return {x,y};
}

function enableLineupDragging(){
  const field=document.getElementById('soccerField');
  if(!field)return;

  field.querySelectorAll('.field-player.draggable-player').forEach(el=>{
    el.addEventListener('pointerdown',event=>{
      if(!isDirector())return;

      event.preventDefault();
      draggingPlayer=el;
      dragPointerId=event.pointerId;
      el.classList.add('dragging');
      el.setPointerCapture?.(event.pointerId);

      const pos=getPointerPercentOnField(event,field);
      el.style.left=`${pos.x}%`;
      el.style.top=`${pos.y}%`;
    });
  });
}

async function saveDraggedPlayerPosition(playerId,x,y){
  if(!isDirector())return;

  const positions={
    ...(state.lineupPositions||{}),
    [playerId]:{
      x:Number(x.toFixed(2)),
      y:Number(y.toFixed(2))
    }
  };

  // Atualiza localmente de imediato para não "pular" enquanto o snapshot chega.
  state.lineupPositions=positions;

  try{
    markWriting();
    await setDoc(doc(db,"lineup","current"),{
      positions,
      updatedAt:serverTimestamp()
    },{merge:true});
    setSyncStatus("☁️ Sincronizado","ok");
  }catch(err){
    syncError(err);
  }
}

const soccerField=document.getElementById('soccerField');

if(soccerField){
  soccerField.addEventListener('pointermove',event=>{
    if(!draggingPlayer || event.pointerId!==dragPointerId || !isDirector())return;

    event.preventDefault();
    const pos=getPointerPercentOnField(event,soccerField);
    draggingPlayer.style.left=`${pos.x}%`;
    draggingPlayer.style.top=`${pos.y}%`;
  });

  const finishDrag=event=>{
    if(!draggingPlayer || event.pointerId!==dragPointerId)return;

    event.preventDefault();
    const el=draggingPlayer;
    const pos=getPointerPercentOnField(event,soccerField);
    const playerId=el.dataset.playerId;

    el.style.left=`${pos.x}%`;
    el.style.top=`${pos.y}%`;
    el.classList.remove('dragging');

    try{ el.releasePointerCapture?.(event.pointerId); }catch{}

    draggingPlayer=null;
    dragPointerId=null;

    saveDraggedPlayerPosition(playerId,pos.x,pos.y);
  };

  soccerField.addEventListener('pointerup',finishDrag);
  soccerField.addEventListener('pointercancel',event=>{
    if(!draggingPlayer || event.pointerId!==dragPointerId)return;
    draggingPlayer.classList.remove('dragging');
    draggingPlayer=null;
    dragPointerId=null;
    renderField();
  });
}

document.getElementById('downloadLineup').onclick=()=>downloadLineupImage();
async function downloadLineupImage(){
  const c=document.createElement('canvas');
  c.width=1024;
  c.height=1536;
  const x=c.getContext('2d');

  // Fundo preto de segurança
  x.fillStyle='#000';
  x.fillRect(0,0,c.width,c.height);

  // Usa a mesma arte personalizada da aba Escalação
  try{
    const fieldImg=await loadImage('./campo-pandas-fc.png');

    const scale=Math.max(c.width/fieldImg.width,c.height/fieldImg.height);
    const w=fieldImg.width*scale;
    const h=fieldImg.height*scale;
    const dx=(c.width-w)/2;
    const dy=(c.height-h)/2;

    x.drawImage(fieldImg,dx,dy,w,h);
  }catch(err){
    console.error('Erro ao carregar campo personalizado:',err);
    x.fillStyle='#071927';
    x.fillRect(0,0,c.width,c.height);
  }

  // Jogadores posicionados sobre a imagem
  const players=state.selectedLineup
    .map(id=>state.players.find(p=>p.id===id))
    .filter(Boolean);

  const slots=getPlayerSlots(players);

  slots.forEach(({p,x:px,y:py})=>{
    const cx=(px/100)*c.width;
    const cy=(py/100)*c.height;

    // sombra
    x.beginPath();
    x.fillStyle='rgba(0,0,0,.55)';
    x.arc(cx+4,cy+6,52,0,Math.PI*2);
    x.fill();

    // marcador azul escuro
    x.beginPath();
    x.fillStyle='#061a2d';
    x.arc(cx,cy,50,0,Math.PI*2);
    x.fill();

    // contorno azul
    x.strokeStyle='#09a9f5';
    x.lineWidth=4;
    x.stroke();

    // número
    x.fillStyle='#fff';
    x.textAlign='center';
    x.textBaseline='middle';
    x.font='bold 27px Arial';
    x.fillText(`#${p.number}`,cx,cy-9);

    // nome
    x.font='bold 19px Arial';
    x.fillText(String(p.name).toUpperCase(),cx,cy+19);
  });

  downloadCanvas(c,'escalacao-pandas-fc.png');
}
function downloadCanvas(c,name){const a=document.createElement('a');a.download=name;a.href=c.toDataURL('image/png');a.click();}

const eventForm=document.getElementById('eventForm');
const matchAlert=document.getElementById('matchAlert');
const customAlertWrap=document.getElementById('customAlertWrap');
const customAlertTime=document.getElementById('customAlertTime');

function updateCustomAlertVisibility(){
  if(!matchAlert || !customAlertWrap)return;
  const custom=matchAlert.value==='custom';
  customAlertWrap.classList.toggle('hidden',!custom);
  if(customAlertTime) customAlertTime.required=custom;
}

if(matchAlert){
  matchAlert.addEventListener('change',updateCustomAlertVisibility);
  updateCustomAlertVisibility();
}

eventForm.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!requireDirector()) return;

  const id=document.getElementById('eventId').value || uid();
  const old=state.events.find(x=>x.id===id);
  let logo=old?.logo||'';
  const f=document.getElementById('opponentLogo').files[0];
  if(f)logo=await fileToCompressedDataURL(f);

  const opponent=document.getElementById('opponentName').value.trim();
  const date=document.getElementById('matchDate').value;
  const time=document.getElementById('matchTime').value;
  const location=document.getElementById('matchLocation').value.trim();
  const alertValue=matchAlert?.value || 'none';
  const customValue=customAlertTime?.value || '';
  const wantsAlert=alertValue!=='none';

  let alertAt='';
  if(wantsAlert){
    try{
      alertAt=getAlertDateISO(date,time,alertValue,customValue);
    }catch(err){
      alert(err.message);
      return;
    }

    if(new Date(alertAt).getTime() <= Date.now()){
      alert('O horário do alerta precisa estar no futuro. Escolha uma antecedência menor ou um horário personalizado.');
      return;
    }
  }

  const obj={
    opponent,
    logo,
    date,
    time,
    location,
    alertValue,
    alertAt,
    customAlertTime:alertValue==='custom' ? customValue : '',
    goalsFor:old?.goalsFor??'',
    goalsAgainst:old?.goalsAgainst??'',
    notificationMessageId:old?.notificationMessageId||'',
    updatedAt:serverTimestamp()
  };

  try{
    markWriting();

    if(wantsAlert){
      // Agenda a notificação somente quando a DIRETORIA escolher um alerta.
      const pushResult=await callPushWorker({
        action:"schedule",
        opponent,
        date:formatDate(date),
        time,
        location,
        sendAt:alertAt,
        alertLabel:getAlertLabel(alertValue),
        previousMessageId:old?.notificationMessageId||null,
        message:
          `PANDAS FC x ${opponent}\n` +
          `🕐 ${formatDate(date)} às ${time}\n` +
          `${location ? `📍 ${location}\n` : ''}` +
          `🔔 Alerta: ${getAlertLabel(alertValue)}`
      });

      obj.notificationMessageId=pushResult.messageId || '';
    }else{
      // Se era uma partida editada que já tinha alerta, cancela o alerta antigo.
      if(old?.notificationMessageId){
        try{
          await callPushWorker({
            action:"cancel",
            messageId:old.notificationMessageId
          });
        }catch(cancelErr){
          console.warn('Não foi possível cancelar o alerta anterior:',cancelErr);
        }
      }
      obj.notificationMessageId='';
      obj.alertAt='';
      obj.customAlertTime='';
    }

    await setDoc(doc(db,"events",id),obj,{merge:true});

    eventForm.reset();
    document.getElementById('eventId').value='';
    if(matchAlert) matchAlert.value='none';
    if(customAlertTime) customAlertTime.value='';
    updateCustomAlertVisibility();

    toast(
      wantsAlert
        ? `Confronto salvo. 🔔 Alerta: ${getAlertLabel(alertValue)}.`
        : 'Confronto salvo sem notificação.'
    );
  }catch(err){
    console.error('Erro ao salvar confronto:',err);
    setSyncStatus("⚠️ Erro ao salvar confronto","err");
    alert(
      wantsAlert
        ? `Não foi possível salvar/agendar a notificação.\n\n${err.message}`
        : `Não foi possível salvar o confronto.\n\n${err.message}`
    );
  }
});

document.getElementById('cancelEventEdit').onclick=()=>{
  eventForm.reset();
  document.getElementById('eventId').value='';
  if(matchAlert) matchAlert.value='none';
  if(customAlertTime) customAlertTime.value='';
  updateCustomAlertVisibility();
};

function editEvent(id){
  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  document.getElementById('eventId').value=e.id;
  document.getElementById('opponentName').value=e.opponent||'';
  document.getElementById('matchDate').value=e.date||'';
  document.getElementById('matchTime').value=e.time||'';
  document.getElementById('matchLocation').value=e.location||'';

  if(matchAlert) matchAlert.value=String(e.alertValue||(e.notificationMessageId?'60':'none'));
  if(customAlertTime) customAlertTime.value=e.customAlertTime||'';
  updateCustomAlertVisibility();

  document.querySelector('[data-page="agenda"]')?.click();
  eventForm.scrollIntoView({behavior:'smooth',block:'start'});
}

async function deleteEvent(id){
  if(!requireDirector()) return;
  const e=state.events.find(x=>x.id===id);
  if(!e)return;
  if(!confirm('Excluir este confronto e cancelar a notificação agendada?'))return;

  try{
    markWriting();

    if(e.notificationMessageId){
      try{
        await callPushWorker({
          action:"cancel",
          messageId:e.notificationMessageId
        });
      }catch(cancelErr){
        console.warn('Não foi possível cancelar o alerta no OneSignal:',cancelErr);
      }
    }

    await deleteDoc(doc(db,"events",id));
    toast('Confronto excluído e alerta cancelado.');
  }catch(err){
    syncError(err);
  }
}

function statusOf(e){if(e.goalsFor===''||e.goalsAgainst==='')return '';const a=Number(e.goalsFor),b=Number(e.goalsAgainst);return a>b?'VITÓRIA':a<b?'DERROTA':'EMPATE';}
function renderEvents(){
  const sorted=[...state.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  document.getElementById('eventsList').innerHTML=sorted.length?sorted.map(e=>`
   <div class="list-row"><div class="match-main">${e.logo?`<img class="opponent-logo" src="${e.logo}">`:''}<div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div></div></div>
   <div class="actions">${isDirector()?`<button onclick="editEvent('${e.id}')">✏️</button>`:''}<button onclick="generatePoster('${e.id}')">🖼️ Arte</button>${isDirector()?`<button onclick="deleteEvent('${e.id}')">🗑️</button>`:''}</div></div>`).join(''):'<p class="muted">Nenhuma partida agendada.</p>';
}
function renderMatches(){
 document.getElementById('matchesList').innerHTML=state.events.length?state.events.map(e=>{
   const st=statusOf(e),cls=st==='VITÓRIA'?'win':st==='DERROTA'?'loss':st==='EMPATE'?'draw':'';
   return `<div class="card list-row"><div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div>${st?`<div class="status ${cls}">${st}</div>`:''}</div>
   <div class="score-inputs"><input type="number" min="0" value="${e.goalsFor}" placeholder="0" ${isDirector()?'':'disabled'} onchange="setScore('${e.id}','goalsFor',this.value)"><strong>×</strong><input type="number" min="0" value="${e.goalsAgainst}" placeholder="0" ${isDirector()?'':'disabled'} onchange="setScore('${e.id}','goalsAgainst',this.value)"></div></div>`;
 }).join(''):'<div class="card"><p class="muted">Cadastre confrontos na Agenda.</p></div>';
}
async function setScore(id,key,v){
  if(!requireDirector()){ renderMatches(); return; }
  try{
    markWriting();
    await setDoc(doc(db,"events",id),{[key]:v===''?'':Number(v),updatedAt:serverTimestamp()},{merge:true});
  }catch(err){syncError(err);}
}
function formatDate(s){if(!s)return'';const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;}

async function generatePoster(id){
  const e=state.events.find(x=>x.id===id);
  if(!e)return;

  const c=document.createElement('canvas');
  c.width=1080;
  c.height=1920;
  const x=c.getContext('2d');

  try{
    const bg=await loadImage('./background-partida-pandas.png');
    const scale=Math.max(c.width/bg.width,c.height/bg.height);
    const w=bg.width*scale;
    const h=bg.height*scale;
    const dx=(c.width-w)/2;
    const dy=(c.height-h)/2;
    x.drawImage(bg,dx,dy,w,h);
  }catch(err){
    const g=x.createLinearGradient(0,0,1080,1920);
    g.addColorStop(0,'#03182a');
    g.addColorStop(1,'#07101b');
    x.fillStyle=g;
    x.fillRect(0,0,c.width,c.height);
  }

  x.fillStyle='rgba(0,12,28,.72)';
  x.roundRect(90,500,900,760,34);
  x.fill();

  x.textAlign='center';
  x.fillStyle='#ffffff';
  x.font='bold 62px Arial';
  x.fillText('DIA DE JOGO',540,590);

  x.fillStyle='#14a8f5';
  x.font='bold 28px Arial';
  x.fillText('PANDAS FUTEBOL CLUBE',540,640);

  const logoY=710, logoW=280, logoH=280;

  if(state.teamLogo){
    try{
      const im=await loadImage(state.teamLogo);
      drawContain(x,im,120,logoY,logoW,logoH);
    }catch{}
  }else{
    x.font='170px Arial';
    x.fillStyle='#fff';
    x.fillText('🐼',260,900);
  }

  if(e.logo){
    try{
      const im=await loadImage(e.logo);
      drawContain(x,im,680,logoY,logoW,logoH);
    }catch{}
  }

  x.fillStyle='#14a8f5';
  x.font='bold 72px Arial';
  x.fillText('X',540,865);

  x.fillStyle='#ffffff';
  x.font='bold 34px Arial';
  x.fillText('PANDAS FC',260,1045);

  const opponentName=String(e.opponent||'ADVERSÁRIO').toUpperCase();
  x.fillText(opponentName.length>18 ? opponentName.slice(0,18) : opponentName,820,1045);

  x.fillStyle='rgba(0,12,28,.86)';
  x.roundRect(145,1310,790,340,28);
  x.fill();

  x.fillStyle='#ffffff';
  x.font='bold 42px Arial';
  x.fillText(`${formatDate(e.date)} • ${e.time}`,540,1410);

  x.fillStyle='#14a8f5';
  x.font='bold 30px Arial';
  x.fillText('LOCAL DA PARTIDA',540,1490);

  x.fillStyle='#ffffff';
  x.font='30px Arial';
  const location=String(e.location||'').toUpperCase();
  x.fillText(location.length>34 ? location.slice(0,34) : location,540,1545);

  x.fillStyle='#14a8f5';
  x.font='bold 24px Arial';
  x.fillText('DISCIPLINA • UNIÃO • PAIXÃO',540,1770);

  x.fillStyle='#ffffff';
  x.font='20px Arial';
  x.fillText('JOGO A JOGO, SONHO A SONHO.',540,1810);

  downloadCanvas(
    c,
    `pandas-fc-x-${e.opponent.replace(/\s+/g,'-').toLowerCase()}.png`
  );
}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
function drawContain(ctx,img,x,y,w,h){const r=Math.min(w/img.width,h/img.height),nw=img.width*r,nh=img.height*r;ctx.drawImage(img,x+(w-nw)/2,y+(h-nh)/2,nw,nh);}



let selectedStatsSeason="";
function eventSeason(e){const m=String(e?.date||"").match(/^(\d{4})-/);return m?m[1]:"";}
function availableStatsSeasons(){return [...new Set(state.events.map(eventSeason).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));}
function ensureStatsSeason(){
 const seasons=availableStatsSeasons();
 if(!selectedStatsSeason||(selectedStatsSeason!=="all"&&!seasons.includes(selectedStatsSeason))){
   const current=String(new Date().getFullYear());
   selectedStatsSeason=seasons.includes(current)?current:(seasons[0]||"all");
 }
 return selectedStatsSeason;
}
function renderStatsSeasonSelect(){
 const el=document.getElementById("statsSeasonSelect");if(!el)return;
 const seasons=availableStatsSeasons();ensureStatsSeason();
 el.innerHTML=seasons.map(y=>`<option value="${y}">${y}</option>`).join("")+'<option value="all">Todas</option>';
 el.value=selectedStatsSeason;
}
function statsSeasonLabel(){return ensureStatsSeason()==="all"?"Todas as temporadas":`Temporada ${selectedStatsSeason}`;}
function eventsForSelectedStatsSeason(){const s=ensureStatsSeason();return state.events.filter(e=>s==="all"||eventSeason(e)===s);}

function calculateStatsData(){
  const done=eventsForSelectedStatsSeason().filter(e=>e.goalsFor!==''&&e.goalsAgainst!=='');
  let wins=0,draws=0,losses=0,gf=0,ga=0;

  done.forEach(e=>{
    const a=Number(e.goalsFor), b=Number(e.goalsAgainst);
    gf+=a; ga+=b;
    if(a>b)wins++;
    else if(a<b)losses++;
    else draws++;
  });

  const points=wins*3+draws;
  const performance=done.length
    ? Math.round((points/(done.length*3))*100)
    : 0;

  return {
    done,wins,draws,losses,gf,ga,
    balance:gf-ga,
    points,
    performance
  };
}

function pdfSafe(value){
  return String(value??"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^\x20-\x7E]/g," ");
}

function pdfEscape(value){
  return pdfSafe(value)
    .replace(/\\/g,"\\\\")
    .replace(/\(/g,"\\(")
    .replace(/\)/g,"\\)");
}

function pdfText(x,y,size,text,bold=false){
  return `BT /${bold?"F2":"F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET\n`;
}

function pdfRect(x,y,w,h,fillGray=0.95){
  const g=Math.max(0,Math.min(1,fillGray));
  return `${g} g ${x} ${y} ${w} ${h} re f\n0 g\n`;
}

function buildNativePdf(pages){
  /*
   * Gerador PDF mínimo e autocontido.
   * Usa somente caracteres ASCII/Helvetica, evitando qualquer CDN.
   */
  const objects=[];
  const add=obj=>{
    objects.push(obj);
    return objects.length;
  };

  const fontRegular=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  // Reservamos o objeto Pages; ele será preenchido depois.
  const pagesObjectIndex=add("");

  const pageObjectNumbers=[];

  pages.forEach(content=>{
    const stream=`<< /Length ${content.length} >>\nstream\n${content}endstream`;
    const contentObj=add(stream);

    const pageObj=add(
      `<< /Type /Page /Parent ${pagesObjectIndex} 0 R `+
      `/MediaBox [0 0 595 842] `+
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> `+
      `/Contents ${contentObj} 0 R >>`
    );

    pageObjectNumbers.push(pageObj);
  });

  objects[pagesObjectIndex-1]=
    `<< /Type /Pages /Kids [${pageObjectNumbers.map(n=>`${n} 0 R`).join(" ")}] `+
    `/Count ${pageObjectNumbers.length} >>`;

  const catalog=add(`<< /Type /Catalog /Pages ${pagesObjectIndex} 0 R >>`);

  let pdf="%PDF-1.4\n";
  const offsets=[0];

  objects.forEach((obj,i)=>{
    offsets.push(pdf.length);
    pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n`;
  pdf+="0000000000 65535 f \n";

  for(let i=1;i<offsets.length;i++){
    pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";
  }

  pdf+=
    `trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\n`+
    `startxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf],{type:"application/pdf"});
}

function buildStatsPdfPages(){
  const stats=calculateStatsData();
  const pages=[];
  let content="";
  let y=800;

  function newPage(){
    if(content)pages.push(content);
    content="";
    y=800;

    content+=pdfRect(0,808,595,34,0.12);
    content+=`1 g\n`;
    content+=pdfText(38,825,18,"PANDAS FC",true);
    content+=pdfText(38,812,9,`RELATORIO DE ESTATISTICAS - ${statsSeasonLabel().toUpperCase()}`,false);
    content+=`0 g\n`;
    y=780;
  }

  function ensureSpace(height=24){
    if(y-height<40)newPage();
  }

  function line(text,size=10,bold=false,indent=0){
    ensureSpace(size+10);
    content+=pdfText(40+indent,y,size,text,bold);
    y-=size+6;
  }

  function separator(){
    ensureSpace(10);
    content+="0.82 G 40 "+(y+2)+" m 555 "+(y+2)+" l S\n0 G\n";
    y-=10;
  }

  newPage();

  line("Dashboard geral",14,true);
  y-=2;

  const summaries=[
    `Jogos finalizados: ${stats.done.length}`,
    `Vitorias: ${stats.wins}`,
    `Empates: ${stats.draws}`,
    `Derrotas: ${stats.losses}`,
    `Gols marcados: ${stats.gf}`,
    `Gols sofridos: ${stats.ga}`,
    `Saldo de gols: ${stats.balance}`,
    `Aproveitamento: ${stats.performance}%`
  ];

  // Quadro visual simples 2 colunas.
  let sx=40, sy=y;
  summaries.forEach((text,idx)=>{
    const col=idx%2;
    const row=Math.floor(idx/2);
    const x=40+col*255;
    const yy=sy-row*36;

    content+=pdfRect(x,yy-21,235,28,0.95);
    content+=pdfText(x+8,yy-5,10,text,idx<4);
  });

  y=sy-4*36-8;
  separator();

  line("Resumo dos resultados",12,true);

  const total=Math.max(1,stats.done.length);
  const bars=[
    ["Vitorias",stats.wins],
    ["Empates",stats.draws],
    ["Derrotas",stats.losses]
  ];

  bars.forEach(([label,value])=>{
    ensureSpace(28);
    content+=pdfText(40,y,9,`${label}: ${value}`,false);
    const barX=135, barY=y-1, barW=390, barH=8;
    content+=pdfRect(barX,barY,barW,barH,0.92);
    const filled=Math.max(0,barW*(value/total));
    if(filled>0){
      content+=`0.35 g ${barX} ${barY} ${filled} ${barH} re f\n0 g\n`;
    }
    y-=22;
  });

  separator();
  line("Historico de jogos",12,true);

  const history=[...stats.done].sort(
    (a,b)=>(b.date+b.time).localeCompare(a.date+a.time)
  );

  if(!history.length){
    line("Nenhuma partida finalizada.",9,false);
  }else{
    history.forEach((e,index)=>{
      ensureSpace(38);

      const result=statusOf(e);
      content+=pdfRect(40,y-18,515,26,index%2===0?0.97:0.93);
      content+=pdfText(
        48,y-4,9,
        `PANDAS FC ${e.goalsFor} x ${e.goalsAgainst} ${e.opponent}`,
        true
      );
      content+=pdfText(
        48,y-14,7.5,
        `${formatDate(e.date)} | ${result}`,
        false
      );
      y-=32;
    });
  }

  ensureSpace(90);
  separator();
  line("Artilharia atual",12,true);

  const scorers=[...state.players]
    .filter(p=>Number(p.goals||0)>0)
    .sort((a,b)=>(b.goals||0)-(a.goals||0));

  if(!scorers.length){
    line("Nenhum gol registrado para jogadores.",9,false);
  }else{
    scorers.forEach((p,i)=>{
      line(`${i+1}. #${p.number} ${p.name} - ${p.goals||0} gol(s)`,9,false);
    });
  }

  ensureSpace(50);
  separator();
  line(
    `Gerado em ${new Date().toLocaleString("pt-BR")} - PANDAS FC`,
    7.5,
    false
  );

  if(content)pages.push(content);
  return pages;
}

async function generateStatisticsPdf(){
  const button=document.getElementById("generateStatsPdf");
  const oldText=button?.textContent||"📄 Gerar PDF";

  try{
    if(button){
      button.disabled=true;
      button.textContent="Gerando PDF...";
    }

    const pages=buildStatsPdfPages();
    const blob=buildNativePdf(pages);
    const url=URL.createObjectURL(blob);

    const filename=
      `pandas-fc-estatisticas-${selectedStatsSeason==="all"?"todas":selectedStatsSeason}-${new Date().toISOString().slice(0,10)}.pdf`;

    const link=document.createElement("a");
    link.href=url;
    link.download=filename;
    link.style.display="none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    /*
     * No Android/PWA o download pode ser processado de forma assíncrona.
     * Mantemos a URL viva por alguns segundos antes de liberar.
     */
    setTimeout(()=>URL.revokeObjectURL(url),15000);

    toast("PDF gerado. Verifique seus Downloads.");
  }catch(err){
    console.error("PDF Estatísticas:",err);
    toast("Não foi possível gerar o PDF.");
  }finally{
    if(button){
      button.disabled=false;
      button.textContent=oldText;
    }
  }
}


function renderStats(){
 renderStatsSeasonSelect();
 const done=eventsForSelectedStatsSeason().filter(e=>e.goalsFor!==''&&e.goalsAgainst!=='');let w=0,d=0,l=0,gf=0,ga=0;
 done.forEach(e=>{const a=Number(e.goalsFor),b=Number(e.goalsAgainst);gf+=a;ga+=b;if(a>b)w++;else if(a<b)l++;else d++;});
 const pts=w*3+d,ap=done.length?Math.round((pts/(done.length*3))*100):0;
 const cards=[['Jogos',done.length],['Vitórias',w],['Empates',d],['Derrotas',l],['Gols marcados',gf],['Gols sofridos',ga],['Saldo',gf-ga],['Aproveitamento',ap+'%']];
 document.getElementById('statsCards').innerHTML=cards.map(([a,b])=>`<div class="stat-card"><span>${a}</span><strong>${b}</strong></div>`).join('');
 document.getElementById('historyList').innerHTML=done.length?[...done].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(e=>`<div class="list-row"><div><strong>PANDAS FC ${e.goalsFor} × ${e.goalsAgainst} ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)}</div></div><span class="status ${statusOf(e)==='VITÓRIA'?'win':statusOf(e)==='DERROTA'?'loss':'draw'}">${statusOf(e)}</span></div>`).join(''):'<p class="muted">Nenhuma partida finalizada.</p>';
}
function renderScorers(){
 const arr=[...state.players].sort((a,b)=>(b.goals||0)-(a.goals||0)||String(a.name||'').localeCompare(String(b.name||'')));
 document.getElementById('scorersList').innerHTML=arr.length?arr.map((p,i)=>`<div class="list-row"><div style="display:flex;align-items:center;gap:12px"><div class="rank-badge">${i+1}</div><div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div></div><label>Gols <input class="goal-input" type="number" min="0" value="${p.goals||0}" ${isDirector()?'':'disabled'} onchange="setGoals('${p.id}',this.value)"></label></div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}
async function setGoals(id,v){if(!requireDirector()){renderScorers();return;}try{markWriting();await setDoc(doc(db,"players",id),{goals:Math.max(0,Number(v)||0),updatedAt:serverTimestamp()},{merge:true});}catch(err){syncError(err);}}

let calDate=new Date();document.getElementById('prevMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()-1);renderCalendar();};document.getElementById('nextMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()+1);renderCalendar();};
function renderCalendar(){
 const y=calDate.getFullYear(),m=calDate.getMonth();document.getElementById('calendarTitle').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calDate);
 const root=document.getElementById('calendar');const dows=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];let html=dows.map(d=>`<div class="dow">${d}</div>`).join('');
 const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();for(let i=0;i<first;i++)html+='<div></div>';
 for(let d=1;d<=days;d++){const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const ev=state.events.some(e=>e.date===ds);html+=`<div class="day ${ev?'has-event':''}" title="${ev?'Há partida neste dia':''}">${d}</div>`;}root.innerHTML=html;
}

document.getElementById('teamLogoInput').addEventListener('change',async e=>{
  if(!requireDirector()){ e.target.value=''; return; }
  const f=e.target.files[0];if(!f)return;
  try{
    const logo=await fileToCompressedDataURL(f,600,.75);
    markWriting();
    await setDoc(doc(db,"settings","team"),{teamLogo:logo,updatedAt:serverTimestamp()},{merge:true});
    toast('Logo atualizada e sincronizada.');
  }catch(err){syncError(err);}
});
function renderLogo(){
  const img=document.getElementById('dashboardLogo');
  const ph=document.getElementById('dashboardPlaceholder');
  const headerImg=document.getElementById('headerLogo');
  const headerFallback=document.getElementById('headerLogoFallback');

  if(headerImg && state.teamLogo){
    headerImg.src=state.teamLogo;
    headerImg.classList.remove('hidden');
    if(headerFallback) headerFallback.classList.add('hidden');
  }else{
    if(headerImg) headerImg.classList.add('hidden');
    if(headerFallback) headerFallback.classList.remove('hidden');
  }

  if(state.dashboardMedia?.data || state.dashboardMedia?.url){
    img.classList.add('hidden');
    ph.classList.add('hidden');
    return;
  }

  if(state.teamLogo){
    img.src=state.teamLogo;
    img.classList.remove('hidden');
    ph.classList.add('hidden');
  }else{
    img.classList.add('hidden');
    ph.classList.remove('hidden');
  }
}



let dashboardYoutubePlayer=null;
let dashboardYoutubeAudioTimer=null;
let dashboardMusicWasPlaying=false;
let dashboardPausedPandasMusic=false;

function pausePandasMusicForDashboard(){
  if(customAnnouncementAudio){
    // Avisos internos têm prioridade; não são interrompidos pelo Dashboard.
    return;
  }

  if(isYoutubePlaying()){
    dashboardMusicWasPlaying=true;
    dashboardPausedPandasMusic=true;
    try{youtubeMusicPlayer?.pauseVideo?.();}catch{}
    updateMusicPlayerUI();
  }
}

function resumePandasMusicAfterDashboard(){
  if(!dashboardPausedPandasMusic)return;

  dashboardPausedPandasMusic=false;
  const shouldResume=dashboardMusicWasPlaying;
  dashboardMusicWasPlaying=false;

  if(shouldResume && !customAnnouncementAudio){
    setTimeout(()=>playYoutubeMusic().catch(()=>{}),180);
  }
}

function cleanupDashboardYoutubePlayer(){
  if(dashboardYoutubeAudioTimer){
    clearInterval(dashboardYoutubeAudioTimer);
    dashboardYoutubeAudioTimer=null;
  }

  if(dashboardYoutubePlayer){
    try{dashboardYoutubePlayer.destroy?.();}catch{}
    dashboardYoutubePlayer=null;
  }

  resumePandasMusicAfterDashboard();
}

function checkDashboardYoutubeAudio(){
  if(!dashboardYoutubePlayer || !window.YT)return;

  try{
    const stateNow=dashboardYoutubePlayer.getPlayerState?.();
    const playing=stateNow===window.YT.PlayerState.PLAYING;
    const audible=playing &&
      !dashboardYoutubePlayer.isMuted?.() &&
      Number(dashboardYoutubePlayer.getVolume?.()||0)>0;

    if(audible){
      pausePandasMusicForDashboard();
    }else{
      resumePandasMusicAfterDashboard();
    }
  }catch{}
}

async function attachDashboardYoutubeController(){
  const frame=document.getElementById("dashboardMediaFrame");
  if(!frame || frame.classList.contains("hidden") || !frame.src)return;

  try{
    const YT=await loadYoutubeIframeAPI();

    // Se a mídia mudou enquanto a API carregava, não cria player no iframe antigo.
    if(!frame.src || frame.classList.contains("hidden"))return;

    dashboardYoutubePlayer=new YT.Player(frame,{
      events:{
        onReady:()=>{
          if(dashboardYoutubeAudioTimer)clearInterval(dashboardYoutubeAudioTimer);
          dashboardYoutubeAudioTimer=setInterval(checkDashboardYoutubeAudio,500);
          checkDashboardYoutubeAudio();
        },
        onStateChange:event=>{
          if(
            event.data===YT.PlayerState.PAUSED ||
            event.data===YT.PlayerState.ENDED ||
            event.data===YT.PlayerState.CUED
          ){
            resumePandasMusicAfterDashboard();
          }else{
            setTimeout(checkDashboardYoutubeAudio,80);
          }
        },
        onError:()=>{
          resumePandasMusicAfterDashboard();
        }
      }
    });
  }catch(err){
    console.warn("Dashboard YouTube controller:",err);
  }
}

function youtubeEmbedUrl(url){
  try{
    const u=new URL(url);
    let id="";
    if(u.hostname.includes("youtu.be")){
      id=u.pathname.split("/").filter(Boolean)[0]||"";
    }else if(u.hostname.includes("youtube.com")){
      if(u.pathname.startsWith("/watch")) id=u.searchParams.get("v")||"";
      else if(u.pathname.startsWith("/shorts/")) id=u.pathname.split("/")[2]||"";
      else if(u.pathname.startsWith("/embed/")) id=u.pathname.split("/")[2]||"";
    }
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}` : "";
  }catch{return "";}
}

function showDashboardMediaError(message){
  const box=document.getElementById('dashboardMediaError');
  if(!box) return;
  box.textContent=message;
  box.classList.remove('hidden');
}

function renderDashboardMedia(){
  cleanupDashboardYoutubePlayer();

  const img=document.getElementById('dashboardMediaImage');
  const video=document.getElementById('dashboardMediaVideo');
  const frame=document.getElementById('dashboardMediaFrame');
  const errorBox=document.getElementById('dashboardMediaError');
  const logo=document.getElementById('dashboardLogo');
  const ph=document.getElementById('dashboardPlaceholder');
  if(!img || !video || !frame) return;

  img.classList.add('hidden');
  video.classList.add('hidden');
  frame.classList.add('hidden');
  if(errorBox){ errorBox.classList.add('hidden'); errorBox.textContent=''; }

  video.pause();
  video.removeAttribute('src');
  video.load();
  frame.removeAttribute('src');
  img.removeAttribute('src');

  const media=state.dashboardMedia || {};
  const src=media.data || media.url || '';

  if(!src){
    renderLogo();
    return;
  }

  logo.classList.add('hidden');
  ph.classList.add('hidden');

  const type=(media.type || '').toLowerCase();
  const mode=(media.urlMode || 'auto').toLowerCase();

  let isYoutube = mode==='youtube';
  let isVideo = mode==='video';
  let isImage = mode==='image';

  if(mode==='auto'){
    isYoutube = /(?:youtube\.com|youtu\.be)/i.test(src);
    isVideo = type.startsWith('video/') || /\.(mp4|webm|mov)(?:\?|#|$)/i.test(src);
    isImage = type.startsWith('image/') || /\.(png|gif|jpg|jpeg|webp)(?:\?|#|$)/i.test(src);
    if(!isYoutube && !isVideo && !isImage){
      // Unknown URL: try as image first because image errors are fast.
      isImage = true;
    }
  }

  if(isYoutube){
    const embed=youtubeEmbedUrl(src);
    if(!embed){
      showDashboardMediaError('Não consegui reconhecer esse link do YouTube. Use um link como youtube.com/watch?v=... ou youtu.be/...');
      return;
    }
    frame.src=embed;
    frame.classList.remove('hidden');
    // O vídeo do Dashboard começa mudo. Se o usuário ativar o som,
    // o PANDAS MUSIC pausa e volta quando o vídeo for pausado/mutado.
    setTimeout(()=>attachDashboardYoutubeController(),250);
    return;
  }

  if(isVideo){
    video.onerror=()=>{
      video.classList.add('hidden');
      showDashboardMediaError('O vídeo não pôde ser reproduzido. Para URL, use um link direto para arquivo MP4/WebM (o endereço normalmente termina em .mp4 ou .webm), ou selecione YouTube quando for um link do YouTube.');
    };
    const syncDashboardVideoAudio=()=>{
      const audible=!video.paused && !video.muted && Number(video.volume||0)>0;
      if(audible) pausePandasMusicForDashboard();
      else resumePandasMusicAfterDashboard();
    };

    video.onplay=syncDashboardVideoAudio;
    video.onpause=()=>resumePandasMusicAfterDashboard();
    video.onended=()=>resumePandasMusicAfterDashboard();
    video.onvolumechange=syncDashboardVideoAudio;

    video.oncanplay=()=>{
      if(errorBox) errorBox.classList.add('hidden');
      video.play().catch(()=>{});
      setTimeout(syncDashboardVideoAudio,100);
    };
    video.src=src;
    video.classList.remove('hidden');
    video.load();
    return;
  }

  img.onerror=()=>{
    img.classList.add('hidden');
    showDashboardMediaError('A imagem/GIF não pôde ser carregada. Se estiver usando uma URL, ela precisa apontar diretamente para a imagem/GIF. Se o link for de vídeo, selecione “Vídeo MP4 / WebM” ou “YouTube”.');
  };
  img.onload=()=>{ if(errorBox) errorBox.classList.add('hidden'); };
  img.src=src;
  img.classList.remove('hidden');
}


/* =========================================================
   v44 — Upload de foto/vídeo da galeria via Cloudinary
   Mantém todas as formas anteriores de mídia.
   ========================================================= */
const PANDAS_CLOUDINARY_CLOUD_NAME="csv4tgul";
const PANDAS_CLOUDINARY_UPLOAD_PRESET="pandas_fc_media";
let dashboardCloudinaryFile=null;

function formatMediaFileSize(bytes){
  const mb=Number(bytes||0)/(1024*1024);
  return mb<1?`${Math.max(1,Math.round(Number(bytes||0)/1024))} KB`:`${mb.toFixed(mb>=10?1:2)} MB`;
}

function setDashboardUploadProgress(percent,text=""){
  const wrap=document.getElementById("dashboardUploadProgressWrap");
  const bar=document.getElementById("dashboardUploadProgressBar");
  const label=document.getElementById("dashboardUploadProgressText");
  if(wrap)wrap.classList.remove("hidden");
  if(bar)bar.style.width=`${Math.max(0,Math.min(100,percent))}%`;
  if(label)label.textContent=text||`${Math.round(percent)}%`;
}

document.getElementById("dashboardCloudinaryInput")?.addEventListener("change",event=>{
  if(!requireDirector()){event.target.value="";return;}
  const file=event.target.files?.[0]||null;
  dashboardCloudinaryFile=file;

  const info=document.getElementById("dashboardCloudinaryFileInfo");
  const button=document.getElementById("uploadDashboardCloudinary");
  const wrap=document.getElementById("dashboardUploadProgressWrap");
  const progressText=document.getElementById("dashboardUploadProgressText");

  if(wrap)wrap.classList.add("hidden");
  if(progressText)progressText.textContent="";

  if(!file){
    if(info)info.textContent="Nenhum arquivo selecionado.";
    if(button)button.disabled=true;
    return;
  }

  if(!file.type.startsWith("image/")&&!file.type.startsWith("video/")){
    alert("Selecione uma foto ou vídeo da galeria.");
    event.target.value="";
    dashboardCloudinaryFile=null;
    if(info)info.textContent="Nenhum arquivo selecionado.";
    if(button)button.disabled=true;
    return;
  }

  if(info){
    info.textContent=`${file.name} • ${file.type.startsWith("video/")?"Vídeo":"Imagem"} • ${formatMediaFileSize(file.size)}`;
  }
  if(button)button.disabled=false;
});

function uploadDashboardFileToCloudinary(file){
  return new Promise((resolve,reject)=>{
    const endpoint=
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(PANDAS_CLOUDINARY_CLOUD_NAME)}/auto/upload`;

    const form=new FormData();
    form.append("file",file);
    form.append("upload_preset",PANDAS_CLOUDINARY_UPLOAD_PRESET);

    const xhr=new XMLHttpRequest();
    xhr.open("POST",endpoint,true);
    xhr.responseType="json";

    xhr.upload.onprogress=event=>{
      if(!event.lengthComputable)return;
      const percent=(event.loaded/event.total)*100;
      setDashboardUploadProgress(percent,`Enviando... ${Math.round(percent)}%`);
    };

    xhr.onerror=()=>reject(new Error("Falha de conexão durante o upload para o Cloudinary."));
    xhr.onabort=()=>reject(new Error("Upload cancelado."));
    xhr.onload=()=>{
      const response=xhr.response || (()=>{try{return JSON.parse(xhr.responseText||"{}");}catch{return {};}})();
      if(xhr.status>=200&&xhr.status<300&&response?.secure_url){
        resolve(response);
        return;
      }
      reject(new Error(response?.error?.message||`Cloudinary retornou HTTP ${xhr.status}.`));
    };

    xhr.send(form);
  });
}

document.getElementById("uploadDashboardCloudinary")?.addEventListener("click",async()=>{
  if(!requireDirector())return;
  const file=dashboardCloudinaryFile;
  if(!file){
    alert("Primeiro escolha uma foto ou vídeo da galeria.");
    return;
  }

  const button=document.getElementById("uploadDashboardCloudinary");
  const input=document.getElementById("dashboardCloudinaryInput");

  try{
    button.disabled=true;
    button.textContent="☁️ Enviando...";
    setDashboardUploadProgress(0,"Preparando upload...");

    const uploaded=await uploadDashboardFileToCloudinary(file);
    setDashboardUploadProgress(100,"Upload concluído. Publicando no Dashboard...");

    const isVideo=
      uploaded.resource_type==="video" ||
      file.type.startsWith("video/");

    markWriting();
    await setDoc(doc(db,"settings","dashboard"),{
      mediaType:isVideo?"video/remote":"image/remote",
      mediaData:"",
      mediaUrl:uploaded.secure_url,
      urlMode:isVideo?"video":"image",
      cloudinaryPublicId:uploaded.public_id||"",
      cloudinaryResourceType:uploaded.resource_type||"",
      originalFileName:file.name||"",
      updatedAt:serverTimestamp()
    },{merge:true});

    const urlInput=document.getElementById("dashboardMediaUrl");
    const typeSelect=document.getElementById("dashboardMediaUrlType");
    if(urlInput)urlInput.value=uploaded.secure_url;
    if(typeSelect)typeSelect.value=isVideo?"video":"image";

    toast("Mídia enviada e publicada no Dashboard.");
    setDashboardUploadProgress(100,"✅ Publicado no Dashboard para todos os usuários.");

    dashboardCloudinaryFile=null;
    if(input)input.value="";
    const info=document.getElementById("dashboardCloudinaryFileInfo");
    if(info)info.textContent="Nenhum arquivo selecionado.";
  }catch(err){
    console.error("Cloudinary Dashboard:",err);
    setDashboardUploadProgress(0,`❌ ${err?.message||"Falha no upload."}`);
    toast("Não foi possível enviar a mídia.");
  }finally{
    button.disabled=!dashboardCloudinaryFile;
    button.textContent="☁️ Enviar e publicar no Dashboard";
  }
});


document.getElementById('dashboardMediaInput').addEventListener('change', async e=>{
  if(!requireDirector()){ e.target.value=''; return; }
  const file=e.target.files?.[0];
  if(!file) return;

  const allowed=['image/png','image/gif','video/mp4','video/webm'];
  if(!allowed.includes(file.type)){
    alert('Formato não suportado. Use PNG, GIF, MP4 ou WebM.');
    e.target.value='';
    return;
  }

  if(file.size > 700 * 1024){
    alert('Esse arquivo é maior que 700 KB. O Firestore não é indicado para armazenar vídeos grandes. Para vídeos maiores, use uma URL direta para MP4/WebM ou um link do YouTube.');
    e.target.value='';
    return;
  }

  try{
    markWriting();
    const data=await fileToDataURL(file);
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:file.type,
      mediaData:data,
      mediaUrl:'',
      urlMode:file.type.startsWith('video/') ? 'video' : 'image',
      updatedAt:serverTimestamp()
    },{merge:true});
    document.getElementById('dashboardMediaUrl').value='';
    toast('Mídia do Dashboard atualizada e sincronizada.');
  }catch(err){syncError(err);}
});

document.getElementById('saveDashboardMediaUrl').onclick=async()=>{
  if(!requireDirector()) return;
  const url=document.getElementById('dashboardMediaUrl').value.trim();
  const mode=document.getElementById('dashboardMediaUrlType').value || 'auto';

  if(!url){
    alert('Informe uma URL.');
    return;
  }

  try{ new URL(url); }
  catch{
    alert('A URL informada não é válida.');
    return;
  }

  const lower=url.toLowerCase();
  let type='remote/auto';

  if(mode==='video') type='video/remote';
  else if(mode==='image') type='image/remote';
  else if(mode==='youtube') type='video/youtube';
  else{
    if(/(?:youtube\.com|youtu\.be)/i.test(lower)) type='video/youtube';
    else if(/\.(mp4)(?:\?|#|$)/i.test(lower)) type='video/mp4';
    else if(/\.(webm)(?:\?|#|$)/i.test(lower)) type='video/webm';
    else if(/\.(gif)(?:\?|#|$)/i.test(lower)) type='image/gif';
    else if(/\.(png)(?:\?|#|$)/i.test(lower)) type='image/png';
    else if(/\.(jpe?g|webp)(?:\?|#|$)/i.test(lower)) type='image/remote';
  }

  try{
    markWriting();
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:type,
      mediaData:'',
      mediaUrl:url,
      urlMode:mode,
      updatedAt:serverTimestamp()
    },{merge:true});
    toast('URL do Dashboard salva e sincronizada.');
  }catch(err){syncError(err);}
};

document.getElementById('removeDashboardMedia').onclick=async()=>{
  if(!requireDirector()) return;
  if(!confirm('Remover a mídia do Início / Dashboard em todos os dispositivos?')) return;
  try{
    markWriting();
    await setDoc(doc(db,'settings','dashboard'),{
      mediaType:'',
      mediaData:'',
      mediaUrl:'',
      urlMode:'auto',
      updatedAt:serverTimestamp()
    },{merge:true});
    document.getElementById('dashboardMediaUrl').value='';
    document.getElementById('dashboardMediaUrlType').value='auto';
    toast('Mídia removida.');
  }catch(err){syncError(err);}
};

document.getElementById('clearDataBtn').onclick=async()=>{
  if(!requireDirector()) return;
  if(!confirm('Apagar jogadores, partidas, escalação e logo do Firebase? Isso afetará todos os dispositivos.'))return;
  try{
    markWriting();
    const ps=await getDocs(collection(db,"players"));
    await Promise.all(ps.docs.map(d=>deleteDoc(d.ref)));
    const es=await getDocs(collection(db,"events"));
    await Promise.all(es.docs.map(d=>deleteDoc(d.ref)));
    await deleteDoc(doc(db,"settings","team")).catch(()=>{});
    await deleteDoc(doc(db,"settings","dashboard")).catch(()=>{});
    await deleteDoc(doc(db,"lineup","current")).catch(()=>{});
    toast('Dados do Firebase apagados.');
  }catch(err){syncError(err);}
};

document.getElementById('migrateBtn').onclick=async()=>{
  if(!requireDirector()) return;
  const raw=localStorage.getItem('pandasfc_data_v4');
  if(!raw){alert('Não encontrei dados antigos salvos neste navegador.');return;}
  if(!confirm('Importar os dados antigos deste dispositivo para o Firebase?'))return;
  try{
    const old=JSON.parse(raw);
    markWriting();
    for(const p of old.players||[]){
      await setDoc(doc(db,"players",p.id||uid()),{
        name:p.name||'',position:p.position||'',number:Number(p.number)||0,goals:Number(p.goals)||0,updatedAt:serverTimestamp()
      },{merge:true});
    }
    for(const e of old.events||[]){
      await setDoc(doc(db,"events",e.id||uid()),{
        opponent:e.opponent||'',logo:e.logo||'',date:e.date||'',time:e.time||'',location:e.location||'',
        goalsFor:e.goalsFor??'',goalsAgainst:e.goalsAgainst??'',updatedAt:serverTimestamp()
      },{merge:true});
    }
    if(old.teamLogo) await setDoc(doc(db,"settings","team"),{teamLogo:old.teamLogo,updatedAt:serverTimestamp()},{merge:true});
    if(old.selectedLineup) await setDoc(doc(db,"lineup","current"),{playerIds:old.selectedLineup,updatedAt:serverTimestamp()},{merge:true});
    toast('Dados antigos importados para o Firebase.');
  }catch(err){syncError(err);}
};

const notifyBtn=document.getElementById('notifyBtn');
const pushStatus=document.getElementById('pushStatus');

const diagEls={
  permission:document.getElementById('diagPermission'),
  oneSignal:document.getElementById('diagOneSignal'),
  optedIn:document.getElementById('diagOptedIn'),
  subscriptionId:document.getElementById('diagSubscriptionId'),
  pushToken:document.getElementById('diagPushToken'),
  browserPush:document.getElementById('diagBrowserPush'),
  serviceWorker:document.getElementById('diagServiceWorker'),
  workerScope:document.getElementById('diagWorkerScope'),
  message:document.getElementById('diagMessage')
};

function setPushStatus(text,type=''){
  if(!pushStatus)return;
  pushStatus.textContent=text;
  pushStatus.className=`push-status ${type}`.trim();
}
function setDiag(el,value,type=''){
  if(!el)return;
  el.textContent=value;
  el.className=type;
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function getBrowserPushInfo(){
  const result={hasRegistration:false,hasSubscription:false,scriptURL:'',scope:''};
  if(!('serviceWorker' in navigator))return result;
  try{
    const regs=await navigator.serviceWorker.getRegistrations();
    const reg=
      regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
      regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
      null;
    if(reg){
      result.hasRegistration=true;
      result.scope=reg.scope||'';
      result.scriptURL=reg.active?.scriptURL||reg.waiting?.scriptURL||reg.installing?.scriptURL||'';
      try{ result.hasSubscription=!!(await reg.pushManager.getSubscription()); }catch{}
    }
  }catch(err){ console.warn('Diagnóstico SW:',err); }
  return result;
}

async function getPushDiagnostic(){
  const browserPermission=('Notification' in window)?Notification.permission:'unsupported';
  const OneSignal=window.PandasOneSignal;
  const browserPush=await getBrowserPushInfo();
  let optedIn=false, subscriptionId='', token='';
  if(OneSignal){
    try{
      optedIn=!!OneSignal.User.PushSubscription.optedIn;
      subscriptionId=OneSignal.User.PushSubscription.id||'';
      token=OneSignal.User.PushSubscription.token||'';
    }catch(err){ console.warn('Leitura OneSignal:',err); }
  }
  return {browserPermission,oneSignalLoaded:!!OneSignal,optedIn,subscriptionId,token,...browserPush};
}

async function renderPushDiagnostic(){
  const d=await getPushDiagnostic();

  setDiag(diagEls.permission,
    d.browserPermission==='granted'?'GRANTED ✅':
    d.browserPermission==='denied'?'BLOQUEADA ❌':
    d.browserPermission==='default'?'AGUARDANDO ⚠️':'NÃO SUPORTADO ❌',
    d.browserPermission==='granted'?'diag-ok':'diag-bad');

  setDiag(diagEls.oneSignal,d.oneSignalLoaded?'SIM ✅':'NÃO ❌',d.oneSignalLoaded?'diag-ok':'diag-bad');
  setDiag(diagEls.optedIn,
    d.optedIn&&d.subscriptionId?'SIM ✅':
    d.optedIn&&!d.subscriptionId?'INCONSISTENTE ⚠️':'NÃO ❌',
    d.optedIn&&d.subscriptionId?'diag-ok':'diag-bad');

  setDiag(diagEls.subscriptionId,d.subscriptionId||'NENHUM ❌',
    d.subscriptionId?'diag-ok diagnostic-value':'diag-bad diagnostic-value');
  setDiag(diagEls.pushToken,d.token?'DISPONÍVEL ✅':'NENHUM ❌',d.token?'diag-ok':'diag-bad');
  setDiag(diagEls.browserPush,d.hasSubscription?'EXISTE ✅':'NÃO EXISTE ❌',d.hasSubscription?'diag-ok':'diag-bad');
  setDiag(diagEls.serviceWorker,
    d.hasRegistration?(d.scriptURL?d.scriptURL.split('/').pop()+' ✅':'REGISTRADO ✅'):'NÃO REGISTRADO ❌',
    d.hasRegistration?'diag-ok diagnostic-value':'diag-bad');
  setDiag(diagEls.workerScope,d.scope||'NENHUM',d.scope?'diagnostic-value':'diag-bad');

  if(diagEls.message){
    if(d.browserPermission==='granted'&&d.optedIn&&d.subscriptionId&&d.hasSubscription){
      diagEls.message.textContent='✅ Push está completamente inscrito.';
      diagEls.message.className='push-status ok';
    }else if(d.browserPermission==='granted'&&!d.subscriptionId){
      diagEls.message.textContent='⚠️ O navegador permite notificações, mas não existe Subscription ID no OneSignal.';
      diagEls.message.className='push-status err';
    }else{
      diagEls.message.textContent='Use “Recriar inscrição Push” para tentar corrigir.';
      diagEls.message.className='push-status';
    }
  }
  return d;
}

async function refreshPushStatus(){
  const d=await renderPushDiagnostic();
  if(d.browserPermission==='granted'&&d.optedIn&&d.subscriptionId){
    setPushStatus('✅ Notificações push realmente inscritas','ok');
    if(notifyBtn)notifyBtn.textContent='🔔 Notificações ativadas';
  }else if(d.browserPermission==='denied'){
    setPushStatus('🚫 Notificações bloqueadas no navegador','err');
    if(notifyBtn)notifyBtn.textContent='🔕 Notificações bloqueadas';
  }else if(d.oneSignalLoaded&&d.browserPermission==='granted'&&!d.subscriptionId){
    setPushStatus('⚠️ Permitido, mas sem inscrição no OneSignal','err');
    if(notifyBtn)notifyBtn.textContent='🛠️ Criar inscrição Push';
  }else{
    setPushStatus('🔔 Toque para permitir/inscrever notificações');
    if(notifyBtn)notifyBtn.textContent='🔔 Ativar notificações';
  }
}

async function enablePushNotifications(){
  const OneSignal=window.PandasOneSignal;
  if(!OneSignal){ toast('OneSignal ainda está carregando.'); return; }
  try{
    if(Notification.permission!=='granted') await OneSignal.Notifications.requestPermission();
    if(OneSignal.Notifications.permission){
      await OneSignal.User.PushSubscription.optIn();
      await wait(1500);
    }
    await refreshPushStatus();
    toast(OneSignal.User.PushSubscription.id?'Push ativado e inscrito.':'Permissão concedida, mas sem Subscription ID.');
  }catch(err){
    console.error(err);
    setPushStatus('⚠️ Erro ao ativar notificações','err');
    await renderPushDiagnostic();
  }
}

async function recreatePushSubscription(){
  const OneSignal=window.PandasOneSignal;
  if(!OneSignal){ alert('OneSignal ainda está carregando. Tente novamente em alguns segundos.'); return; }

  const btn=document.getElementById('recreatePushBtn');
  const oldText=btn?.textContent;
  try{
    if(btn){ btn.disabled=true; btn.textContent='⏳ Recriando inscrição...'; }

    if(Notification.permission!=='granted') await OneSignal.Notifications.requestPermission();
    if(Notification.permission!=='granted') throw new Error('Permissão de notificações não concedida.');

    try{ await OneSignal.User.PushSubscription.optOut(); }catch{}
    await wait(500);

    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      const reg=
        regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
        regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
        null;
      if(reg){
        const nativeSub=await reg.pushManager.getSubscription();
        if(nativeSub) await nativeSub.unsubscribe();
      }
    }catch(err){ console.warn('Reset Push nativo:',err); }

    await wait(800);
    await OneSignal.User.PushSubscription.optIn();

    let newId='';
    for(let i=0;i<10;i++){
      await wait(700);
      newId=OneSignal.User.PushSubscription.id||'';
      if(newId)break;
    }

    await refreshPushStatus();

    if(newId){
      alert('Inscrição Push recriada com sucesso!\\n\\nSubscription ID:\\n'+newId+'\\n\\nAtualize Audience → Subscriptions no OneSignal.');
    }else{
      alert('Ainda não foi criado um Subscription ID. Tire um print do painel de diagnóstico e me envie.');
    }
  }catch(err){
    console.error(err);
    alert('Erro ao recriar inscrição Push:\\n\\n'+(err?.message||err));
    await refreshPushStatus();
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=oldText||'🛠️ Recriar inscrição Push'; }
  }
}

if(notifyBtn)notifyBtn.onclick=enablePushNotifications;
document.getElementById('refreshPushDiag')?.addEventListener('click',refreshPushStatus);
document.getElementById('recreatePushBtn')?.addEventListener('click',recreatePushSubscription);

window.addEventListener('pandas-onesignal-ready',()=>{
  refreshPushStatus();
  try{
    window.PandasOneSignal.Notifications.addEventListener('permissionChange',refreshPushStatus);
    window.PandasOneSignal.User.PushSubscription.addEventListener('change',()=>setTimeout(refreshPushStatus,300));
  }catch(err){ console.warn('Listener OneSignal:',err); }
});

document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)setTimeout(refreshPushStatus,400);
});


async function runTechnicalPushTest(){
  const out=document.getElementById('technicalPushOutput');
  const btn=document.getElementById('runTechnicalPushTest');

  const lines=[];
  const add=(label,value)=>{
    const text=typeof value==='string' ? value : JSON.stringify(value,null,2);
    lines.push(`${label}: ${text}`);
    if(out) out.textContent=lines.join('\n\n');
  };

  const addError=(label,err)=>{
    add(label,{
      name:err?.name||'Error',
      message:err?.message||String(err),
      stack:err?.stack||''
    });
  };

  if(btn){
    btn.disabled=true;
    btn.textContent='⏳ Testando...';
  }

  try{
    add('Data/hora',new Date().toString());
    add('URL atual',location.href);
    add('Origem',location.origin);
    add('Notification.permission',
      ('Notification' in window) ? Notification.permission : 'unsupported');
    add('Secure context',window.isSecureContext);
    add('User Agent',navigator.userAgent);

    // Service Worker
    if(!('serviceWorker' in navigator)){
      add('Service Worker','NÃO SUPORTADO');
      return;
    }

    const regs=await navigator.serviceWorker.getRegistrations();
    add('Quantidade de registrations',regs.length);

    regs.forEach((reg,i)=>{
      add(`Registration ${i+1}`,{
        scope:reg.scope,
        active:reg.active?.scriptURL||null,
        waiting:reg.waiting?.scriptURL||null,
        installing:reg.installing?.scriptURL||null
      });
    });

    const reg=
      regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
      regs.find(r=>String(r.active?.scriptURL||r.installing?.scriptURL||r.waiting?.scriptURL||'').includes('OneSignalSDKWorker.js')) ||
      null;

    if(!reg){
      add('Registration do PANDAS FC','NÃO ENCONTRADA');
      try{
        add('Tentando registrar ./sw.js','...');
        const newReg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
        add('Registro manual concluído',{
          scope:newReg.scope,
          active:newReg.active?.scriptURL||null
        });
      }catch(err){
        addError('ERRO ao registrar ./sw.js',err);
      }
      return;
    }

    add('Registration escolhida',{
      scope:reg.scope,
      active:reg.active?.scriptURL||null
    });

    try{
      await reg.update();
      add('registration.update()','OK');
    }catch(err){
      addError('registration.update() ERRO',err);
    }

    try{
      const ready=await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('Timeout aguardando navigator.serviceWorker.ready')),5000))
      ]);
      add('navigator.serviceWorker.ready',{
        scope:ready.scope,
        active:ready.active?.scriptURL||null
      });
    }catch(err){
      addError('navigator.serviceWorker.ready ERRO',err);
    }

    add('navigator.serviceWorker.controller',
      navigator.serviceWorker.controller?.scriptURL || 'NENHUM');

    try{
      const nativeSub=await reg.pushManager.getSubscription();
      add('PushManager.getSubscription()',nativeSub ? {
        endpoint:nativeSub.endpoint,
        expirationTime:nativeSub.expirationTime,
        hasP256dh:!!nativeSub.getKey('p256dh'),
        hasAuth:!!nativeSub.getKey('auth')
      } : 'NULL');
    }catch(err){
      addError('PushManager.getSubscription() ERRO',err);
    }

    // Verify SW file is reachable
    try{
      const swUrl=new URL('./push/onesignal/OneSignalSDKWorker.js',location.href).href;
      const res=await fetch(swUrl,{cache:'no-store'});
      const txt=await res.text();
      add('Fetch OneSignalSDKWorker.js',{
        url:swUrl,
        status:res.status,
        ok:res.ok,
        firstLine:(txt.split(/\r?\n/)[0]||'').slice(0,180),
        containsOneSignal:txt.includes('OneSignalSDK.sw.js')
      });
    }catch(err){
      addError('Fetch OneSignalSDKWorker.js ERRO',err);
    }

    // OneSignal SDK
    const OneSignal=window.PandasOneSignal;
    add('window.PandasOneSignal',!!OneSignal);

    if(!OneSignal){
      add('OneSignal','NÃO CARREGADO');
      return;
    }

    try{
      add('OneSignal.Notifications.permission',
        OneSignal.Notifications.permission);
    }catch(err){
      addError('Ler OneSignal.Notifications.permission ERRO',err);
    }

    try{
      add('OneSignal PushSubscription ANTES',{
        optedIn:OneSignal.User.PushSubscription.optedIn,
        id:OneSignal.User.PushSubscription.id||null,
        token:OneSignal.User.PushSubscription.token ? 'PRESENTE' : null
      });
    }catch(err){
      addError('Ler PushSubscription ANTES ERRO',err);
    }

    // Attempt real optIn and capture the actual error
    try{
      add('Executando OneSignal.User.PushSubscription.optIn()','INICIANDO');
      const result=await OneSignal.User.PushSubscription.optIn();
      add('optIn() retorno',result ?? 'undefined');
    }catch(err){
      addError('optIn() ERRO REAL',err);
    }

    await wait(2500);

    try{
      add('OneSignal PushSubscription DEPOIS',{
        optedIn:OneSignal.User.PushSubscription.optedIn,
        id:OneSignal.User.PushSubscription.id||null,
        token:OneSignal.User.PushSubscription.token ? 'PRESENTE' : null
      });
    }catch(err){
      addError('Ler PushSubscription DEPOIS ERRO',err);
    }

    try{
      const nativeSub2=await reg.pushManager.getSubscription();
      add('PushManager depois do optIn',nativeSub2 ? {
        endpoint:nativeSub2.endpoint,
        expirationTime:nativeSub2.expirationTime,
        hasP256dh:!!nativeSub2.getKey('p256dh'),
        hasAuth:!!nativeSub2.getKey('auth')
      } : 'NULL');
    }catch(err){
      addError('PushManager depois do optIn ERRO',err);
    }

    // Final high-level verdict
    let finalId='';
    try{ finalId=OneSignal.User.PushSubscription.id||''; }catch{}
    if(finalId){
      add('RESULTADO FINAL','✅ Subscription ID criado com sucesso');
    }else{
      add('RESULTADO FINAL','❌ Ainda sem Subscription ID. Copie este diagnóstico e envie.');
    }

  }catch(err){
    addError('ERRO GERAL DO TESTE',err);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent='🧪 Executar teste técnico';
    }
  }
}

document.getElementById('runTechnicalPushTest')?.addEventListener('click',runTechnicalPushTest);


async function runNativePushManagerTest(){
  const out=document.getElementById('technicalPushOutput');
  const btn=document.getElementById('runNativePushTest');
  const lines=[];

  const add=(label,value)=>{
    const text=typeof value==='string' ? value : JSON.stringify(value,null,2);
    lines.push(`${label}: ${text}`);
    if(out) out.textContent=lines.join('\n\n');
  };

  const addError=(label,err)=>{
    add(label,{
      name:err?.name||'Error',
      message:err?.message||String(err),
      code:err?.code ?? null,
      stack:err?.stack||''
    });
  };

  if(btn){
    btn.disabled=true;
    btn.textContent='⏳ Testando PushManager...';
  }

  try{
    add('=== TESTE NATIVO DO PUSHMANAGER ===','');
    add('Data/hora',new Date().toString());
    add('Notification.permission',
      ('Notification' in window)?Notification.permission:'unsupported');
    add('Secure context',window.isSecureContext);
    add('Online',navigator.onLine);

    if(!('serviceWorker' in navigator)){
      add('RESULTADO','❌ Service Worker não suportado');
      return;
    }

    const regs=await navigator.serviceWorker.getRegistrations();

    add('Registrations encontradas',regs.map(r=>({
      scope:r.scope,
      active:r.active?.scriptURL||null,
      waiting:r.waiting?.scriptURL||null,
      installing:r.installing?.scriptURL||null
    })));

    // Usa especificamente o worker do OneSignal.
    const reg=
      regs.find(r=>String(r.scope||'').includes('/PandasFc/push/onesignal/')) ||
      regs.find(r=>String(
        r.active?.scriptURL||
        r.waiting?.scriptURL||
        r.installing?.scriptURL||
        ''
      ).includes('OneSignalSDKWorker.js')) ||
      null;

    if(!reg){
      add('RESULTADO','❌ Registration do OneSignal não encontrada');
      return;
    }

    add('Worker OneSignal selecionado',{
      scope:reg.scope,
      active:reg.active?.scriptURL||null
    });

    // Estado de permissão do PushManager
    try{
      if(typeof reg.pushManager.permissionState==='function'){
        const state=await reg.pushManager.permissionState({userVisibleOnly:true});
        add('PushManager.permissionState()',state);
      }else{
        add('PushManager.permissionState()','Não disponível neste navegador');
      }
    }catch(err){
      addError('PushManager.permissionState() ERRO',err);
    }

    // Subscription existente?
    let existing=null;
    try{
      existing=await reg.pushManager.getSubscription();
      add('PushManager.getSubscription() ANTES',existing?{
        endpoint:existing.endpoint,
        expirationTime:existing.expirationTime,
        hasP256dh:!!existing.getKey('p256dh'),
        hasAuth:!!existing.getKey('auth')
      }:'NULL');
    }catch(err){
      addError('getSubscription() ERRO',err);
    }

    // Se houver algo preso, tenta remover para garantir teste limpo.
    if(existing){
      try{
        const unsub=await existing.unsubscribe();
        add('unsubscribe() da inscrição existente',unsub);
      }catch(err){
        addError('unsubscribe() ERRO',err);
      }
    }

    /*
     * TESTE 1:
     * subscribe nativo sem applicationServerKey.
     *
     * Esse teste é propositalmente de baixo nível:
     * queremos o erro bruto do Chrome/FCM, sem o OneSignal mascarar.
     */
    try{
      add('Teste 1: pushManager.subscribe({userVisibleOnly:true})','INICIANDO');
      const nativeSub=await reg.pushManager.subscribe({
        userVisibleOnly:true
      });

      add('Teste 1: SUCESSO',{
        endpoint:nativeSub.endpoint,
        expirationTime:nativeSub.expirationTime,
        hasP256dh:!!nativeSub.getKey('p256dh'),
        hasAuth:!!nativeSub.getKey('auth')
      });

      // Não deixa essa inscrição manual interferir no OneSignal.
      try{
        const removed=await nativeSub.unsubscribe();
        add('Remoção da inscrição manual de teste',removed);
      }catch(err){
        addError('Remover inscrição manual ERRO',err);
      }
    }catch(err){
      addError('Teste 1: ERRO BRUTO DO CHROME',err);
    }

    /*
     * TESTE 2:
     * pede ao OneSignal para inscrever novamente logo após o teste nativo.
     * Assim comparamos o comportamento do navegador com o SDK.
     */
    const OneSignal=window.PandasOneSignal;
    add('OneSignal carregado',!!OneSignal);

    if(OneSignal){
      try{
        add('OneSignal ANTES',{
          permission:OneSignal.Notifications.permission,
          optedIn:OneSignal.User.PushSubscription.optedIn,
          id:OneSignal.User.PushSubscription.id||null,
          token:OneSignal.User.PushSubscription.token?'PRESENTE':null
        });
      }catch(err){
        addError('Ler estado OneSignal ANTES ERRO',err);
      }

      try{
        add('Teste 2: OneSignal optIn()','INICIANDO');
        await OneSignal.User.PushSubscription.optIn();
        add('Teste 2: OneSignal optIn()','RETORNOU SEM EXCEÇÃO');
      }catch(err){
        addError('Teste 2: OneSignal optIn() ERRO',err);
      }

      await wait(3000);

      try{
        add('OneSignal DEPOIS',{
          permission:OneSignal.Notifications.permission,
          optedIn:OneSignal.User.PushSubscription.optedIn,
          id:OneSignal.User.PushSubscription.id||null,
          token:OneSignal.User.PushSubscription.token?'PRESENTE':null
        });
      }catch(err){
        addError('Ler estado OneSignal DEPOIS ERRO',err);
      }
    }

    // Estado final do PushManager
    try{
      const finalSub=await reg.pushManager.getSubscription();
      add('PushManager.getSubscription() FINAL',finalSub?{
        endpoint:finalSub.endpoint,
        expirationTime:finalSub.expirationTime,
        hasP256dh:!!finalSub.getKey('p256dh'),
        hasAuth:!!finalSub.getKey('auth')
      }:'NULL');
    }catch(err){
      addError('getSubscription() FINAL ERRO',err);
    }

    add('RESULTADO','Fim do teste. Copie TODO o resultado e envie.');

  }catch(err){
    addError('ERRO GERAL DO TESTE NATIVO',err);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent='🧬 Testar PushManager direto';
    }
  }
}

document.getElementById('runNativePushTest')?.addEventListener(
  'click',
  runNativePushManagerTest
);

document.getElementById('copyTechnicalPushTest')?.addEventListener('click',async()=>{
  const txt=document.getElementById('technicalPushOutput')?.textContent||'';
  try{
    await navigator.clipboard.writeText(txt);
    toast('Diagnóstico copiado.');
  }catch{
    alert(txt);
  }
});

/* Mantido apenas como fallback visual quando o aplicativo estiver aberto.
   As notificações em segundo plano passam a ser entregues pelo OneSignal. */
function checkTodayMatches(){
  // Não cria mais notificações locais duplicadas.
}

let deferredPrompt=null;

function isRunningInstalled(){
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: fullscreen)').matches ||
         window.navigator.standalone === true;
}

function setInstallButtonsVisible(visible){
  const b1=document.getElementById('installBtn');
  const b2=document.getElementById('installBtn2');
  if(b1) b1.style.display=visible ? '' : 'none';
  if(b2) b2.style.display=visible ? '' : 'none';
}

function updateInstallUI(){
  const installedFlag=localStorage.getItem('pandasfc_installed') === '1';

  if(isRunningInstalled() || installedFlag){
    setInstallButtonsVisible(false);
    return;
  }

  // Antes do beforeinstallprompt, mantém oculto para não exibir um botão sem ação.
  setInstallButtonsVisible(!!deferredPrompt);
}

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();
  deferredPrompt=e;
  updateInstallUI();
});

async function installApp(){
  if(isRunningInstalled()){
    localStorage.setItem('pandasfc_installed','1');
    setInstallButtonsVisible(false);
    return;
  }

  if(!deferredPrompt){
    alert('A instalação automática ainda não foi liberada pelo navegador. Aguarde alguns segundos ou use o menu ⋮ do Chrome → “Instalar app”.');
    return;
  }

  try{
    deferredPrompt.prompt();
    const result=await deferredPrompt.userChoice;

    if(result.outcome === 'accepted'){
      // Oculta imediatamente, sem esperar outra navegação.
      localStorage.setItem('pandasfc_installed','1');
      setInstallButtonsVisible(false);
      toast('Instalação iniciada.');
    }

    deferredPrompt=null;
    updateInstallUI();
  }catch(err){
    console.error('Erro ao instalar PWA:',err);
  }
}

document.getElementById('installBtn').onclick=installApp;
document.getElementById('installBtn2').onclick=installApp;

window.addEventListener('appinstalled',()=>{
  localStorage.setItem('pandasfc_installed','1');
  deferredPrompt=null;
  setInstallButtonsVisible(false);
  toast('PANDAS FC instalado com sucesso.');
});

// Se o app for aberto em modo standalone, garante que o botão nunca apareça.
window.matchMedia('(display-mode: standalone)').addEventListener?.('change',updateInstallUI);
updateInstallUI();

if('serviceWorker'in navigator){
  window.addEventListener('load',async()=>{
    try{
      await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      await navigator.serviceWorker.ready;
      setTimeout(()=>refreshPushStatus().catch(()=>{}),500);
    }catch(err){
      console.error('Erro ao registrar sw.js:',err);
    }
  });
}


function setAuthMessage(message,type=""){
  const el=document.getElementById("authMessage");
  if(!el) return;
  el.textContent=message || "";
  el.className=`auth-message ${type}`.trim();
}
function friendlyAuthError(err){
  const code=String(err?.code||"");
  const map={
    "auth/invalid-credential":"E-mail ou senha incorretos.",
    "auth/user-not-found":"Usuário não encontrado.",
    "auth/wrong-password":"Senha incorreta.",
    "auth/email-already-in-use":"Este e-mail já possui uma conta. Use Entrar ou Esqueci minha senha.",
    "auth/weak-password":"A senha deve ter pelo menos 6 caracteres.",
    "auth/invalid-email":"Informe um e-mail válido.",
    "auth/too-many-requests":"Muitas tentativas. Aguarde um pouco e tente novamente.",
    "auth/network-request-failed":"Falha de conexão. Verifique sua internet."
  };
  return map[code] || err?.message || "Não foi possível concluir a operação.";
}
/* =========================================================
   PANDAS MUSIC
   YouTube + avisos hospedados no GitHub
   ========================================================= */

let youtubeApiPromise=null;
let youtubeMusicPlayer=null;
let youtubeMusicReady=false;
let youtubeMusicReadyPromise=null;
let youtubeMusicReadyResolve=null;
let youtubeMusicReadyReject=null;
let pendingMusicPlay=false;
let youtubeLoadedSourceKey="";
let customAnnouncementAudio=null;
let currentAnnouncementId="";
let resumeYoutubeAfterAnnouncement=false;
let musicUserStarted=false;
let lastKnownYoutubeState=-1;

function parseYoutubeSource(value=""){
  const raw=String(value||"").trim();
  if(!raw)return {type:"",id:"",url:""};

  // Aceita somente ID de playlist ou ID de vídeo colado diretamente.
  if(/^[A-Za-z0-9_-]{10,}$/.test(raw) && !raw.includes("/") && !raw.includes(".")){
    // IDs de playlist normalmente são mais longos que IDs de vídeo (11 chars).
    if(raw.length===11)return {type:"video",id:raw,url:raw};
    return {type:"playlist",id:raw,url:raw};
  }

  try{
    const url=new URL(raw);

    // Playlist tem prioridade caso o link contenha ?list=
    const list=url.searchParams.get("list");
    if(list){
      return {type:"playlist",id:list.trim(),url:raw};
    }

    const host=url.hostname.replace(/^www\./,"").toLowerCase();

    // youtu.be/VIDEO_ID
    if(host==="youtu.be"){
      const id=url.pathname.split("/").filter(Boolean)[0]||"";
      if(id)return {type:"video",id,url:raw};
    }

    // youtube.com/watch?v=VIDEO_ID
    if(host.endsWith("youtube.com") || host==="music.youtube.com"){
      const v=url.searchParams.get("v");
      if(v)return {type:"video",id:v.trim(),url:raw};

      // youtube.com/shorts/VIDEO_ID
      const parts=url.pathname.split("/").filter(Boolean);
      const shortsIndex=parts.indexOf("shorts");
      if(shortsIndex!==-1 && parts[shortsIndex+1]){
        return {type:"video",id:parts[shortsIndex+1],url:raw};
      }

      // youtube.com/embed/VIDEO_ID
      const embedIndex=parts.indexOf("embed");
      if(embedIndex!==-1 && parts[embedIndex+1]){
        return {type:"video",id:parts[embedIndex+1],url:raw};
      }
    }
  }catch{}

  return {type:"",id:"",url:raw};
}

function extractYoutubePlaylistId(value=""){
  const parsed=parseYoutubeSource(value);
  return parsed.type==="playlist"?parsed.id:"";
}

function extractYoutubeVideoId(value=""){
  const parsed=parseYoutubeSource(value);
  return parsed.type==="video"?parsed.id:"";
}

function normalizeAudioUrl(value=""){
  const raw=String(value||"").trim();
  if(!raw)return "";
  try{
    return new URL(raw,location.href).href;
  }catch{
    return raw;
  }
}

function loadYoutubeIframeAPI(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(youtubeApiPromise)return youtubeApiPromise;

  youtubeApiPromise=new Promise((resolve,reject)=>{
    const previous=window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady=()=>{
      try{ previous?.(); }catch{}
      resolve(window.YT);
    };

    if(!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')){
      const script=document.createElement("script");
      script.src="https://www.youtube.com/iframe_api";
      script.async=true;
      script.onerror=()=>reject(new Error("Não foi possível carregar o player do YouTube."));
      document.head.appendChild(script);
    }

    let checks=0;
    const timer=setInterval(()=>{
      if(window.YT?.Player){
        clearInterval(timer);
        resolve(window.YT);
      }else if(++checks>100){
        clearInterval(timer);
        reject(new Error("Tempo excedido ao carregar o YouTube."));
      }
    },100);
  });

  return youtubeApiPromise;
}


function createYoutubeMusicReadyPromise(){
  if(youtubeMusicReady)return Promise.resolve(youtubeMusicPlayer);
  if(youtubeMusicReadyPromise)return youtubeMusicReadyPromise;

  youtubeMusicReadyPromise=new Promise((resolve,reject)=>{
    youtubeMusicReadyResolve=resolve;
    youtubeMusicReadyReject=reject;
  });

  return youtubeMusicReadyPromise;
}

async function waitForYoutubeMusicReady(timeoutMs=10000){
  if(youtubeMusicReady && youtubeMusicPlayer)return youtubeMusicPlayer;

  const ready=createYoutubeMusicReadyPromise();

  return Promise.race([
    ready,
    new Promise((_,reject)=>setTimeout(
      ()=>reject(new Error("O player do YouTube demorou para ficar pronto.")),
      timeoutMs
    ))
  ]);
}

function currentYoutubeMusicSource(){
  const type=state.music.youtubeSourceType||
    (state.music.youtubePlaylistId?"playlist":
     state.music.youtubeVideoId?"video":"");

  const id=type==="playlist"
    ? state.music.youtubePlaylistId
    : state.music.youtubeVideoId;

  return {type,id,key:type&&id?`${type}:${id}`:""};
}

function cueCurrentYoutubeSource(player){
  const source=currentYoutubeMusicSource();
  if(!source.type || !source.id)return false;

  if(source.key===youtubeLoadedSourceKey)return true;

  if(source.type==="playlist"){
    player.cuePlaylist({
      listType:"playlist",
      list:source.id,
      index:0,
      startSeconds:0
    });
    player.setLoop(true);
  }else{
    player.cueVideoById(source.id);
  }

  youtubeLoadedSourceKey=source.key;
  return true;
}

async function ensureYoutubeMusicPlayer(){
  if(youtubeMusicPlayer){
    if(youtubeMusicReady)return youtubeMusicPlayer;
    return waitForYoutubeMusicReady();
  }

  const source=currentYoutubeMusicSource();
  if(!source.type || !source.id)return null;

  setMusicSubtitle("Carregando player do YouTube...");

  // Começa a carregar a API o quanto antes e cria uma Promise de readiness
  // antes de instanciar YT.Player, evitando perder o evento onReady.
  createYoutubeMusicReadyPromise();
  const YT=await loadYoutubeIframeAPI();

  const playerVars={
    playsinline:1,
    enablejsapi:1,
    origin:location.origin,
    rel:0,
    controls:0
  };

  if(source.type==="playlist"){
    playerVars.listType="playlist";
    playerVars.list=source.id;
  }

  youtubeMusicPlayer=new YT.Player("youtubeMusicPlayer",{
    width:"160",
    height:"90",
    videoId:source.type==="video"?source.id:undefined,
    playerVars,
    events:{
      onReady:event=>{
        youtubeMusicReady=true;

        try{
          // Força o conteúdo atual, mesmo que tenha mudado durante o carregamento.
          youtubeLoadedSourceKey="";
          cueCurrentYoutubeSource(event.target);

          event.target.setVolume(
            Number(document.getElementById("musicVolume")?.value||65)
          );
        }catch(err){
          console.warn("PANDAS MUSIC ready:",err);
        }

        youtubeMusicReadyResolve?.(event.target);
        youtubeMusicReadyResolve=null;
        youtubeMusicReadyReject=null;

        updateMusicPlayerUI();

        // Se o usuário apertou Play antes do onReady, executa agora.
        if(pendingMusicPlay){
          pendingMusicPlay=false;
          setTimeout(()=>playYoutubeMusic().catch(()=>{}),50);
        }
      },
      onStateChange:event=>{
        lastKnownYoutubeState=event.data;
        updateMusicPlayerUI();
      },
      onError:event=>{
        console.warn("YouTube player error",event.data);
        pendingMusicPlay=false;
        setMusicSubtitle(`Erro do YouTube (${event.data}). Tente outro vídeo/playlist.`);
      }
    }
  });

  return waitForYoutubeMusicReady();
}

function setMusicSubtitle(text){
  const el=document.getElementById("musicNowSubtitle");
  if(el)el.textContent=text;
}

function setMusicTitle(text){
  const el=document.getElementById("musicNowTitle");
  if(el)el.textContent=text;
}

function isYoutubePlaying(){
  return !!window.YT && lastKnownYoutubeState===window.YT.PlayerState.PLAYING;
}

function isAnnouncementPlaying(){
  return !!customAnnouncementAudio && !customAnnouncementAudio.paused && !customAnnouncementAudio.ended;
}

function updateMusicPlayerUI(){
  const playBtn=document.getElementById("musicPlayBtn");
  const title=document.getElementById("musicNowTitle");
  const subtitle=document.getElementById("musicNowSubtitle");
  const visual=document.getElementById("customAudioVisual");

  if(customAnnouncementAudio){
    visual?.classList.remove("hidden");
    if(title)title.textContent=`📢 ${customAnnouncementAudio.dataset?.name||"Aviso interno"}`;
    if(subtitle)subtitle.textContent=isAnnouncementPlaying()?"Aviso em reprodução":"Aviso pausado";
    if(playBtn)playBtn.textContent=isAnnouncementPlaying()?"⏸":"▶";
    return;
  }

  visual?.classList.add("hidden");
  if(title)title.textContent="🎵 PANDAS MUSIC";

  const hasYoutubeSource=!!(
    state.music.youtubePlaylistId || state.music.youtubeVideoId
  );

  if(!hasYoutubeSource){
    if(subtitle)subtitle.textContent="Aguardando conteúdo da DIRETORIA";
    if(playBtn)playBtn.textContent="▶";
    return;
  }

  if(subtitle){
    const sourceLabel=state.music.youtubeSourceType==="video"
      ?"Vídeo do PANDAS FC"
      :"Playlist do PANDAS FC";
    subtitle.textContent=isYoutubePlaying()
      ?`${sourceLabel} • tocando`
      :`${sourceLabel} • toque ▶ para ouvir`;
  }
  if(playBtn){
    playBtn.textContent=isYoutubePlaying()?"⏸":"▶";
    playBtn.disabled=false;
  }
}

async function applyMusicConfiguration(){
  updateMusicPlayerUI();

  const source=currentYoutubeMusicSource();

  if(!source.type || !source.id){
    if(youtubeMusicPlayer && youtubeMusicReady){
      try{youtubeMusicPlayer.stopVideo();}catch{}
    }
    youtubeLoadedSourceKey="";
    return;
  }

  try{
    // Pré-carrega e deixa a fonte pronta, mas não força reprodução com som.
    const player=await ensureYoutubeMusicPlayer();
    if(!player)return;

    cueCurrentYoutubeSource(player);
    setMusicSubtitle(
      source.type==="video"
        ?"Vídeo do PANDAS FC • toque ▶ para ouvir"
        :"Playlist do PANDAS FC • toque ▶ para ouvir"
    );
  }catch(err){
    console.warn(err);
    setMusicSubtitle("Falha ao carregar o player. Toque ▶ para tentar novamente.");
  }
}

async function playYoutubeMusic(){
  if(customAnnouncementAudio){
    try{await customAnnouncementAudio.play();}catch{}
    updateMusicPlayerUI();
    return;
  }

  const source=currentYoutubeMusicSource();
  if(!source.type || !source.id){
    toast("A DIRETORIA ainda não configurou música ou vídeo.");
    return;
  }

  musicUserStarted=true;
  pendingMusicPlay=true;
  setMusicSubtitle("Carregando player...");

  try{
    const player=await ensureYoutubeMusicPlayer();
    if(!player){
      pendingMusicPlay=false;
      toast("Não foi possível criar o player.");
      return;
    }

    await waitForYoutubeMusicReady(10000);
    cueCurrentYoutubeSource(player);

    player.unMute?.();
    player.setVolume?.(
      Number(document.getElementById("musicVolume")?.value||65)
    );

    pendingMusicPlay=false;
    player.playVideo();

    // Alguns aparelhos demoram para refletir o estado. Confere e tenta mais
    // uma vez sem exigir novo toque do usuário.
    await new Promise(resolve=>setTimeout(resolve,450));

    if(!isYoutubePlaying()){
      try{player.playVideo();}catch{}
    }

    setTimeout(()=>{
      if(!isYoutubePlaying()){
        setMusicSubtitle(
          "O YouTube não iniciou. Toque ▶ novamente ou teste outro vídeo."
        );
      }
      updateMusicPlayerUI();
    },900);

  }catch(err){
    pendingMusicPlay=false;
    console.warn("PANDAS MUSIC play:",err);
    setMusicSubtitle("Player não ficou pronto. Toque ▶ para tentar novamente.");
    toast(err?.message||"Não foi possível iniciar a música.");
  }
}

function pauseMusic(){
  if(customAnnouncementAudio){
    customAnnouncementAudio.pause();
  }else{
    try{youtubeMusicPlayer?.pauseVideo?.();}catch{}
  }
  updateMusicPlayerUI();
}

async function toggleMusicPlayback(){
  if(isAnnouncementPlaying() || isYoutubePlaying()){
    pauseMusic();
  }else{
    await playYoutubeMusic();
  }
}

function previousMusic(){
  if(customAnnouncementAudio){
    finishAnnouncement(true);
    return;
  }

  try{
    musicUserStarted=true;
    if(state.music.youtubeSourceType==="video"){
      youtubeMusicPlayer?.seekTo?.(0,true);
      youtubeMusicPlayer?.playVideo?.();
    }else{
      youtubeMusicPlayer?.previousVideo?.();
    }
  }catch{}
}

function nextMusic(){
  if(customAnnouncementAudio){
    finishAnnouncement(true);
    return;
  }

  try{
    musicUserStarted=true;
    if(state.music.youtubeSourceType==="video"){
      youtubeMusicPlayer?.seekTo?.(0,true);
      youtubeMusicPlayer?.playVideo?.();
    }else{
      youtubeMusicPlayer?.nextVideo?.();
    }
  }catch{}
}

function setMusicVolume(value){
  const volume=Math.max(0,Math.min(100,Number(value)||0));
  try{youtubeMusicPlayer?.setVolume?.(volume);}catch{}
  if(customAnnouncementAudio)customAnnouncementAudio.volume=volume/100;
  localStorage.setItem("pandasMusicVolume",String(volume));
}

function renderMusicAdmin(){
  const playlistInput=document.getElementById("musicPlaylistUrl");
  const status=document.getElementById("musicPlaylistStatus");
  const list=document.getElementById("musicAudioList");

  if(playlistInput && document.activeElement!==playlistInput){
    playlistInput.value=state.music.youtubePlaylistUrl||"";
  }

  if(status){
    if(state.music.youtubeSourceType==="video" && state.music.youtubeVideoId){
      status.textContent=`Vídeo ativo: ${state.music.youtubeVideoId}`;
    }else if(state.music.youtubePlaylistId){
      status.textContent=`Playlist ativa: ${state.music.youtubePlaylistId}`;
    }else{
      status.textContent="Nenhum conteúdo do YouTube configurado.";
    }
  }

  if(list){
    const audios=state.music.customAudios||[];
    list.innerHTML=audios.length?audios.map(audio=>`
      <div class="music-audio-item">
        <div>
          <strong>📢 ${esc(audio.name||"Áudio")}</strong>
          <small>${esc(audio.url||"")}</small>
        </div>
        <div class="actions">
          <button type="button" onclick="previewMusicAudio('${audio.id}')">▶️ Testar</button>
          <button type="button" onclick="broadcastMusicAudio('${audio.id}')">📢 Tocar para todos</button>
          <button type="button" onclick="removeMusicAudio('${audio.id}')">🗑️ Remover</button>
        </div>
      </div>
    `).join(""):'<p class="muted">Nenhum áudio próprio cadastrado.</p>';
  }
}

async function saveMusicPlaylist(){
  if(!requireDirector())return;

  const input=document.getElementById("musicPlaylistUrl");
  const url=String(input?.value||"").trim();
  const parsed=parseYoutubeSource(url);

  if(!parsed.type || !parsed.id){
    toast("Cole um link válido de vídeo ou playlist do YouTube/YouTube Music.");
    return;
  }

  try{
    markWriting();

    await setDoc(doc(db,"settings","music"),{
      youtubePlaylistUrl:url,
      youtubeSourceType:parsed.type,
      youtubePlaylistId:parsed.type==="playlist"?parsed.id:"",
      youtubeVideoId:parsed.type==="video"?parsed.id:"",
      updatedAt:serverTimestamp()
    },{merge:true});

    toast(parsed.type==="playlist"
      ?"Playlist salva."
      :"Vídeo salvo.");
  }catch(err){syncError(err);}
}

async function clearMusicPlaylist(){
  if(!requireDirector())return;
  if(!confirm("Remover a playlist atual do PANDAS MUSIC?"))return;

  try{
    markWriting();
    await setDoc(doc(db,"settings","music"),{
      youtubePlaylistUrl:"",
      youtubePlaylistId:"",
      youtubeVideoId:"",
      youtubeSourceType:"",
      updatedAt:serverTimestamp()
    },{merge:true});
    toast("Playlist removida.");
  }catch(err){syncError(err);}
}

async function addMusicAudio(){
  if(!requireDirector())return;

  const name=String(document.getElementById("musicAudioName")?.value||"").trim();
  const rawUrl=String(document.getElementById("musicAudioUrl")?.value||"").trim();

  if(!name || !rawUrl){
    toast("Informe o nome e o caminho/URL do áudio.");
    return;
  }

  const audio={
    id:uid(),
    name,
    url:rawUrl
  };

  const audios=[...(state.music.customAudios||[]),audio];

  try{
    markWriting();
    await setDoc(doc(db,"settings","music"),{
      customAudios:audios,
      updatedAt:serverTimestamp()
    },{merge:true});
    document.getElementById("musicAudioName").value="";
    document.getElementById("musicAudioUrl").value="";
    toast("Áudio cadastrado.");
  }catch(err){syncError(err);}
}

async function removeMusicAudio(id){
  if(!requireDirector())return;
  const audio=state.music.customAudios.find(a=>a.id===id);
  if(!audio)return;
  if(!confirm(`Remover "${audio.name}" da lista?`))return;

  try{
    markWriting();
    await setDoc(doc(db,"settings","music"),{
      customAudios:state.music.customAudios.filter(a=>a.id!==id),
      updatedAt:serverTimestamp()
    },{merge:true});
  }catch(err){syncError(err);}
}

function createAnnouncementAudio(audio){
  const el=new Audio(normalizeAudioUrl(audio.url));
  el.preload="auto";
  el.dataset.name=audio.name||"Aviso interno";
  el.volume=Number(document.getElementById("musicVolume")?.value||65)/100;
  return el;
}

function previewMusicAudio(id){
  if(!requireDirector())return;
  const audio=state.music.customAudios.find(a=>a.id===id);
  if(!audio)return;

  stopAnnouncementAudio();
  const preview=createAnnouncementAudio(audio);
  customAnnouncementAudio=preview;
  resumeYoutubeAfterAnnouncement=isYoutubePlaying();

  try{youtubeMusicPlayer?.pauseVideo?.();}catch{}

  preview.onended=()=>finishAnnouncement(false);
  preview.onerror=()=>{
    toast("Não foi possível abrir esse áudio. Confira o caminho no GitHub.");
    finishAnnouncement(false);
  };

  preview.play().then(updateMusicPlayerUI).catch(()=>{
    toast("Toque no player para iniciar o áudio.");
    updateMusicPlayerUI();
  });
}

async function broadcastMusicAudio(id){
  if(!requireDirector())return;
  const audio=state.music.customAudios.find(a=>a.id===id);
  if(!audio)return;

  const announcement={
    id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    audioId:audio.id,
    name:audio.name,
    url:audio.url,
    issuedAt:Date.now()
  };

  try{
    markWriting();
    await setDoc(doc(db,"settings","music"),{
      announcement,
      updatedAt:serverTimestamp()
    },{merge:true});
    toast("Aviso enviado para os players abertos.");
  }catch(err){syncError(err);}
}

function stopAnnouncementAudio(){
  if(customAnnouncementAudio){
    try{
      customAnnouncementAudio.pause();
      customAnnouncementAudio.src="";
    }catch{}
    customAnnouncementAudio=null;
  }
}

function finishAnnouncement(forceResume=false){
  const shouldResume=forceResume||resumeYoutubeAfterAnnouncement||musicUserStarted;
  stopAnnouncementAudio();
  resumeYoutubeAfterAnnouncement=false;
  updateMusicPlayerUI();

  if(shouldResume && (state.music.youtubePlaylistId || state.music.youtubeVideoId)){
    setTimeout(()=>playYoutubeMusic(),180);
  }
}

function handleRemoteAnnouncement(announcement){
  if(!announcement?.id || announcement.id===currentAnnouncementId)return;
  currentAnnouncementId=announcement.id;

  const audio={
    name:announcement.name||"Aviso interno",
    url:announcement.url||""
  };
  if(!audio.url)return;

  resumeYoutubeAfterAnnouncement=isYoutubePlaying();
  try{youtubeMusicPlayer?.pauseVideo?.();}catch{}

  stopAnnouncementAudio();
  const player=createAnnouncementAudio(audio);
  customAnnouncementAudio=player;

  player.onended=()=>finishAnnouncement(false);
  player.onerror=()=>{
    console.warn("Falha ao reproduzir aviso:",audio.url);
    finishAnnouncement(false);
  };

  player.play().then(()=>{
    updateMusicPlayerUI();
  }).catch(()=>{
    // Autoplay com som pode ser bloqueado pelo navegador.
    setMusicTitle(`📢 ${audio.name}`);
    setMusicSubtitle("Aviso recebido • toque ▶ para reproduzir");
    updateMusicPlayerUI();
  });
}

// Pré-carrega a biblioteca oficial do YouTube logo após o app abrir.
// Isso reduz o atraso quando o usuário toca em ▶ pela primeira vez.
setTimeout(()=>{
  loadYoutubeIframeAPI().catch(err=>{
    console.warn("Pré-carga YouTube:",err);
  });
},150);

// Controles do mini player.
document.getElementById("musicPlayBtn")?.addEventListener("click",toggleMusicPlayback);
document.getElementById("musicPrevBtn")?.addEventListener("click",previousMusic);
document.getElementById("musicNextBtn")?.addEventListener("click",nextMusic);

const savedMusicVolume=Number(localStorage.getItem("pandasMusicVolume"));
if(Number.isFinite(savedMusicVolume)){
  const volumeInput=document.getElementById("musicVolume");
  if(volumeInput)volumeInput.value=String(Math.max(0,Math.min(100,savedMusicVolume)));
}
document.getElementById("musicVolume")?.addEventListener("input",event=>setMusicVolume(event.target.value));

document.getElementById("saveMusicPlaylist")?.addEventListener("click",saveMusicPlaylist);
document.getElementById("clearMusicPlaylist")?.addEventListener("click",clearMusicPlaylist);
document.getElementById("addMusicAudio")?.addEventListener("click",addMusicAudio);

// Depois da primeira interação real do usuário, tentamos iniciar a playlist.
// Navegadores podem bloquear autoplay com som antes dessa interação.
document.addEventListener("pointerdown",()=>{
  if(!musicUserStarted && (state.music.youtubePlaylistId || state.music.youtubeVideoId) && !customAnnouncementAudio){
    musicUserStarted=true;
    playYoutubeMusic();
  }
},{once:true});

window.previewMusicAudio=previewMusicAudio;
window.broadcastMusicAudio=broadcastMusicAudio;
window.removeMusicAudio=removeMusicAudio;



function showRegister(show){
  document.getElementById("loginForm")?.classList.toggle("hidden",show);
  document.getElementById("registerForm")?.classList.toggle("hidden",!show);
  setAuthMessage("");
}


document.getElementById("showRegisterBtn")?.addEventListener("click",()=>showRegister(true));
document.getElementById("backToLoginBtn")?.addEventListener("click",()=>showRegister(false));

document.getElementById("loginForm")?.addEventListener("submit",async e=>{
  e.preventDefault(); setAuthMessage("Entrando...");
  try{
    const email=document.getElementById("loginEmail").value.trim();
    const password=document.getElementById("loginPassword").value;
    const cred=await signInWithEmailAndPassword(auth,email,password);
    await cred.user.reload();
    if(isDirectorEmail(cred.user) && !cred.user.emailVerified){
      await sendEmailVerification(cred.user).catch(()=>{});
      await signOut(auth);
      setAuthMessage("Conta da DIRETORIA ainda não verificada. Enviamos um link para esse e-mail. Confirme o endereço e entre novamente.","warn");
    }
  }catch(err){ setAuthMessage(friendlyAuthError(err),"err"); }
});

document.getElementById("registerForm")?.addEventListener("submit",async e=>{
  e.preventDefault();
  const name=document.getElementById("registerName").value.trim();
  const email=document.getElementById("registerEmail").value.trim();
  const p1=document.getElementById("registerPassword").value;
  const p2=document.getElementById("registerPassword2").value;
  if(p1!==p2){ setAuthMessage("As senhas não são iguais.","err"); return; }
  setAuthMessage("Criando conta...");
  try{
    const cred=await createUserWithEmailAndPassword(auth,email,p1);
    await updateProfile(cred.user,{displayName:name});
    if(isDirectorEmail(cred.user)){
      await sendEmailVerification(cred.user);
      await signOut(auth);
      showRegister(false);
      document.getElementById("loginEmail").value=email;
      setAuthMessage("Conta da DIRETORIA criada. Enviamos um link de verificação para o e-mail. Confirme o endereço antes de entrar.","ok");
    }else{
      setAuthMessage("Conta criada com sucesso.","ok");
    }
  }catch(err){ setAuthMessage(friendlyAuthError(err),"err"); }
});

document.getElementById("forgotPasswordBtn")?.addEventListener("click",async()=>{
  const email=document.getElementById("loginEmail").value.trim() || prompt("Digite o e-mail da sua conta:");
  if(!email) return;
  try{
    await sendPasswordResetEmail(auth,email);
    setAuthMessage("Enviamos as instruções para redefinir sua senha.","ok");
  }catch(err){ setAuthMessage(friendlyAuthError(err),"err"); }
});
document.getElementById("logoutBtn")?.addEventListener("click",()=>signOut(auth));

function applyRoleUI(){
  const director=isDirector();
  currentRole=director?"DIRETORIA":"JOGADOR";
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("role-hidden",!director));
  document.getElementById("sessionUserName").textContent=currentUser?.displayName || currentUser?.email?.split("@")[0] || "Usuário";
  document.getElementById("sessionRole").textContent=currentRole;
  document.getElementById("userSession").classList.remove("hidden");
  if(!director && (
      document.getElementById("cadastro")?.classList.contains("active") ||
      document.getElementById("musica")?.classList.contains("active")
    )){
    document.querySelector('[data-page="dashboard"]')?.click();
  }
  renderPlayers(); renderLineup(); renderEvents(); renderMatches(); renderScorers(); renderMusicAdmin(); updateMusicPlayerUI();
}

onAuthStateChanged(auth,async user=>{
  if(user){
    currentUser=user;
    if(isDirectorEmail(user) && !user.emailVerified){
      document.body.classList.add("auth-pending");
      document.getElementById("authGate").classList.remove("hidden");
      document.getElementById("userSession").classList.add("hidden");
      setAuthMessage("Para acessar como DIRETORIA, confirme primeiro o link enviado ao seu e-mail.","warn");
      return;
    }
    document.body.classList.remove("auth-pending");
    document.getElementById("authGate").classList.add("hidden");
    applyRoleUI();
    connectRealtime();
    startPresence();
    startChat();
  }else{
    stopPresence(); stopChat();
    currentUser=null; currentRole="JOGADOR";
    document.body.classList.add("auth-pending");
    document.getElementById("authGate").classList.remove("hidden");
    document.getElementById("userSession").classList.add("hidden");
    setSyncStatus("🔒 Faça login");
  }
});


document.getElementById("onlineCountBtn")?.addEventListener("click",()=>{
  if(!isDirector()){toast(`${activeOnlineUsers().length} usuário(s) online.`);return;}
  document.querySelector('[data-page="chat"]')?.click();
  document.getElementById("onlineUsersPanel")?.classList.toggle("hidden");
});
const chatInputEl=document.getElementById("chatInput"), chatCharCountEl=document.getElementById("chatCharCount");
function updateChatCharCount(){if(!chatInputEl||!chatCharCountEl)return;const n=chatInputEl.value.length;chatCharCountEl.textContent=`${n} / 300`;chatCharCountEl.classList.toggle("near-limit",n>=250&&n<300);chatCharCountEl.classList.toggle("at-limit",n>=300);}
chatInputEl?.addEventListener("input",updateChatCharCount);updateChatCharCount();
document.getElementById("chatForm")?.addEventListener("submit",async e=>{e.preventDefault();const text=chatInputEl?.value||"";if(!text.trim())return;const b=document.getElementById("chatSendBtn");if(b){b.disabled=true;b.textContent="Enviando...";}const ok=await sendChat(text);if(ok&&chatInputEl){chatInputEl.value="";updateChatCharCount();chatInputEl.focus();}if(b){b.disabled=false;b.textContent="Enviar";}});
chatInputEl?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();document.getElementById("chatForm")?.requestSubmit();}});
document.querySelectorAll(".emoji-btn").forEach(b=>b.addEventListener("click",()=>{const i=chatInputEl;if(!i)return;const em=b.textContent||"",s=i.selectionStart??i.value.length,en=i.selectionEnd??i.value.length;i.value=i.value.slice(0,s)+em+i.value.slice(en);const p=s+em.length;i.setSelectionRange?.(p,p);i.focus();updateChatCharCount();}));
document.getElementById("chatMessages")?.addEventListener("click",e=>{const d=e.target.closest("[data-chat-delete]"),p=e.target.closest("[data-chat-pin]");if(d)removeChat(d.dataset.chatDelete);if(p)pinChat(p.dataset.chatPin);});
document.getElementById("chatPinned")?.addEventListener("click",e=>{if(e.target.closest("#unpinChatBtn"))unpinChat();});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){presenceBeat();if(currentUser)startChat();}});
window.addEventListener("focus",()=>{presenceBeat();if(currentUser)startChat();});

document.getElementById("statsSeasonSelect")?.addEventListener("change",event=>{
 selectedStatsSeason=event.target.value||"all";
 renderStats();
});
document.getElementById("generateStatsPdf")?.addEventListener("click",generateStatisticsPdf);

window.editPlayer=editPlayer;
window.deletePlayer=deletePlayer;
window.toggleLineup=toggleLineup;
window.editEvent=editEvent;
window.deleteEvent=deleteEvent;
window.generatePoster=generatePoster;
window.setScore=setScore;
window.setGoals=setGoals;

renderPlayers(); renderLineup(); renderEvents(); renderMatches(); renderStats(); renderScorers(); renderCalendar(); renderLogo(); renderDashboardMedia(); renderMusicAdmin(); updateMusicPlayerUI();
