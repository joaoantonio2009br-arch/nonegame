/* ═══════════════════════════════════════════
   NONESTORE — app.js
   Firebase Realtime DB + Full Game Launcher
═══════════════════════════════════════════ */

'use strict';

/* ─── CONFIG ─── */
const FIREBASE_URL = 'https://saria-24d3f-default-rtdb.firebaseio.com';
const GAMES_JSON   = 'jogos.json';

/* ─── STATE ─── */
let currentUser    = null;
let allGames       = [];
let userLibrary    = [];
let isMobile       = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                  || window.innerWidth <= 768;

/* ═══════════════════════════════════════════
   FIREBASE HELPERS
═══════════════════════════════════════════ */

async function fbGet(path) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`);
  if (!res.ok) throw new Error('Firebase GET falhou');
  return res.json();
}

async function fbSet(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Firebase SET falhou');
  return res.json();
}

async function fbPatch(path, data) {
  const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Firebase PATCH falhou');
  return res.json();
}

/* Hash simples de senha (não criptográfica — apenas ofusca) */
function hashSenha(senha) {
  let h = 5381;
  for (let i = 0; i < senha.length; i++) {
    h = ((h << 5) + h) ^ senha.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/* Sanitiza username como chave Firebase (sem pontos, #, $, /, etc.) */
function sanitizeKey(str) {
  return str.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/* ═══════════════════════════════════════════
   AUTH FUNCTIONS
═══════════════════════════════════════════ */

async function cadastrar() {
  const usuario = document.getElementById('reg-user').value.trim();
  const email   = document.getElementById('reg-email').value.trim();
  const senha   = document.getElementById('reg-pass').value;
  const errEl   = document.getElementById('reg-error');

  errEl.classList.add('hidden');

  if (!usuario || !email || !senha) {
    return mostrarErro(errEl, 'Preencha todos os campos.');
  }
  if (usuario.length < 3) {
    return mostrarErro(errEl, 'Usuário deve ter ao menos 3 caracteres.');
  }
  if (senha.length < 6) {
    return mostrarErro(errEl, 'Senha deve ter ao menos 6 caracteres.');
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return mostrarErro(errEl, 'Email inválido.');
  }

  const key = sanitizeKey(usuario);

  try {
    const existente = await fbGet(`usuarios/${key}`);
    if (existente) {
      return mostrarErro(errEl, 'Nome de usuário já existe.');
    }

    const novoUser = {
      usuario,
      email,
      senha: hashSenha(senha),
      criadoEm: new Date().toISOString(),
      biblioteca: []
    };

    await fbSet(`usuarios/${key}`, novoUser);
    mostrarToast('Conta criada com sucesso!');
    mostrarLogin();

    document.getElementById('login-user').value = usuario;
  } catch (e) {
    mostrarErro(errEl, 'Erro ao cadastrar. Tente novamente.');
    console.error(e);
  }
}

async function logar() {
  const usuario = document.getElementById('login-user').value.trim();
  const senha   = document.getElementById('login-pass').value;
  const errEl   = document.getElementById('login-error');

  errEl.classList.add('hidden');

  if (!usuario || !senha) {
    return mostrarErro(errEl, 'Preencha todos os campos.');
  }

  const key = sanitizeKey(usuario);

  try {
    const userData = await fbGet(`usuarios/${key}`);
    if (!userData) {
      return mostrarErro(errEl, 'Usuário não encontrado.');
    }
    if (userData.senha !== hashSenha(senha)) {
      return mostrarErro(errEl, 'Senha incorreta.');
    }

    currentUser = { key, ...userData };
    salvarSessao();
    entrarNoApp();
  } catch (e) {
    mostrarErro(errEl, 'Erro ao entrar. Tente novamente.');
    console.error(e);
  }
}

function logout() {
  currentUser = null;
  userLibrary = [];
  localStorage.removeItem('nonestore_session');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('auth-overlay').style.display = 'flex';
  mostrarLogin();
  mostrarToast('Sessão encerrada.');
}

/* ─── Sessão local (para manter login ao recarregar) ─── */
function salvarSessao() {
  localStorage.setItem('nonestore_session', JSON.stringify({ key: currentUser.key }));
}

async function restaurarSessao() {
  const raw = localStorage.getItem('nonestore_session');
  if (!raw) return false;
  try {
    const { key } = JSON.parse(raw);
    const userData = await fbGet(`usuarios/${key}`);
    if (userData) {
      currentUser = { key, ...userData };
      return true;
    }
  } catch (_) {}
  return false;
}

/* ═══════════════════════════════════════════
   APP INIT
═══════════════════════════════════════════ */

async function init() {
  const logado = await restaurarSessao();
  if (logado) {
    entrarNoApp();
  }
  // Auth overlay já visível por padrão
}

function entrarNoApp() {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');

  atualizarUI();
  carregarJogos();
  carregarBiblioteca();
  navegarPara('store');
}

function atualizarUI() {
  const u = currentUser;
  if (!u) return;
  const inicial = u.usuario.charAt(0).toUpperCase();

  document.getElementById('sidebar-username').textContent = u.usuario;
  document.getElementById('sidebar-avatar').textContent   = inicial;
  document.getElementById('account-avatar').textContent   = inicial;
  document.getElementById('account-username').textContent = u.usuario;
  document.getElementById('account-email').textContent    = u.email;
  document.getElementById('account-since').textContent    = formatarData(u.criadoEm);
}

/* ═══════════════════════════════════════════
   JOGOS
═══════════════════════════════════════════ */

async function carregarJogos() {
  try {
    const res = await fetch(GAMES_JSON);
    allGames = await res.json();
    renderizarLoja();
  } catch (e) {
    document.getElementById('games-grid').innerHTML =
      `<div class="empty-state"><p>Erro ao carregar jogos.</p></div>`;
    console.error(e);
  }
}

function renderizarLoja() {
  const grid = document.getElementById('games-grid');
  grid.innerHTML = '';

  if (!allGames.length) {
    grid.innerHTML = `<div class="empty-state"><p>Nenhum jogo disponível.</p></div>`;
    return;
  }

  allGames.forEach(jogo => {
    const naLib = userLibrary.includes(jogo.id);
    const card  = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <img class="game-card-img" src="${jogo.imagem}" alt="${jogo.nome}" loading="lazy" />
      <div class="game-card-body">
        <div class="game-card-title">${jogo.nome}</div>
        <div class="game-card-meta">
          <span class="game-card-dev">${jogo.desenvolvedora}</span>
          <span class="rating-badge">${jogo.classificacao}+</span>
        </div>
        ${naLib ? '<span class="in-library-badge">✓ BIBLIOTECA</span>' : ''}
      </div>
    `;
    card.addEventListener('click', () => abrirJogo(jogo));
    grid.appendChild(card);
  });
}

function abrirJogo(jogo) {
  const naLib  = userLibrary.includes(jogo.id);
  const detail = document.getElementById('game-detail');

  detail.innerHTML = `
    <img class="game-hero" src="${jogo.imagem}" alt="${jogo.nome}" />
    <div class="game-detail-layout">
      <div class="game-detail-main">
        <h1 class="game-detail-title">${jogo.nome}</h1>
        <p class="game-detail-desc">${jogo.descricao}</p>
        <div class="game-detail-actions">
          <button class="btn-primary desktop-only" id="btn-baixar" onclick="baixarJogo('${jogo.pixeldrain}', '${jogo.nome.replace(/'/g, "\\'")}')">
            BAIXAR JOGO
          </button>
          <button class="btn-primary outline" id="btn-biblioteca" onclick="adicionarBiblioteca('${jogo.id}')">
            ${naLib ? '✓ NA BIBLIOTECA' : '+ BIBLIOTECA'}
          </button>
        </div>
        <p class="mobile-block-msg">⚠ Downloads não disponíveis no mobile</p>
      </div>
      <div class="game-sidebar-panel">
        <div class="game-meta-row">
          <div class="game-meta-item">
            <label>DESENVOLVEDORA</label>
            <span>${jogo.desenvolvedora}</span>
          </div>
          <div class="game-meta-item">
            <label>GÊNERO</label>
            <span>${jogo.genero || '—'}</span>
          </div>
          <div class="game-meta-item">
            <label>TAMANHO</label>
            <span>${jogo.tamanho || '—'}</span>
          </div>
          <div class="game-meta-item">
            <label>VERSÃO</label>
            <span>${jogo.versao || '—'}</span>
          </div>
          <div class="game-meta-item">
            <label>CLASSIFICAÇÃO</label>
            <span class="rating-large">${jogo.classificacao}+</span>
          </div>
        </div>
      </div>
    </div>
  `;

  /* Esconde botão de download no mobile */
  const btnBaixar = document.getElementById('btn-baixar');
  if (btnBaixar && isMobile) {
    btnBaixar.style.display = 'none';
  }

  navegarParaPagina('game');
}

function voltarLoja() {
  navegarParaPagina('store');
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === 'store');
  });
}

/* ═══════════════════════════════════════════
   BIBLIOTECA
═══════════════════════════════════════════ */

async function carregarBiblioteca() {
  if (!currentUser) return;
  try {
    const data = await fbGet(`usuarios/${currentUser.key}/biblioteca`);
    userLibrary = Array.isArray(data) ? data : (data ? Object.values(data) : []);
    atualizarContadorBiblioteca();
    renderizarBiblioteca();
  } catch (e) {
    console.error('Erro ao carregar biblioteca:', e);
  }
}

async function adicionarBiblioteca(jogoId) {
  if (!currentUser) return;

  if (userLibrary.includes(jogoId)) {
    mostrarToast('Jogo já está na biblioteca!');
    return;
  }

  userLibrary.push(jogoId);

  try {
    await fbSet(`usuarios/${currentUser.key}/biblioteca`, userLibrary);
    mostrarToast('Adicionado à biblioteca!');
    atualizarContadorBiblioteca();
    renderizarBiblioteca();

    /* Atualiza botão na página do jogo */
    const btnLib = document.getElementById('btn-biblioteca');
    if (btnLib) btnLib.textContent = '✓ NA BIBLIOTECA';
  } catch (e) {
    userLibrary.pop();
    mostrarToast('Erro ao salvar na biblioteca.', true);
    console.error(e);
  }
}

function renderizarBiblioteca() {
  const grid = document.getElementById('library-grid');
  grid.innerHTML = '';

  const jogosNaLib = allGames.filter(j => userLibrary.includes(j.id));

  if (!jogosNaLib.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
        <p>Nenhum jogo na biblioteca ainda.</p>
        <button class="btn-secondary" onclick="navegarPara('store')">IR À LOJA</button>
      </div>`;
    return;
  }

  jogosNaLib.forEach(jogo => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.innerHTML = `
      <img class="game-card-img" src="${jogo.imagem}" alt="${jogo.nome}" loading="lazy" />
      <div class="game-card-body">
        <div class="game-card-title">${jogo.nome}</div>
        <div class="game-card-meta">
          <span class="game-card-dev">${jogo.desenvolvedora}</span>
          <span class="rating-badge">${jogo.classificacao}+</span>
        </div>
        <span class="in-library-badge">✓ BIBLIOTECA</span>
      </div>
    `;
    card.addEventListener('click', () => abrirJogo(jogo));
    grid.appendChild(card);
  });
}

function atualizarContadorBiblioteca() {
  document.getElementById('account-games').textContent = userLibrary.length;
}

/* ═══════════════════════════════════════════
   DOWNLOAD — link direto via <a> nativo
   O Pixeldrain bloqueia fetch() com 403 (CORS).
   A solução é criar um <a href="...?download">
   invisível — o navegador baixa nativamente,
   igual a clicar num link, sem restrições CORS.
═══════════════════════════════════════════ */

function extrairIdPixeldrain(link) {
  const match = link.match(/pixeldrain\.com\/[ul]\/([A-Za-z0-9]+)/);
  return match ? match[1] : null;
}

function baixarJogo(link, nomeJogo) {
  if (isMobile) {
    mostrarToast('Downloads não disponíveis no mobile.', true);
    return;
  }
  if (!link || link.includes('exemplo')) {
    mostrarToast('Link de download não disponível para este jogo.', true);
    return;
  }

  const fileId = extrairIdPixeldrain(link);

  /* Monta a URL de download direto da API do Pixeldrain */
  const downloadUrl = fileId
    ? `https://pixeldrain.com/api/file/${fileId}?download`
    : link;

  /* Pixeldrain envia Content-Disposition: attachment no link ?download
     window.open faz o navegador baixar direto sem abrir página nenhuma */
  window.open(downloadUrl, '_blank', 'noopener,noreferrer');

  mostrarModalDownload(nomeJogo || 'Jogo');
}

/* Modal informativo (sem barra de progresso real,
   pois o download é gerenciado pelo navegador) */
function mostrarModalDownload(nome) {
  const antigo = document.getElementById('download-modal');
  if (antigo) antigo.remove();

  if (!document.getElementById('dl-styles')) {
    const s = document.createElement('style');
    s.id = 'dl-styles';
    s.textContent = `
      #download-modal{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center}
      .dl-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(6px)}
      .dl-panel{position:relative;background:#0d0d0d;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:36px 40px;width:420px;max-width:92vw;animation:fadeInUp .25s ease;text-align:center}
      .dl-icon{font-size:40px;margin-bottom:16px}
      .dl-game-name{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:2px;color:#fff;margin-bottom:8px}
      .dl-sub{font-family:'Space Mono',monospace;font-size:11px;color:#757575;letter-spacing:1px;margin-bottom:24px;line-height:1.7}
      .dl-bar-wrap{background:rgba(255,255,255,.07);border-radius:3px;height:3px;margin-bottom:24px;overflow:hidden}
      .dl-bar-anim{height:100%;background:#fff;border-radius:3px;animation:dlSlide 1.6s ease-in-out infinite}
      @keyframes dlSlide{0%{width:0%;margin-left:0}50%{width:60%;margin-left:20%}100%{width:0%;margin-left:100%}}
      .dl-close-btn{background:transparent;border:1px solid rgba(255,255,255,.15);color:#fff;font-family:'Bebas Neue',sans-serif;font-size:15px;letter-spacing:2px;padding:10px 28px;border-radius:5px;cursor:pointer;transition:all .2s}
      .dl-close-btn:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.4)}
    `;
    document.head.appendChild(s);
  }

  const modal = document.createElement('div');
  modal.id = 'download-modal';
  modal.innerHTML = `
    <div class="dl-backdrop" onclick="fecharDownload()"></div>
    <div class="dl-panel">
      <div class="dl-icon">⬇</div>
      <div class="dl-game-name">${nome.toUpperCase()}</div>
      <div class="dl-sub">
        O download foi iniciado pelo seu navegador.<br>
        Verifique a barra de downloads ou a pasta Downloads.
      </div>
      <div class="dl-bar-wrap"><div class="dl-bar-anim"></div></div>
      <button class="dl-close-btn" onclick="fecharDownload()">FECHAR</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function fecharDownload() {
  const modal = document.getElementById('download-modal');
  if (modal) modal.remove();
}

/* ═══════════════════════════════════════════
   NAVEGAÇÃO
═══════════════════════════════════════════ */

function navegarPara(pagina) {
  /* Atualiza todos os botões de nav */
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === pagina);
  });
  navegarParaPagina(pagina);
}

function navegarParaPagina(pagina) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const alvo = document.getElementById(`page-${pagina}`);
  if (alvo) alvo.classList.add('active');

  /* Recarrega biblioteca ao entrar */
  if (pagina === 'library') {
    renderizarBiblioteca();
  }
}

/* ═══════════════════════════════════════════
   AUTH UI HELPERS
═══════════════════════════════════════════ */

function mostrarCadastro() {
  document.getElementById('login-form').classList.remove('active');
  document.getElementById('register-form').classList.add('active');
  limparErros();
}

function mostrarLogin() {
  document.getElementById('register-form').classList.remove('active');
  document.getElementById('login-form').classList.add('active');
  limparErros();
}

function limparErros() {
  document.querySelectorAll('.form-error').forEach(el => el.classList.add('hidden'));
}

function mostrarErro(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */

let toastTimer = null;

function mostrarToast(msg, erro = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden', 'error');
  if (erro) toast.classList.add('error');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

/* ═══════════════════════════════════════════
   UTIL
═══════════════════════════════════════════ */

function formatarData(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return '—'; }
}

/* ─── Enter para submeter formulários ─── */
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('login-form').classList.contains('active')) logar();
  else if (document.getElementById('register-form').classList.contains('active')) cadastrar();
});

/* ─── Detectar resize mobile/desktop ─── */
window.addEventListener('resize', () => {
  isMobile = window.innerWidth <= 768;
});

/* ─── Start ─── */
init();