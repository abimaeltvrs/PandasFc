// pandas-push-worker.js — Cloudflare Worker / backend seguro
// Configure os secrets ONESIGNAL_REST_API_KEY e (opcionalmente) ONESIGNAL_APP_ID.
// NUNCA coloque a REST API Key dentro do app.js público.

const DEFAULT_APP_ID = 'ad62bcf9-471a-499b-b65c-b7a11727b943';
const ALLOWED_ORIGIN = 'https://abimaeltvrs.github.io';

function corsHeaders(origin){
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json;charset=UTF-8'
  };
}

export default {
  async fetch(request, env){
    const origin=request.headers.get('Origin')||'';
    const headers=corsHeaders(origin);
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(request.method!=='POST') return new Response(JSON.stringify({error:'Método não permitido'}),{status:405,headers});
    if(origin && origin!==ALLOWED_ORIGIN) return new Response(JSON.stringify({error:'Origem não permitida'}),{status:403,headers});
    if(!env.ONESIGNAL_REST_API_KEY) return new Response(JSON.stringify({error:'ONESIGNAL_REST_API_KEY não configurada'}),{status:500,headers});

    let body;
    try{ body=await request.json(); }catch{ return new Response(JSON.stringify({error:'JSON inválido'}),{status:400,headers}); }
    const {eventId,opponent,date,time,location,reminderMinutes}=body||{};
    if(!eventId || !opponent || !date || !time) return new Response(JSON.stringify({error:'Dados da partida incompletos'}),{status:400,headers});

    const matchAt=new Date(`${date}T${time}:00-03:00`); // Fortaleza/Brasília
    if(Number.isNaN(matchAt.getTime())) return new Response(JSON.stringify({error:'Data/hora inválida'}),{status:400,headers});
    const sendAt=new Date(matchAt.getTime()-(Number(reminderMinutes)||60)*60000);
    if(sendAt.getTime()<=Date.now()) return new Response(JSON.stringify({error:'O horário do lembrete já passou'}),{status:400,headers});

    const mins=Number(reminderMinutes)||60;
    const when=mins===1440?'1 dia':mins>=60?(mins/60===1?'1 hora':`${mins/60} horas`):`${mins} minutos`;
    const payload={
      app_id:env.ONESIGNAL_APP_ID || DEFAULT_APP_ID,
      included_segments:['Subscribed Users'],
      headings:{en:'⚽ JOGO DO PANDAS FC!'},
      contents:{en:`PANDAS FC × ${opponent} — ${date.split('-').reverse().join('/')} às ${time}${location?` • ${location}`:''}. Faltam ${when}!`},
      send_after:sendAt.toISOString(),
      data:{type:'match_reminder',eventId}
    };

    const r=await fetch('https://api.onesignal.com/notifications',{
      method:'POST',
      headers:{'Authorization':`Key ${env.ONESIGNAL_REST_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const result=await r.json().catch(()=>({}));
    return new Response(JSON.stringify(result),{status:r.status,headers});
  }
};
