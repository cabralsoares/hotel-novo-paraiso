/* Casca do sistema: menu lateral, rotas, sessão e atualização automática dos dados. */
(async function () {
  const NP = window.NP;
  const { html, mount, icon, $, $$ } = NP.U;
  const Store = NP.Store, Auth = NP.Auth, UI = NP.UI;

  const user = await Auth.requireSession();
  if (!user) return; // redirecionado para /login
  try { await Store.load(); } catch (e) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Não foi possível carregar os dados do hotel: ' + NP.U.esc(e.message) + ' <a href="">Tentar de novo</a></p>';
    return;
  }
  Store.startPolling();

  const NAV = [
    { id: 'painel', label: 'Painel', icon: 'painel' },
    { id: 'checkin', label: 'Check-in', icon: 'login', primary: true },
    { id: 'hospedagem', label: 'Hospedagem', icon: 'home' },
    { id: 'reservas', label: 'Reservas', icon: 'calendar' },
    { id: 'quartos', label: 'Quartos', icon: 'bed' },
    { id: 'hospedes', label: 'Hóspedes', icon: 'users' },
    { id: 'financeiro', label: 'Financeiro', icon: 'wallet' },
    { id: 'config', label: 'Configurações', icon: 'settings', perfil: 'gerente' },
  ].filter((n) => !n.perfil || n.perfil === user.perfil);

  const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

  /* ---------- Casca ---------- */
  function shell() {
    const h = Store.state.config.hotel;
    mount($('#app'), html`
      <aside class="sidebar" aria-label="Menu principal">
        <div class="brand"><div class="brand-logo"><img src="/assets/logo.png" alt="Logo ${h.nome}" width="94" height="97"></div>
          <div class="brand-name" data-hotel-name>${h.nome}</div><div class="brand-city" data-hotel-city>${h.cidade}-${h.uf}</div></div>
        <nav class="nav">${NAV.map((n) => html`<a href="#/${n.id}" data-nav="${n.id}" class="${n.primary ? 'nav-primary' : ''}">${icon(n.icon, 19)}<span>${n.label}</span></a>`)}</nav>
        <div class="side-foot">
          <div class="who"><div class="avatar" aria-hidden="true">${initials(user.nome)}</div><div><strong>${user.nome}</strong><small>${user.perfil === 'gerente' ? 'Gerente' : 'Recepção'}</small></div></div>
          <button type="button" data-logout>${icon('logout', 17)} Sair</button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar"><button type="button" data-menu aria-label="Abrir menu">${icon('menu', 24)}</button><strong>${h.nome}</strong></header>
        <div id="banner" role="status"></div>
        <main id="view" tabindex="-1"></main>
      </div>`);
  }
  shell();

  function refreshChrome() {
    const h = Store.state.config.hotel;
    const n = $('[data-hotel-name]'), c = $('[data-hotel-city]');
    if (n) n.textContent = h.nome;
    if (c) c.textContent = `${h.cidade}-${h.uf}`;
    mount($('#banner'), Store.online ? '' : html`<div class="banner">${icon('alert', 18)} Sem conexão com o servidor do hotel. O que você vê pode estar desatualizado; novos lançamentos não serão salvos até a conexão voltar.</div>`);
  }
  Store.on(refreshChrome);
  Store.onStatus(refreshChrome);

  /* ---------- Rotas ---------- */
  let current = null, lastHash = '#/painel', ignoreNext = false;

  function show(hash) {
    const [name, ...params] = hash.replace(/^#\//, '').split('/');
    const nav = NAV.find((n) => n.id === name);
    if (!nav || !NP.Views[name]) { history.replaceState(null, '', '#/painel'); return show('#/painel'); }
    if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
    const view = document.createElement('div');
    view.className = 'view';
    $('#view').replaceChildren(view);
    current = NP.Views[name](view, params) || {};
    lastHash = hash;
    $$('[data-nav]').forEach((a) => { if (a.dataset.nav === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = `${nav.label} · ${Store.state.config.hotel.nome}`;
    document.body.classList.remove('nav-open');
    window.scrollTo(0, 0);
  }

  async function navigate() {
    if (ignoreNext) { ignoreNext = false; return; }
    if (current && current.leave && !(await current.leave())) { ignoreNext = true; location.hash = lastHash; return; }
    show(location.hash || '#/painel');
  }
  window.addEventListener('hashchange', navigate);

  /* ---------- Menu, saída e inatividade ---------- */
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-menu]')) document.body.classList.toggle('nav-open');
    else if (document.body.classList.contains('nav-open') && !e.target.closest('.sidebar')) document.body.classList.remove('nav-open');
    if (e.target.closest('[data-logout]')) {
      if (current && current.leave && !(await current.leave())) return;
      await Auth.logout();
      Auth.go('login');
    }
  });

  Auth.watchIdle(() => { UI.toast('Sessão encerrada por inatividade.', 'info', 2500); setTimeout(() => Auth.go('login'), 800); });

  refreshChrome();
  show(location.hash || '#/painel');
})();
