var _S='https://lzgztviajtcthqgekvrr.supabase.co';
var _A='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6Z3p0dmlhanRjdGhxZ2VrdnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2ODc2OTgsImV4cCI6MjA4OTI2MzY5OH0.RN3a0gfygXo9BsGZpwaVLIgbQv8AO0K6-dWF0SIazTw';
var _T=sessionStorage.getItem('qf_adm')||null;

function admAbrir(){
  document.getElementById('modal-login').style.display='flex';
}
function admFechar(){
  document.getElementById('modal-login').style.display='none';
  document.getElementById('adm-erro').style.display='none';
}
function admFecharGer(){
  document.getElementById('modal-gerenciar').style.display='none';
  document.body.style.overflow='';
}

async function admEntrar(){
  var email=document.getElementById('adm-email').value.trim();
  var senha=document.getElementById('adm-senha').value;
  var erro=document.getElementById('adm-erro');
  erro.style.display='none';
  if(!email||!senha){erro.textContent='Preencha e-mail e senha.';erro.style.display='block';return;}
  try{
    var r=await fetch(_S+'/auth/v1/token?grant_type=password',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':_A},
      body:JSON.stringify({email:email,password:senha})
    });
    var d=await r.json();
    if(!d.access_token){erro.textContent=d.error_description||'E-mail ou senha incorretos.';erro.style.display='block';return;}
    var chk=await fetch(_S+'/rest/v1/admins?email=eq.'+encodeURIComponent(email)+'&select=email',{
      headers:{'apikey':_A,'Authorization':'Bearer '+d.access_token}
    });
    var admins=await chk.json();
    if(!Array.isArray(admins)||admins.length===0){erro.textContent='Acesso negado.';erro.style.display='block';return;}
    _T=d.access_token;
    sessionStorage.setItem('qf_adm',_T);
    admFechar();
    document.getElementById('adm-bar').style.display='flex';
  }catch(e){erro.textContent='Erro de conexão.';erro.style.display='block';}
}

async function admGerenciar(){
  document.getElementById('modal-gerenciar').style.display='block';
  document.body.style.overflow='hidden';
  var lista=document.getElementById('ger-lista');
  lista.innerHTML='<p style="color:#6b6b80;font-family:monospace;padding:16px">Carregando...</p>';
  try{
    var r=await fetch(_S+'/rest/v1/patrocinadores?order=posicao.asc',{
      headers:{'apikey':_A,'Authorization':'Bearer '+_T}
    });
    var data=await r.json();
    if(!Array.isArray(data)){lista.innerHTML='<p style="color:#ff2020;padding:16px">Execute schema_patrocinadores_v2.sql no Supabase primeiro.</p>';return;}
    lista.innerHTML=data.map(function(p){
      return '<div style="background:#252533;border:1px solid #383842;padding:18px;margin-bottom:10px">'
        +'<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">'
        +'<span style="font-family:monospace;font-size:.65rem;color:#6b6b80">VAGA '+p.posicao+'</span>'
        +'<span style="font-weight:700;font-size:.9rem;color:'+(p.ativo&&p.logo_url?'#00d46a':'#6b6b80')+'">'+(p.ativo&&p.logo_url?'● ATIVO':'○ VAZIA')+'</span>'
        +'</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'
        +'<div><div style="font-family:monospace;font-size:.62rem;color:#6b6b80;margin-bottom:4px">NOME</div>'
        +'<input id="gn'+p.id+'" value="'+(p.nome||'')+'" placeholder="Ex: Padaria do João" style="width:100%;background:#15151e;border:1px solid #383842;color:#fff;padding:8px 12px;outline:none;font-size:.85rem"></div>'
        +'<div><div style="font-family:monospace;font-size:.62rem;color:#6b6b80;margin-bottom:4px">WHATSAPP</div>'
        +'<input id="gw'+p.id+'" value="'+(p.whatsapp||'')+'" placeholder="68999999999" style="width:100%;background:#15151e;border:1px solid #383842;color:#fff;padding:8px 12px;outline:none;font-size:.85rem"></div>'
        +'</div>'
        +'<div style="margin-bottom:12px"><div style="font-family:monospace;font-size:.62rem;color:#6b6b80;margin-bottom:4px">URL DA LOGO</div>'
        +'<input id="gl'+p.id+'" value="'+(p.logo_url||'')+'" placeholder="https://..." style="width:100%;background:#15151e;border:1px solid #383842;color:#fff;padding:8px 12px;outline:none;font-size:.85rem"></div>'
        +'<div style="display:flex;gap:8px;align-items:center">'
        +'<button onclick="gerSalvar('+p.id+')" style="background:#e10600;color:#fff;border:none;padding:8px 20px;cursor:pointer;font-weight:700;font-size:.82rem;text-transform:uppercase">Salvar</button>'
        +(p.ativo&&p.logo_url?'<button onclick="gerLimpar('+p.id+')" style="background:transparent;color:#6b6b80;border:1px solid #383842;padding:8px 16px;cursor:pointer;font-size:.82rem">Limpar</button>':'')
        +'<span id="gok'+p.id+'" style="font-family:monospace;font-size:.75rem;color:#00d46a;display:none">✓ Salvo!</span>'
        +'</div></div>';
    }).join('');
  }catch(e){lista.innerHTML='<p style="color:#ff2020;padding:16px">'+e.message+'</p>';}
}

async function gerSalvar(id){
  var nome=document.getElementById('gn'+id).value.trim();
  var wa=document.getElementById('gw'+id).value.replace(/\D/g,'');
  var logo=document.getElementById('gl'+id).value.trim();
  var r=await fetch(_S+'/rest/v1/patrocinadores?id=eq.'+id,{
    method:'PATCH',
    headers:{'Content-Type':'application/json','apikey':_A,'Authorization':'Bearer '+_T,'Prefer':'return=minimal'},
    body:JSON.stringify({nome:nome,whatsapp:wa||null,logo_url:logo||null,ativo:!!(nome&&logo)})
  });
  var ok=document.getElementById('gok'+id);
  ok.textContent=r.ok?'✓ Salvo!':'✗ Erro';
  ok.style.color=r.ok?'#00d46a':'#ff2020';
  ok.style.display='inline';
  setTimeout(function(){ok.style.display='none';},2500);
  if(r.ok)carregarParceiros();
}

async function gerLimpar(id){
  if(!confirm('Remover patrocinador?'))return;
  await fetch(_S+'/rest/v1/patrocinadores?id=eq.'+id,{
    method:'PATCH',
    headers:{'Content-Type':'application/json','apikey':_A,'Authorization':'Bearer '+_T,'Prefer':'return=minimal'},
    body:JSON.stringify({ativo:false,nome:'Vaga disponível',logo_url:null,whatsapp:null})
  });
  admGerenciar();
}

async function carregarParceiros(){
  try{
    var r=await fetch(_S+'/rest/v1/patrocinadores?order=posicao.asc',{headers:{'apikey':_A}});
    var data=await r.json();
    if(!Array.isArray(data)||data.length===0)return;
    var grid=document.getElementById('parc-grid');
    if(!grid)return;
    grid.innerHTML=data.map(function(p){
      if(!p.ativo||!p.logo_url)return '<a href="parceiros.html" class="parc-vaga"><div class="parc-vaga-ico">＋</div><div class="parc-vaga-txt">Anuncie aqui<br>sua empresa</div></a>';
      var wa=p.whatsapp?'https://wa.me/55'+p.whatsapp+'?text=Ol%C3%A1!':'parceiros.html';
      return '<a href="'+wa+'" target="_blank" class="parc-vaga" style="border-color:rgba(255,255,255,.2)"><img src="'+p.logo_url+'" alt="'+p.nome+'" style="max-width:110px;max-height:55px;object-fit:contain"><div class="parc-vaga-txt" style="color:#f0f0f0">'+p.nome+'</div></a>';
    }).join('');
  }catch(e){}
}

// Event listeners — sem onclick inline
document.addEventListener('DOMContentLoaded', function(){
  var btnAdmin = document.getElementById('btn-admin');
  if(btnAdmin) btnAdmin.addEventListener('click', admAbrir);

  var btnEntrar = document.getElementById('btn-entrar');
  if(btnEntrar) btnEntrar.addEventListener('click', admEntrar);

  var btnFecharLogin = document.getElementById('btn-fechar-login');
  if(btnFecharLogin) btnFecharLogin.addEventListener('click', admFechar);

  var btnCancelar = document.getElementById('btn-cancelar');
  if(btnCancelar) btnCancelar.addEventListener('click', admFechar);

  var btnGerenciar = document.getElementById('btn-gerenciar');
  if(btnGerenciar) btnGerenciar.addEventListener('click', admGerenciar);

  var btnLogout = document.getElementById('btn-logout');
  if(btnLogout) btnLogout.addEventListener('click', function(){
    _T=null; sessionStorage.removeItem('qf_adm');
    document.getElementById('adm-bar').style.display='none';
  });

  var btnFecharGer = document.getElementById('btn-fechar-ger');
  if(btnFecharGer) btnFecharGer.addEventListener('click', admFecharGer);

  var admSenha = document.getElementById('adm-senha');
  if(admSenha) admSenha.addEventListener('keydown', function(e){
    if(e.key==='Enter') admEntrar();
  });

  if(_T) document.getElementById('adm-bar').style.display='flex';
  carregarParceiros();
});
