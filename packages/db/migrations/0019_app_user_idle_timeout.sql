-- Uma transação abandonada (ex.: o Cloudflare cancela o trabalho em background no meio dela)
-- deixa a conexão "idle in transaction" para sempre, ocupando uma das poucas vagas do pool do
-- Hyperdrive. Com o limite, o Postgres derruba a sessão e a vaga volta. 20 s cobre com folga
-- uma transação legítima esperando um handler do outbox (e-mail, WhatsApp).
-- O papel app_user é criado fora das migrations (ver 0000); onde ele não existe, nada muda.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    ALTER ROLE app_user SET idle_in_transaction_session_timeout = '20s';
  END IF;
END $$;
