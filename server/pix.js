/* PIX "copia e cola" (BR Code estático, padrão EMV do Banco Central). NP.Pix / Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.NP = root.NP || {}; root.NP.Pix = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  /** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) em hexadecimal maiúsculo. */
  function crc16(str) {
    let crc = 0xffff;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

  const ascii = (s, max) =>
    String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max);

  /** Identificador da cobrança: 1–25 caracteres alfanuméricos. */
  function newTxid() {
    const rnd = Math.random().toString(36).slice(2, 10);
    return ('NP' + Date.now().toString(36) + rnd).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25);
  }

  function buildPayload({ chave, recebedor, cidade, valor, txid }) {
    if (!chave) throw new Error('Chave PIX não informada.');
    const conta = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave);
    let p = tlv('00', '01') + tlv('01', '11') + tlv('26', conta) + tlv('52', '0000') + tlv('53', '986');
    if (valor > 0) p += tlv('54', Number(valor).toFixed(2));
    p += tlv('58', 'BR') + tlv('59', ascii(recebedor, 25) || 'NAO INFORMADO') + tlv('60', ascii(cidade, 15) || 'BRASIL');
    p += tlv('62', tlv('05', /^[A-Za-z0-9]{1,25}$/.test(txid || '') ? txid : '***'));
    p += '6304';
    return p + crc16(p);
  }

  /** Confere o CRC de um payload já pronto. */
  function verifyPayload(payload) {
    return payload.length > 8 && crc16(payload.slice(0, -4)) === payload.slice(-4);
  }

  return { crc16, newTxid, buildPayload, verifyPayload };
});
