import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';

// Leitura do certificado A1 (.pfx/.p12) com node-forge, que é JavaScript puro e roda no Workers
// (o node:crypto não lê PKCS#12). Aceita os algoritmos dos certificados ICP-Brasil (3DES/RC2 + SHA-1)
// e os do OpenSSL 3 (PBES2 com AES-256 + MAC SHA-256).

export interface ParsedCertificate {
  subjectName: string;
  /** CNPJ (14) ou CPF (11) do titular, quando o nome do certificado traz (padrão ICP-Brasil "NOME:CNPJ"). */
  document: string | null;
  issuerName: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
}

export class CertificateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_PFX_BYTES = 64 * 1024;

export function parsePfx(pfx: Buffer, password: string): ParsedCertificate {
  if (!pfx.length || pfx.length > MAX_PFX_BYTES) throw new CertificateError('INVALID_CERTIFICATE', 'Arquivo de certificado vazio ou grande demais (máximo 64 KB)');
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/MAC could not be verified|Invalid password|password/i.test(message)) throw new CertificateError('WRONG_PASSWORD', 'Senha do certificado incorreta');
    throw new CertificateError('INVALID_CERTIFICATE', 'Não foi possível ler o arquivo: envie o certificado A1 em .pfx ou .p12');
  }

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag!] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag!] ?? []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag!] ?? [];
  const keyBag = keyBags.find((b) => b.key);
  if (!keyBag?.key) throw new CertificateError('NO_PRIVATE_KEY', 'O arquivo não tem a chave privada. Exporte o certificado A1 com a chave (.pfx)');
  const certs = certBags.map((b) => ({ bag: b, cert: b.cert })).filter((c): c is { bag: forge.pkcs12.Bag; cert: forge.pki.Certificate } => !!c.cert);
  if (!certs.length) throw new CertificateError('INVALID_CERTIFICATE', 'O arquivo não tem certificado');

  // O certificado do titular é o da mesma chave (mesmo módulo RSA); os outros são da cadeia (ACs).
  const key = keyBag.key as forge.pki.rsa.PrivateKey;
  const own = certs.find((c) => (c.cert.publicKey as forge.pki.rsa.PublicKey).n?.equals?.(key.n));
  if (!own) throw new CertificateError('KEY_MISMATCH', 'A chave privada não corresponde a nenhum certificado do arquivo');

  const cert = own.cert;
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const docMatch = /:(\d{14}|\d{11})\s*$/.exec(cn);
  return {
    subjectName: cn || cert.subject.attributes.map((a) => a.value).join(', '),
    document: docMatch ? docMatch[1]! : null,
    issuerName: String(cert.issuer.getField('CN')?.value ?? cert.issuer.attributes.map((a) => a.value).join(', ')),
    serialNumber: cert.serialNumber,
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  };
}

/** Dias inteiros até o vencimento (negativo = vencido). */
export const daysUntil = (date: Date, now = new Date()) => Math.floor((date.getTime() - now.getTime()) / 86_400_000);

/**
 * Certificado autoassinado no formato ICP-Brasil ("NOME:CNPJ"), para testes e demonstração.
 * Não serve para emitir em homologação nem produção (não é de uma AC credenciada).
 */
export function createSelfSignedPfx(opts: { name: string; cnpj: string; password: string; validFrom?: Date; validTo?: Date }): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  cert.serialNumber = `01${randomBytes(8).toString('hex')}`;
  cert.validity.notBefore = opts.validFrom ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = opts.validTo ?? new Date(Date.now() + 365 * 86_400_000);
  const subject = [
    { name: 'commonName', value: `${opts.name}:${opts.cnpj}` },
    { name: 'organizationName', value: 'ICP-Brasil (simulado)' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(subject);
  cert.setIssuer([{ name: 'commonName', value: 'AC de Testes (sem validade)' }, { name: 'countryName', value: 'BR' }]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], opts.password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}
