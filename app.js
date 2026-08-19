const STORE_KEY = 'pandasfc_data_v4';
const state = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {
  players: [],
  events: [],
  teamLogo: '',
  selectedLineup: []
};

function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); renderAll(); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fileToDataURL(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); }); }

document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.page).classList.add('active');
}));

const playerForm = document.getElementById('playerForm');
playerForm.addEventListener('submit', e=>{
  e.preventDefault();
  const id=document.getElementById('playerId').value;
  const obj={
    id:id||uid(),
    name:document.getElementById('playerName').value.trim(),
    position:document.getElementById('playerPosition').value,
    number:Number(document.getElementById('playerNumber').value),
    goals:0
  };
  if(id){
    const i=state.players.findIndex(p=>p.id===id);
    obj.goals=state.players[i]?.goals||0;
    state.players[i]=obj;
  } else state.players.push(obj);
  playerForm.reset(); document.getElementById('playerId').value=''; toast('Jogador salvo.'); save();
});
document.getElementById('cancelPlayerEdit').onclick=()=>{playerForm.reset();document.getElementById('playerId').value='';};
document.getElementById('playerSearch').addEventListener('input',renderPlayers);

function editPlayer(id){
  const p=state.players.find(x=>x.id===id); if(!p)return;
  document.getElementById('playerId').value=p.id; document.getElementById('playerName').value=p.name;
  document.getElementById('playerPosition').value=p.position; document.getElementById('playerNumber').value=p.number;
  document.querySelector('[data-page="cadastro"]').click();
}
function deletePlayer(id){
  if(!confirm('Excluir este jogador?'))return;
  state.players=state.players.filter(p=>p.id!==id); state.selectedLineup=state.selectedLineup.filter(x=>x!==id); save();
}
function renderPlayers(){
  const q=document.getElementById('playerSearch').value.toLowerCase();
  const arr=state.players.filter(p=>`${p.name} ${p.position} ${p.number}`.toLowerCase().includes(q));
  document.getElementById('playersList').innerHTML=arr.length?arr.map(p=>`
    <div class="list-row">
      <div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div>
      <div class="actions"><button onclick="editPlayer('${p.id}')">✏️ Editar</button><button onclick="deletePlayer('${p.id}')">🗑️ Excluir</button></div>
    </div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}

function renderLineup(){
  document.getElementById('lineupPlayers').innerHTML=state.players.length?state.players.map(p=>`
    <label class="check-item"><input type="checkbox" ${state.selectedLineup.includes(p.id)?'checked':''} onchange="toggleLineup('${p.id}',this.checked)">
    <span><strong>#${p.number} ${esc(p.name)}</strong><br><span class="muted">${esc(p.position)}</span></span></label>`).join(''):'<p class="muted">Cadastre jogadores primeiro.</p>';
  renderField();
}
function toggleLineup(id,on){ if(on&&!state.selectedLineup.includes(id))state.selectedLineup.push(id); if(!on)state.selectedLineup=state.selectedLineup.filter(x=>x!==id); save(); }

const positionSlots={
 'Goleiro':[[50,91],[50,9]],
 'Zagueiro':[[30,77],[50,80],[70,77],[35,23],[65,23]],
 'Lateral':[[12,70],[88,70],[12,30],[88,30]],
 'Volante':[[38,62],[62,62],[38,38],[62,38]],
 'Meio-campo':[[25,52],[50,54],[75,52],[50,46]],
 'Atacante':[[30,24],[50,19],[70,24],[30,76],[70,76]]
};
function getPlayerSlots(players){
  const used={}; return players.map((p,idx)=>{
    const slots=positionSlots[p.position]||[[20+((idx*17)%60),50]];
    used[p.position]=(used[p.position]||0);
    const pos=slots[used[p.position]%slots.length]; used[p.position]++;
    return {p,x:pos[0],y:pos[1]};
  });
}
function renderField(){
  const players=state.selectedLineup.map(id=>state.players.find(p=>p.id===id)).filter(Boolean);
  const slots=getPlayerSlots(players);
  document.getElementById('fieldPlayers').innerHTML=slots.map(({p,x,y})=>`<div class="field-player" style="left:${x}%;top:${y}%">#${p.number}<br>${esc(p.name)}</div>`).join('');
}

document.getElementById('downloadLineup').onclick=()=>downloadLineupImage();
function downloadLineupImage(){
  const c=document.createElement('canvas'); c.width=1080;c.height=1350;const x=c.getContext('2d');
  x.fillStyle='#163d1d';x.fillRect(0,0,c.width,c.height);
  for(let i=0;i<10;i++){x.fillStyle=i%2?'#2e7d32':'#388e3c';x.fillRect(i*108,0,108,1350);}
  x.strokeStyle='#fff';x.lineWidth=8;x.strokeRect(40,40,1000,1270);x.beginPath();x.moveTo(40,675);x.lineTo(1040,675);x.stroke();
  x.beginPath();x.arc(540,675,110,0,Math.PI*2);x.stroke();x.strokeRect(260,40,560,220);x.strokeRect(260,1090,560,220);
  x.fillStyle='#fff';x.textAlign='center';x.font='bold 46px Arial';x.fillText('PANDAS FC - ESCALAÇÃO',540,100);
  const players=state.selectedLineup.map(id=>state.players.find(p=>p.id===id)).filter(Boolean); const slots=getPlayerSlots(players);
  slots.forEach(({p,x:px,y:py})=>{const cx=40+(px/100)*1000,cy=40+(py/100)*1270;x.fillStyle='#111';x.beginPath();x.arc(cx,cy,50,0,Math.PI*2);x.fill();x.strokeStyle='#fff';x.lineWidth=4;x.stroke();x.fillStyle='#fff';x.font='bold 26px Arial';x.fillText(`#${p.number}`,cx,cy-2);x.font='bold 20px Arial';x.fillText(p.name,cx,cy+27);});
  downloadCanvas(c,'escalacao-pandas-fc.png');
}
function downloadCanvas(c,name){const a=document.createElement('a');a.download=name;a.href=c.toDataURL('image/png');a.click();}

const eventForm=document.getElementById('eventForm');
eventForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=document.getElementById('eventId').value; let logo='';
  const old=state.events.find(x=>x.id===id); if(old)logo=old.logo||'';
  const f=document.getElementById('opponentLogo').files[0]; if(f)logo=await fileToDataURL(f);
  const obj={id:id||uid(),opponent:document.getElementById('opponentName').value.trim(),logo,date:document.getElementById('matchDate').value,time:document.getElementById('matchTime').value,location:document.getElementById('matchLocation').value.trim(),goalsFor:old?.goalsFor??'',goalsAgainst:old?.goalsAgainst??''};
  if(id){const i=state.events.findIndex(x=>x.id===id);state.events[i]=obj;}else state.events.push(obj);
  eventForm.reset();document.getElementById('eventId').value='';toast('Confronto salvo.');save();
});
document.getElementById('cancelEventEdit').onclick=()=>{eventForm.reset();document.getElementById('eventId').value='';};
function editEvent(id){const e=state.events.find(x=>x.id===id);if(!e)return;document.getElementById('eventId').value=e.id;document.getElementById('opponentName').value=e.opponent;document.getElementById('matchDate').value=e.date;document.getElementById('matchTime').value=e.time;document.getElementById('matchLocation').value=e.location;}
function deleteEvent(id){if(!confirm('Excluir este confronto?'))return;state.events=state.events.filter(e=>e.id!==id);save();}
function statusOf(e){if(e.goalsFor===''||e.goalsAgainst==='')return '';const a=Number(e.goalsFor),b=Number(e.goalsAgainst);return a>b?'VITÓRIA':a<b?'DERROTA':'EMPATE';}
function renderEvents(){
  const sorted=[...state.events].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  document.getElementById('eventsList').innerHTML=sorted.length?sorted.map(e=>`
   <div class="list-row"><div class="match-main">${e.logo?`<img class="opponent-logo" src="${e.logo}">`:''}<div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div></div></div>
   <div class="actions"><button onclick="editEvent('${e.id}')">✏️</button><button onclick="generatePoster('${e.id}')">🖼️ Arte</button><button onclick="deleteEvent('${e.id}')">🗑️</button></div></div>`).join(''):'<p class="muted">Nenhuma partida agendada.</p>';
}
function renderMatches(){
 document.getElementById('matchesList').innerHTML=state.events.length?state.events.map(e=>{
   const st=statusOf(e),cls=st==='VITÓRIA'?'win':st==='DERROTA'?'loss':st==='EMPATE'?'draw':'';
   return `<div class="card list-row"><div><strong>PANDAS FC × ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)} • ${e.time} • ${esc(e.location)}</div>${st?`<div class="status ${cls}">${st}</div>`:''}</div>
   <div class="score-inputs"><input type="number" min="0" value="${e.goalsFor}" placeholder="0" onchange="setScore('${e.id}','goalsFor',this.value)"><strong>×</strong><input type="number" min="0" value="${e.goalsAgainst}" placeholder="0" onchange="setScore('${e.id}','goalsAgainst',this.value)"></div></div>`;
 }).join(''):'<div class="card"><p class="muted">Cadastre confrontos na Agenda.</p></div>';
}
function setScore(id,key,v){const e=state.events.find(x=>x.id===id);if(!e)return;e[key]=v===''?'':Number(v);save();}
function formatDate(s){if(!s)return'';const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;}

async function generatePoster(id){
 const e=state.events.find(x=>x.id===id);if(!e)return;
 const c=document.createElement('canvas');c.width=1080;c.height=1350;const x=c.getContext('2d');
 const g=x.createLinearGradient(0,0,1080,1350);g.addColorStop(0,'#080808');g.addColorStop(1,'#363636');x.fillStyle=g;x.fillRect(0,0,1080,1350);
 x.fillStyle='#fff';x.textAlign='center';x.font='bold 54px Arial';x.fillText('DIA DE JOGO',540,130);x.font='bold 42px Arial';x.fillText('PANDAS FC',300,560);x.fillText(e.opponent,780,560);x.font='bold 70px Arial';x.fillText('X',540,560);
 x.font='bold 36px Arial';x.fillText(`${formatDate(e.date)} • ${e.time}`,540,850);x.font='32px Arial';x.fillText(e.location,540,910);
 if(state.teamLogo){try{const im=await loadImage(state.teamLogo);drawContain(x,im,150,260,300,220);}catch{}}
 else {x.font='150px Arial';x.fillText('🐼',300,430);}
 if(e.logo){try{const im=await loadImage(e.logo);drawContain(x,im,630,260,300,220);}catch{}}
 downloadCanvas(c,`pandas-fc-x-${e.opponent.replace(/\s+/g,'-').toLowerCase()}.png`);
}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
function drawContain(ctx,img,x,y,w,h){const r=Math.min(w/img.width,h/img.height),nw=img.width*r,nh=img.height*r;ctx.drawImage(img,x+(w-nw)/2,y+(h-nh)/2,nw,nh);}

function renderStats(){
 const done=state.events.filter(e=>e.goalsFor!==''&&e.goalsAgainst!=='');let w=0,d=0,l=0,gf=0,ga=0;
 done.forEach(e=>{const a=Number(e.goalsFor),b=Number(e.goalsAgainst);gf+=a;ga+=b;if(a>b)w++;else if(a<b)l++;else d++;});
 const pts=w*3+d,ap=done.length?Math.round((pts/(done.length*3))*100):0;
 const cards=[['Jogos',done.length],['Vitórias',w],['Empates',d],['Derrotas',l],['Gols marcados',gf],['Gols sofridos',ga],['Saldo',gf-ga],['Aproveitamento',ap+'%']];
 document.getElementById('statsCards').innerHTML=cards.map(([a,b])=>`<div class="stat-card"><span>${a}</span><strong>${b}</strong></div>`).join('');
 document.getElementById('historyList').innerHTML=done.length?[...done].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(e=>`<div class="list-row"><div><strong>PANDAS FC ${e.goalsFor} × ${e.goalsAgainst} ${esc(e.opponent)}</strong><div class="muted">${formatDate(e.date)}</div></div><span class="status ${statusOf(e)==='VITÓRIA'?'win':statusOf(e)==='DERROTA'?'loss':'draw'}">${statusOf(e)}</span></div>`).join(''):'<p class="muted">Nenhuma partida finalizada.</p>';
}
function renderScorers(){
 const arr=[...state.players].sort((a,b)=>(b.goals||0)-(a.goals||0)||a.name.localeCompare(b.name));
 document.getElementById('scorersList').innerHTML=arr.length?arr.map((p,i)=>`<div class="list-row"><div style="display:flex;align-items:center;gap:12px"><div class="rank-badge">${i+1}</div><div><strong>#${p.number} ${esc(p.name)}</strong><div class="muted">${esc(p.position)}</div></div></div><label>Gols <input class="goal-input" type="number" min="0" value="${p.goals||0}" onchange="setGoals('${p.id}',this.value)"></label></div>`).join(''):'<p class="muted">Nenhum jogador cadastrado.</p>';
}
function setGoals(id,v){const p=state.players.find(x=>x.id===id);if(!p)return;p.goals=Math.max(0,Number(v)||0);save();}

let calDate=new Date();document.getElementById('prevMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()-1);renderCalendar();};document.getElementById('nextMonth').onclick=()=>{calDate.setMonth(calDate.getMonth()+1);renderCalendar();};
function renderCalendar(){
 const y=calDate.getFullYear(),m=calDate.getMonth();document.getElementById('calendarTitle').textContent=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(calDate);
 const root=document.getElementById('calendar');const dows=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];let html=dows.map(d=>`<div class="dow">${d}</div>`).join('');
 const first=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();for(let i=0;i<first;i++)html+='<div></div>';
 for(let d=1;d<=days;d++){const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const ev=state.events.some(e=>e.date===ds);html+=`<div class="day ${ev?'has-event':''}" title="${ev?'Há partida neste dia':''}">${d}</div>`;}root.innerHTML=html;
}

document.getElementById('teamLogoInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;state.teamLogo=await fileToDataURL(f);toast('Logo atualizada.');save();});
function renderLogo(){const img=document.getElementById('dashboardLogo'),ph=document.getElementById('dashboardPlaceholder');if(state.teamLogo){img.src=state.teamLogo;img.classList.remove('hidden');ph.classList.add('hidden');}else{img.classList.add('hidden');ph.classList.remove('hidden');}}

document.getElementById('clearDataBtn').onclick=()=>{if(confirm('Apagar todos os dados do PANDAS FC neste dispositivo?')){localStorage.removeItem(STORE_KEY);location.reload();}};
document.getElementById('notifyBtn').onclick=async()=>{if(!('Notification'in window)){alert('Este navegador não suporta notificações.');return;}const p=await Notification.requestPermission();toast(p==='granted'?'Notificações ativadas.':'Permissão não concedida.');};
function checkTodayMatches(){
 if(!('Notification'in window)||Notification.permission!=='granted')return;
 const today=new Date().toISOString().slice(0,10);const k='pandasfc_notified_'+today;if(localStorage.getItem(k))return;
 const evs=state.events.filter(e=>e.date===today);if(!evs.length)return;
 evs.forEach(e=>new Notification('⚽ Hoje tem PANDAS FC!',{body:`PANDAS FC × ${e.opponent} • ${e.time} • ${e.location}`,icon:'./icon-192.png'}));localStorage.setItem(k,'1');
}

let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
async function installApp(){
 if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;return;}
 alert('Se a instalação automática não abrir, no Android use o menu ⋮ do Chrome e escolha “Instalar app” ou “Adicionar à tela inicial”. No computador, procure o ícone de instalação na barra de endereço do Chrome/Edge.');
}
document.getElementById('installBtn').onclick=installApp;document.getElementById('installBtn2').onclick=installApp;
window.addEventListener('appinstalled',()=>toast('PANDAS FC instalado com sucesso.'));
if('serviceWorker'in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));}

function renderAll(){renderPlayers();renderLineup();renderEvents();renderMatches();renderStats();renderScorers();renderCalendar();renderLogo();}
renderAll();checkTodayMatches();
