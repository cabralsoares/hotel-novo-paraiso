/* Sessão e usuários. O login é verificado pelo SERVIDOR; a sessão fica em um cookie protegido (HttpOnly). NP.Auth */
(function () {
  const NP = (window.NP = window.NP || {});
  const Api = NP.Api, V = NP.Validators;
  const IDLE_MS = 30 * 60 * 1000;
  let user = null, lastActivity = Date.now();

  const isHttp = location.protocol.startsWith('http');
  const go = (kind) => location.replace(kind === 'login' ? (isHttp ? '/login' : 'login/index.html') : '/');

  /** Descobre quem está logado (ou null). */
  async function init() {
    try { user = (await Api.get('/api/auth/me')).usuario; } catch { user = null; }
    return user;
  }

  async function login(usuario, senha) {
    try { user = (await Api.post('/api/auth/login', { usuario, senha })).usuario; return { ok: true }; }
    catch (e) { return { ok: false, erro: e.message, espera: e.extra && e.extra.espera }; }
  }
  async function setup(data) { user = (await Api.post('/api/auth/setup', data)).usuario; return user; }
  const configured = async () => (await Api.get('/api/auth/status')).configurado;

  async function logout() { try { await Api.post('/api/auth/logout'); } catch { /* já saiu */ } user = null; }
  function sessionLost() { user = null; if (!/\/login\/?$/.test(location.pathname)) go('login'); }

  /** Para a tela principal: sem sessão válida, volta ao login. */
  async function requireSession() { if (!(await init())) { go('login'); return null; } return user; }

  function watchIdle(onTimeout) {
    ['click', 'keydown', 'pointerdown'].forEach((ev) => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
    setInterval(async () => { if (user && Date.now() - lastActivity > IDLE_MS) { await logout(); onTimeout(); } }, 30000);
  }

  const listUsers = async () => (await Api.get('/api/usuarios')).usuarios;
  const createUser = (d) => Api.post('/api/usuarios', d);
  const resetPassword = (id, senha) => Api.post(`/api/usuarios/${id}/senha`, { senha });
  const setActive = (id, ativo) => Api.post(`/api/usuarios/${id}/ativo`, { ativo });
  const changePassword = (atual, nova) => Api.post('/api/eu/senha', { atual, nova });
  const changePin = (senha, pin) => Api.post('/api/eu/pin', { senha, pin });

  NP.Auth = {
    init, login, setup, configured, logout, sessionLost, requireSession, watchIdle, go,
    current: () => user, isManager: () => !!user && user.perfil === 'gerente',
    listUsers, createUser, resetPassword, setActive, changePassword, changePin,
    validatePassword: V.passwordError, validatePin: V.pinError,
  };
})();
