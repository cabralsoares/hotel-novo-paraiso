/* Página /login: primeiro acesso (cria o gerente, com o código do servidor) ou entrada com usuário e senha. */
(async function () {
  const NP = window.NP;
  const { html, mount, field, showErrors, formData, $ } = NP.U;
  const Auth = NP.Auth;
  const card = $('#card');

  if (await Auth.init()) { Auth.go('app'); return; }

  const header = () => html`<div class="brand-logo"><img src="/assets/logo.png" alt="Logo Hotel e Pousada Novo Paraíso" width="113" height="117"></div>
      <h1>Hotel e Pousada Novo Paraíso</h1>`;

  function loginScreen() {
    mount(card, html`${header()}<p class="sub">Entre para acessar o check-in e a hospedagem</p>
      <form class="stack" novalidate data-login>
        <div class="login-error hidden" role="alert" data-error></div>
        ${field('Usuário', 'usuario', { autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' })}
        <label class="field" for="f-senha"><span class="lbl">Senha</span>
          <span class="pw-wrap"><input type="password" name="senha" id="f-senha" autocomplete="current-password"><button type="button" class="pw-toggle" data-toggle aria-label="Mostrar senha">Mostrar</button></span>
          <small class="err" data-err="senha" role="alert"></small></label>
        <button class="btn btn-primary" type="submit">Entrar</button>
      </form>
      <p class="login-foot">Esqueceu a senha? Peça ao gerente para redefinir em Configurações.</p>`);
    const form = $('[data-login]', card), box = $('[data-error]', card);
    $('[name=usuario]', form).focus();
    $('[data-toggle]', form).addEventListener('click', (e) => {
      const i = $('[name=senha]', form), show = i.type === 'password';
      i.type = show ? 'text' : 'password'; e.target.textContent = show ? 'Ocultar' : 'Mostrar';
    });
    let timer = null;
    const showError = (msg) => { box.textContent = msg; box.classList.toggle('hidden', !msg); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form), errors = {};
      if (!d.usuario) errors.usuario = 'Informe o usuário.';
      if (!d.senha) errors.senha = 'Informe a senha.';
      if (!showErrors(form, errors)) return;
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      const r = await Auth.login(d.usuario, d.senha);
      if (r.ok) return Auth.go('app');
      btn.disabled = false;
      showError(r.erro);
      $('[name=senha]', form).value = ''; $('[name=senha]', form).focus();
      if (r.espera) {
        clearInterval(timer); btn.disabled = true; let s = r.espera;
        timer = setInterval(() => { s -= 1; if (s <= 0) { clearInterval(timer); btn.disabled = false; showError(''); } else showError(`Muitas tentativas. Aguarde ${s}s para tentar de novo.`); }, 1000);
      }
    });
  }

  function setupScreen() {
    mount(card, html`${header()}<p class="sub"><strong>Primeiro acesso</strong> — crie o usuário gerente do sistema</p>
      <form class="stack" novalidate data-setup autocomplete="off">
        ${field('Código de primeiro acesso', 'codigo', { autocomplete: 'off', autocapitalize: 'characters', placeholder: 'XXXX-XXXX', hint: 'Está no registro do servidor (veja o LEIA-ME). Garante que só você consiga criar o gerente.' })}
        ${field('Seu nome', 'nome', { mask: 'name', autocomplete: 'name' })}
        ${field('Usuário (login)', 'usuario', { autocomplete: 'username', autocapitalize: 'none', hint: 'Ex.: gerente, jadson' })}
        ${field('Senha', 'senha', { type: 'password', autocomplete: 'new-password', hint: 'Mínimo 8 caracteres, com letras e números.' })}
        ${field('Repita a senha', 'senha2', { type: 'password', autocomplete: 'new-password' })}
        ${field('PIN de autorização (4 a 6 números)', 'pin', { type: 'password', mask: 'pin', inputmode: 'numeric', autocomplete: 'new-password', hint: 'Usado para autorizar descontos, estornos e valores altos.' })}
        ${field('Repita o PIN', 'pin2', { type: 'password', mask: 'pin', inputmode: 'numeric', autocomplete: 'new-password' })}
        <button class="btn btn-primary" type="submit">Criar acesso e entrar</button>
      </form>
      <p class="login-foot">Os dados ficam no banco de dados próprio do hotel, no servidor.</p>`);
    const form = $('[data-setup]', card);
    $('[name=codigo]', form).focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form), errors = {};
      if (d.codigo.replace(/[^A-Za-z0-9]/g, '').length < 8) errors.codigo = 'Digite o código de primeiro acesso (8 caracteres).';
      if (d.nome.length < 3) errors.nome = 'Informe seu nome.';
      if (!/^[a-z0-9._-]{3,20}$/i.test(d.usuario)) errors.usuario = 'Use 3 a 20 letras, números, ponto, hífen ou _.';
      const pw = Auth.validatePassword(d.senha, d.usuario); if (pw) errors.senha = pw;
      else if (d.senha !== d.senha2) errors.senha2 = 'As senhas não conferem.';
      const pn = Auth.validatePin(d.pin); if (pn) errors.pin = pn;
      else if (d.pin !== d.pin2) errors.pin2 = 'Os PINs não conferem.';
      if (!showErrors(form, errors)) return;
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try { await Auth.setup({ codigo: d.codigo, nome: d.nome, usuario: d.usuario, senha: d.senha, pin: d.pin }); Auth.go('app'); }
      catch (err) { btn.disabled = false; NP.Api.showError(err, form); }
    });
  }

  try {
    if (await Auth.configured()) loginScreen(); else setupScreen();
  } catch (err) {
    mount(card, html`${header()}<div class="login-error">Não foi possível falar com o servidor: ${err.message}</div>`);
  }
})();
