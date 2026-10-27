/** Planilhas da agenda: troca nomes ("Corte; Escova") pelos ids, sem diferenciar maiúsculas e acentos. */

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * Busca a lista uma vez por importação (a promessa fica guardada) e resolve a célula.
 * `what` é o nome no singular para as mensagens: "serviço", "profissional".
 */
export function nameResolver(what: string, load: () => Promise<{ id: string; name: string }[]>) {
  let list: Promise<{ id: string; name: string }[]> | null = null;
  return async (cell: unknown): Promise<string[]> => {
    const names = String(cell ?? '')
      .split(';')
      .map((n) => n.trim())
      .filter(Boolean);
    if (!names.length) return [];
    list ??= load().catch((err) => {
      list = null; // tenta de novo na próxima linha
      throw err;
    });
    const items = await list;
    return [
      ...new Set(
        names.map((name) => {
          const found = items.filter((i) => normalize(i.name) === normalize(name));
          if (!found.length) throw new Error(`${what[0]!.toUpperCase()}${what.slice(1)} "${name}" não encontrado. Confira o nome como está cadastrado.`);
          if (found.length > 1) throw new Error(`Há mais de um ${what} com o nome "${name}". Renomeie um deles antes de importar.`);
          return found[0]!.id;
        }),
      ),
    ];
  };
}
