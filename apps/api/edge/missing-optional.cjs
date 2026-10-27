// Dependências opcionais do Nest que não usamos (validação por class-validator, websockets,
// microservices). O bundle do Worker precisa resolvê-las: este módulo falha ao ser carregado,
// exatamente como um pacote ausente no Node, e o Nest segue sem elas.
throw new Error('Dependência opcional do Nest indisponível no Cloudflare Workers');
