/* Formulário de hóspede (cadastro e check-in) com validação. NP.GuestForm */
(function () {
  const NP = (window.NP = window.NP || {});
  const { html, field, $, formData, UFS } = NP.U;
  const V = NP.Validators, Core = NP.Core;

  const DOC_TYPES = [['cpf', 'CPF'], ['rg', 'RG'], ['passaporte', 'Passaporte']];
  const MOTIVOS = ['Lazer', 'Negócios', 'Trabalho', 'Congresso/Feira', 'Parentes/Amigos', 'Saúde', 'Outro'];
  const TRANSPORTES = ['Carro', 'Ônibus', 'Avião', 'Moto', 'Navio', 'Outro'];

  function render(g = {}) {
    const cpf = (g.docTipo || 'cpf') === 'cpf';
    return html`<div class="grid-2 guest-form" data-guestform>
      ${field('Nome completo', 'nome', { value: g.nome || '', cls: 'span-2', mask: 'name', maxlength: 80 })}
      ${field('Tipo de documento', 'docTipo', { options: DOC_TYPES, value: g.docTipo || 'cpf' })}
      ${field(cpf ? 'CPF' : 'Número do documento', 'doc', { value: cpf && g.doc ? NP.U.maskCPF(g.doc) : g.doc || '', mask: cpf ? 'cpf' : null, inputmode: cpf ? 'numeric' : null, maxlength: 20 })}
      ${field('Data de nascimento', 'nascimento', { type: 'date', value: g.nascimento || '', max: Core.today() })}
      ${field('Nacionalidade', 'nacionalidade', { value: g.nacionalidade || 'Brasileira' })}
      ${field('Telefone / WhatsApp', 'telefone', { value: g.telefone ? NP.U.maskPhone(g.telefone) : '', mask: 'phone', inputmode: 'tel', placeholder: '(00) 00000-0000' })}
      ${field('E-mail (opcional)', 'email', { type: 'email', value: g.email || '' })}
      ${field('Cidade de residência', 'cidade', { value: g.cidade || '' })}
      ${field('UF', 'uf', { options: [['', 'Selecione'], ...UFS, ['EX', 'Exterior']], value: g.uf || '' })}
      ${field('Motivo da viagem', 'motivo', { options: MOTIVOS, value: g.motivo || 'Lazer' })}
      ${field('Meio de transporte', 'transporte', { options: TRANSPORTES, value: g.transporte || 'Carro' })}
    </div>`;
  }

  /** Liga o comportamento do campo de documento (máscara muda com o tipo). */
  function bind(root) {
    const sel = $('[name=docTipo]', root), doc = $('[name=doc]', root);
    if (!sel || !doc) return;
    sel.addEventListener('change', () => {
      const cpf = sel.value === 'cpf';
      doc.value = '';
      if (cpf) { doc.dataset.mask = 'cpf'; doc.inputMode = 'numeric'; } else { delete doc.dataset.mask; doc.inputMode = 'text'; }
      const lbl = doc.closest('.field').querySelector('.lbl');
      if (lbl) lbl.textContent = cpf ? 'CPF' : 'Número do documento';
    });
  }

  function read(root) {
    const d = formData(root);
    const cpf = d.docTipo === 'cpf';
    return {
      nome: d.nome.replace(/\s+/g, ' '), docTipo: d.docTipo, doc: cpf ? V.digits(d.doc) : d.doc.toUpperCase().replace(/\s+/g, ''),
      nascimento: d.nascimento, nacionalidade: d.nacionalidade, telefone: V.digits(d.telefone), email: d.email.toLowerCase(),
      cidade: d.cidade, uf: d.uf, motivo: d.motivo, transporte: d.transporte,
    };
  }

  function validate(g, { ignoreId = null } = {}) {
    const e = {};
    const T = Core.today();
    if (!g.nome || g.nome.split(' ').filter(Boolean).length < 2 || !/^[A-Za-zÀ-ÿ'.\- ]+$/.test(g.nome)) e.nome = 'Informe o nome completo (nome e sobrenome, só letras).';
    if (g.docTipo === 'cpf') {
      if (!V.isCPF(g.doc)) e.doc = 'CPF inválido.';
    } else if (!/^[A-Z0-9.\-/]{5,20}$/.test(g.doc)) e.doc = 'Documento inválido (mínimo 5 caracteres).';
    if (!e.doc) {
      const dup = NP.Store.state.guests.find((x) => x.id !== ignoreId && x.docTipo === g.docTipo && x.doc === g.doc);
      if (dup) e.doc = `Documento já cadastrado para ${dup.nome}. Selecione o hóspede existente.`;
    }
    if (!V.isDateISO(g.nascimento)) e.nascimento = 'Informe a data de nascimento.';
    else if (g.nascimento > T) e.nascimento = 'A data de nascimento não pode ser no futuro.';
    else if (V.ageOn(g.nascimento, T) < 18) e.nascimento = 'O hóspede responsável precisa ter 18 anos ou mais.';
    else if (V.ageOn(g.nascimento, T) > 120) e.nascimento = 'Data de nascimento inválida.';
    if (!g.nacionalidade || g.nacionalidade.length < 3) e.nacionalidade = 'Informe a nacionalidade.';
    const brasil = /^brasil/i.test(g.nacionalidade || '');
    if (brasil ? !V.isPhone(g.telefone) : (g.telefone || '').length < 8) e.telefone = brasil ? 'Telefone inválido. Use DDD + número.' : 'Informe um telefone para contato.';
    if (g.email && !V.isEmail(g.email)) e.email = 'E-mail inválido.';
    if (!g.cidade || g.cidade.length < 2) e.cidade = 'Informe a cidade.';
    if (!g.uf) e.uf = 'Selecione o estado.';
    return e;
  }

  NP.GuestForm = { render, bind, read, validate };
})();
