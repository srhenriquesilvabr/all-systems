/** 12345678909 → 123.456.789-09 · 11222333000181 → 11.222.333/0001-81 */
export function formatDocument(doc: string | null): string {
  if (!doc) return '';
  if (doc.length === 11) return doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (doc.length === 14) return doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc;
}

/** +5511987654321 → (11) 98765-4321. Números de outros países ficam como estão. */
export function formatPhone(phone: string | null): string {
  if (!phone) return '';
  const m = phone.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}
