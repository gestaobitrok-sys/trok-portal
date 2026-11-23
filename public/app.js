'use strict';
const TOKEN_KEY = 'trok_portal_token';
let usuario = null, sitesDoUsuario = [], todosUsuarios = [], todosSites = [];

const $ = id => document.getElementById(id);
function el(tag, props, ...filhos){
  const e = document.createElement(tag);
  Object.entries(props || {}).forEach(([k,v])=>{
    if(k === 'class') e.className = v;
    else if(k === 'text') e.textContent = v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  filhos.flat().forEach(f=> e.append(f));
  return e;
}
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), 3000);
}
function guardarToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch(e){} }
function lerToken(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } }
function limparToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} }

async function api(caminho, opcoes){
  const o = Object.assign({method:'GET'}, opcoes || {});
  o.headers = Object.assign({'Content-Type':'application/json'}, o.headers || {});
  const t = lerToken(); if(t) o.headers.Authorization = 'Bearer ' + t;
  if(o.body && typeof o.body !== 'string') o.body = JSON.stringify(o.body);
  let r;
  try{ r = await fetch(caminho, o); }catch(e){ throw new Error('Sem conexão com o servidor.'); }
  let dados = null; try{ dados = await r.json(); }catch(e){}
  if(!r.ok){
    if(r.status === 401 && caminho !== '/api/login'){ sair(); throw new Error((dados && dados.erro) || 'Sessão expirada.'); }
    throw new Error((dados && dados.erro) || ('Erro ' + r.status));
  }
  return dados;
}

// ---------- login / sessão ----------
function mostrarLogin(){ $('telaPortal').classList.add('hidden'); $('telaLogin').classList.remove('hidden'); $('lgSenha').value=''; }
function sair(){ limparToken(); usuario = null; fecharModal(); mostrarLogin(); }
$('btnSair').addEventListener('click', sair);

$('formLogin').addEventListener('submit', async ev=>{
  ev.preventDefault();
  const btn = ev.target.querySelector('button'); btn.disabled = true; $('lgErro').textContent = '';
  try{
    const r = await api('/api/login', {method:'POST', body:{email:$('lgEmail').value, senha:$('lgSenha').value}});
    guardarToken(r.token); usuario = r.usuario; await abrirPortal();
  }catch(e){ $('lgErro').textContent = e.message; }
  btn.disabled = false;
});

async function abrirPortal(){
  $('telaLogin').classList.add('hidden'); $('telaPortal').classList.remove('hidden');
  $('nomeUsuario').textContent = usuario.nome + (usuario.role==='admin' ? ' (administrador)' : '');
  $('abas').classList.toggle('hidden', usuario.role !== 'admin');
  trocarAba('sites');
  await carregarMeusSites();
}

function trocarAba(nome){
  document.querySelectorAll('.aba').forEach(b=> b.classList.toggle('ativa', b.dataset.aba === nome));
  $('painelSites').classList.toggle('hidden', nome !== 'sites');
  $('painelUsuarios').classList.toggle('hidden', nome !== 'usuarios');
  $('painelCadSites').classList.toggle('hidden', nome !== 'cadastroSites');
  if(nome === 'usuarios') carregarUsuarios();
  if(nome === 'cadastroSites') carregarCadSites();
  if(nome === 'sites') carregarMeusSites();
}
document.querySelectorAll('.aba').forEach(b=> b.addEventListener('click', ()=> trocarAba(b.dataset.aba)));

// ---------- meus sistemas ----------
function urlSegura(u){ try{ const x = new URL(u); return (x.protocol==='https:'||x.protocol==='http:') ? x.href : null; }catch(e){ return null; } }
async function carregarMeusSites(){
  try{ sitesDoUsuario = await api('/api/meus-sites'); }catch(e){ toast(e.message); return; }
  const g = $('gradeSites'); g.textContent = '';
  sitesDoUsuario.forEach(s=>{
    const href = urlSegura(s.url); if(!href) return;
    g.append(el('a', {class:'siteCard', href, target:'_blank', rel:'noopener noreferrer'},
      el('div', {class:'ic', text:s.icone || '🌐'}),
      el('div', {class:'nm', text:s.nome}),
      el('div', {class:'ds', text:s.descricao || ''})));
  });
  $('semSites').classList.toggle('hidden', g.children.length > 0);
}

// ---------- trocar senha ----------
$('btnSenha').addEventListener('click', ()=>{
  const atual = el('input', {type:'password', autocomplete:'current-password'});
  const nova = el('input', {type:'password', autocomplete:'new-password'});
  const erro = el('div', {class:'erro'});
  abrirModal(el('h3', {text:'Trocar minha senha'}),
    el('label', {text:'Senha atual'}, atual), el('label', {text:'Nova senha (mín. 8 caracteres)'}, nova), erro,
    el('div', {class:'modalBts'},
      el('button', {class:'btn sec', type:'button', text:'Cancelar', onclick:fecharModal}),
      el('button', {class:'btn', type:'button', text:'Salvar', onclick: async ()=>{
        try{ await api('/api/minha-senha', {method:'PUT', body:{senhaAtual:atual.value, novaSenha:nova.value}}); fecharModal(); toast('Senha alterada!'); }
        catch(e){ erro.textContent = e.message; }
      }})));
});

// ---------- modal ----------
function abrirModal(...filhos){ const c = $('modalCaixa'); c.textContent = ''; filhos.forEach(f=> c.append(f)); $('modal').classList.remove('hidden'); }
function fecharModal(){ $('modal').classList.add('hidden'); }
$('modal').addEventListener('mousedown', ev=>{ if(ev.target === $('modal')) fecharModal(); });

// ---------- admin: usuários ----------
async function carregarUsuarios(){
  try{ [todosUsuarios, todosSites] = await Promise.all([api('/api/admin/usuarios'), api('/api/admin/sites')]); }catch(e){ toast(e.message); return; }
  const box = $('listaUsuarios'); box.textContent = '';
  if(!todosUsuarios.length) box.append(el('p', {class:'muted', text:'Nenhum usuário cadastrado.'}));
  todosUsuarios.forEach(u=>{
    const nomesSites = u.role === 'admin' ? 'Todos os sites' : (u.sites.map(id=> (todosSites.find(s=>s.id===id)||{}).nome).filter(Boolean).join(', ') || 'Nenhum site liberado');
    box.append(el('div', {class:'item'},
      el('div', {class:'info'},
        el('div', {}, el('b', {text:u.nome}), u.role==='admin' ? el('span',{class:'tag adm',text:'ADMIN'}) : '', u.ativo ? '' : el('span',{class:'tag off',text:'DESATIVADO'})),
        el('span', {class:'muted', text:u.email}),
        el('span', {class:'muted', text:'Acesso: ' + nomesSites})),
      el('div', {class:'acoes'},
        el('button', {class:'btn sec', text:'Editar', onclick:()=> formUsuario(u)}),
        el('button', {class:'btn perigo', text:'Excluir', onclick: async ()=>{
          if(!confirm('Excluir o usuário ' + u.nome + '?')) return;
          try{ await api('/api/admin/usuarios/' + u.id, {method:'DELETE'}); toast('Usuário excluído.'); carregarUsuarios(); }catch(e){ toast(e.message); }
        }}))));
  });
}
$('novoUsuario').addEventListener('click', ()=> formUsuario(null));

function formUsuario(u){
  const novo = !u;
  const nome = el('input', {type:'text', value:u ? u.nome : ''});
  const email = el('input', {type:'email', value:u ? u.email : '', autocomplete:'off'});
  const senha = el('input', {type:'password', autocomplete:'new-password', placeholder: novo ? 'mínimo 8 caracteres' : 'deixe em branco para manter a atual'});
  const role = el('select', {}, el('option', {value:'usuario', text:'Funcionário (vê só os sites liberados)'}), el('option', {value:'admin', text:'Administrador (todos os sites + gestão)'}));
  role.value = u ? u.role : 'usuario';
  const ativo = el('input', {type:'checkbox'}); ativo.checked = u ? u.ativo : true;
  const checks = todosSites.map(s=>{
    const c = el('input', {type:'checkbox', value:String(s.id)}); c.checked = !!(u && u.sites.includes(s.id));
    return {c, label: el('label', {}, c, el('span', {text:(s.icone||'🌐') + ' ' + s.nome + (s.ativo ? '' : ' (inativo)')}))};
  });
  const erro = el('div', {class:'erro'});
  const bloco = el('div', {class:'checks'}, checks.length ? checks.map(x=>x.label) : el('span', {class:'muted', text:'Cadastre os sites primeiro na aba "Cadastro de sites".'}));
  const atualizarBloco = ()=>{ bloco.style.opacity = role.value==='admin' ? .5 : 1; };
  role.addEventListener('change', atualizarBloco); atualizarBloco();
  abrirModal(el('h3', {text: novo ? 'Novo usuário' : 'Editar usuário'}),
    el('label', {text:'Nome'}, nome), el('label', {text:'E-mail (login)'}, email), el('label', {text: novo ? 'Senha' : 'Nova senha'}, senha),
    el('label', {text:'Perfil'}, role),
    el('div', {}, el('b', {text:'Sites liberados'}), bloco),
    el('label', {style:'flex-direction:row;align-items:center;gap:8px'}, ativo, el('span', {text:'Usuário ativo (pode entrar no portal)'})),
    erro,
    el('div', {class:'modalBts'},
      el('button', {class:'btn sec', type:'button', text:'Cancelar', onclick:fecharModal}),
      el('button', {class:'btn', type:'button', text:'Salvar', onclick: async ev=>{
        const btn = ev.currentTarget; btn.disabled = true; erro.textContent = '';
        const corpo = {nome:nome.value, email:email.value, role:role.value, ativo:ativo.checked, sites:checks.filter(x=>x.c.checked).map(x=>Number(x.c.value))};
        if(senha.value || novo) corpo.senha = senha.value;
        try{
          await api(novo ? '/api/admin/usuarios' : '/api/admin/usuarios/' + u.id, {method: novo ? 'POST' : 'PUT', body:corpo});
          fecharModal(); toast('Usuário salvo!'); carregarUsuarios();
        }catch(e){ erro.textContent = e.message; btn.disabled = false; }
      }})));
}

// ---------- admin: cadastro de sites ----------
async function carregarCadSites(){
  try{ todosSites = await api('/api/admin/sites'); }catch(e){ toast(e.message); return; }
  const box = $('listaCadSites'); box.textContent = '';
  if(!todosSites.length) box.append(el('p', {class:'muted', text:'Nenhum site cadastrado ainda. Clique em "+ Novo site".'}));
  todosSites.forEach(s=>{
    box.append(el('div', {class:'item'},
      el('div', {class:'info'},
        el('div', {}, el('b', {text:(s.icone||'🌐') + ' ' + s.nome}), s.ativo ? '' : el('span',{class:'tag off',text:'INATIVO'})),
        el('span', {class:'muted', text:s.url}),
        s.descricao ? el('span', {class:'muted', text:s.descricao}) : ''),
      el('div', {class:'acoes'},
        el('button', {class:'btn sec', text:'Editar', onclick:()=> formSite(s)}),
        el('button', {class:'btn perigo', text:'Excluir', onclick: async ()=>{
          if(!confirm('Excluir o site ' + s.nome + '? Ele some do portal de todos (o site em si não é afetado).')) return;
          try{ await api('/api/admin/sites/' + s.id, {method:'DELETE'}); toast('Site removido do portal.'); carregarCadSites(); }catch(e){ toast(e.message); }
        }}))));
  });
}
$('novoSite').addEventListener('click', ()=> formSite(null));

function formSite(s){
  const novo = !s;
  const nome = el('input', {type:'text', value:s ? s.nome : ''});
  const url = el('input', {type:'url', value:s ? s.url : '', placeholder:'https://...'});
  const desc = el('input', {type:'text', value:s ? s.descricao : '', maxlength:'200'});
  const icone = el('input', {type:'text', value:s ? s.icone : '🌐', maxlength:'8'});
  const ativo = el('input', {type:'checkbox'}); ativo.checked = s ? s.ativo : true;
  const erro = el('div', {class:'erro'});
  abrirModal(el('h3', {text: novo ? 'Novo site' : 'Editar site'}),
    el('label', {text:'Nome'}, nome), el('label', {text:'Endereço (link completo)'}, url),
    el('label', {text:'Descrição curta (opcional)'}, desc), el('label', {text:'Ícone (um emoji)'}, icone),
    el('label', {style:'flex-direction:row;align-items:center;gap:8px'}, ativo, el('span', {text:'Ativo (aparece no portal)'})),
    erro,
    el('div', {class:'modalBts'},
      el('button', {class:'btn sec', type:'button', text:'Cancelar', onclick:fecharModal}),
      el('button', {class:'btn', type:'button', text:'Salvar', onclick: async ev=>{
        const btn = ev.currentTarget; btn.disabled = true; erro.textContent = '';
        try{
          await api(novo ? '/api/admin/sites' : '/api/admin/sites/' + s.id, {method: novo ? 'POST' : 'PUT', body:{nome:nome.value, url:url.value.trim(), descricao:desc.value, icone:icone.value, ativo:ativo.checked}});
          fecharModal(); toast('Site salvo!'); carregarCadSites();
        }catch(e){ erro.textContent = e.message; btn.disabled = false; }
      }})));
}

// ---------- início ----------
(async function iniciar(){
  if(!lerToken()){ mostrarLogin(); return; }
  try{ usuario = await api('/api/me'); await abrirPortal(); }catch(e){ mostrarLogin(); }
})();
