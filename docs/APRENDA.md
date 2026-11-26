# Aprenda com o SalusEtQualitas

Este guia é um roteiro para estudar o código do sistema e conseguir montar um
parecido sozinho. Siga na ordem. Os arquivos citados têm comentários didáticos
(procure por blocos `// ====` e por frases como "COMO FUNCIONA", "PADRÃO" e
"RECEITA").

> Complementa o [ARQUITETURA.md](ARQUITETURA.md), que mostra o sistema "de cima",
> com diagramas UML. Este guia mostra "por dentro", arquivo por arquivo.

---

## 0. O que você precisa saber antes (base)

| Assunto | Para quê | Onde estudar (gratuito) |
|---|---|---|
| JavaScript moderno | `const`, funções de seta, `async/await`, `map/filter`, objetos | javascript.info (em português) |
| TypeScript básico | tipos, `type`, união (`'a' \| 'b'`), opcionais (`?`) | typescriptlang.org → Handbook |
| React | componentes, `useState`, `useEffect`, props, contexto | react.dev/learn (tem em português) |
| SQL | `select`, `insert`, `update`, `join`, chave estrangeira | sqlbolt.com e o tutorial do PostgreSQL |
| Git | `add`, `commit`, `push`, branch | "Pro Git" (livro grátis, em português) |

Não precisa dominar tudo antes. Aprenda o básico e volte aqui. O próprio
código vai mostrar o uso real.

---

## 1. O desenho geral (1 dia)

```
 Paciente / Equipe
        │  (site, Android, iPhone — o MESMO código Expo)
        ▼
 app/  ──────────────►  Supabase (nuvem)
 React Native + Expo     ├─ Auth .............. login e senha
                         ├─ Postgres .......... tabelas + REGRAS (RLS, triggers, funções)
                         ├─ Storage ........... fotos e logos
                         ├─ Realtime .......... avisa as telas quando algo muda
                         └─ Edge Functions .... código com chave secreta (Google, captcha, usuários)
```

A ideia principal: **não escrevemos um servidor próprio**. O app conversa direto
com o Supabase, e **a segurança fica no banco**. Leia [ARQUITETURA.md](ARQUITETURA.md).

---

## 2. Roteiro de leitura do código

### Etapa A: a "espinha" do app

1. [app/src/lib/supabase.ts](../app/src/lib/supabase.ts): como o app se conecta,
   o que é chave pública e chave secreta, e o arquivo `.env`.
2. [app/src/app/_layout.tsx](../app/src/app/_layout.tsx): **cada arquivo vira
   uma URL** (expo-router). Entenda `_layout`, `[slug]` e `Stack`.
3. [app/src/lib/auth.tsx](../app/src/lib/auth.tsx): login, **contexto React**,
   `useEffect` com limpeza e `useMemo`.
4. [app/src/app/painel/_layout.tsx](../app/src/app/painel/_layout.tsx):
   **guarda de rota** (sem login, volta para /entrar).

**Exercício:** crie a tela `app/src/app/sobre.tsx` com um `<Title>` e veja-a em
`http://localhost:8081/sobre`. Com isso você entende o roteamento.

### Etapa B: o banco é o "cérebro"

5. [supabase/migrations/20261123000000_agendamento.sql](../supabase/migrations/20261123000000_agendamento.sql):
   o arquivo mais importante do projeto. Leia com calma:
   - **tabelas** e **tipos** (enum, check, not null);
   - **chaves estrangeiras** compostas `(id, clinic_id)`, que impedem misturar clínicas;
   - **EXCLUDE** com gist: o banco recusa dois horários sobrepostos;
   - **trigger**: o banco calcula campos sozinho;
   - **RLS**: `enable row level security` + `create policy` + `auth.uid()`;
   - **funções `public_*`**: a única porta de entrada para quem não tem login;
   - **grant/revoke**: quem pode executar o quê.
6. As migrations seguintes, em ordem de data, mostram como **evoluir** o banco
   sem apagar nada: `alter table ... add column`, `create or replace function`.

**Exercício:** no Supabase → SQL Editor, rode
`select * from public_clinic('anarahealth');` e compare o resultado com a tela
`/agendar/anarahealth`.

### Etapa C: o caminho de um agendamento (de ponta a ponta)

Siga um clique do paciente até o banco:

7. [app/src/app/agendar/[slug].tsx](../app/src/app/agendar/[slug].tsx): carrega
   a clínica. Mostra os **4 estados** de uma tela (erro, carregando, vazio, ok) e o
   **padrão de resposta com chave**.
8. [app/src/features/booking/BookingFlow.tsx](../app/src/features/booking/BookingFlow.tsx):
   **máquina de estados** do passo a passo.
9. [app/src/features/booking/api.ts](../app/src/features/booking/api.ts): a
   **ponte** entre as telas e o banco, `supabase.rpc(...)` e a tradução de códigos
   de erro.
10. `public_book` no SQL: a conferência final, feita no servidor.

Veja o mesmo caminho desenhado em
[docs/uml/02-sequencia-agendar-pelo-link.svg](uml/02-sequencia-agendar-pelo-link.svg).

### Etapa D: o painel da clínica

11. [app/src/app/painel/[clinicId]/_layout.tsx](../app/src/app/painel/[clinicId]/_layout.tsx):
    carrega a clínica uma vez e compartilha com as telas (`ClinicContext`).
12. [app/src/features/agenda/AgendaScreen.tsx](../app/src/features/agenda/AgendaScreen.tsx):
    procure "tempo real" e veja o **Realtime** com **debounce**.
13. [app/src/components/ui.tsx](../app/src/components/ui.tsx) e
    [app/src/constants/theme.ts](../app/src/constants/theme.ts): componentes
    reutilizáveis (Button, Field…) e cores claro/escuro. Crie uma vez, use em todo lugar.

### Etapa E: o lado do servidor (Edge Functions)

14. [supabase/functions/_shared/http.ts](../supabase/functions/_shared/http.ts):
    CORS, cliente "do usuário" e cliente "chave mestra".
15. [supabase/functions/admin-users/index.ts](../supabase/functions/admin-users/index.ts):
    **receita de segurança**: quem é, se pode, e só então age.
16. [supabase/functions/public-book/index.ts](../supabase/functions/public-book/index.ts):
    como conferir um captcha no servidor.
17. [supabase/functions/google-calendar-sync/index.ts](../supabase/functions/google-calendar-sync/index.ts):
    integração com outro serviço (Google Agenda).

### Etapa F: proteção e operação

18. [supabase/migrations/20261126020000_protecao_link.sql](../supabase/migrations/20261126020000_protecao_link.sql):
    limite de frequência (rate limit), hash e Vault.
19. [supabase/migrations/20261126010000_plataforma.sql](../supabase/migrations/20261126010000_plataforma.sql):
    cobrança, situação da clínica e **pg_cron** (tarefa automática diária no banco).

---

## 3. Os padrões que se repetem (decore estes)

| Padrão | Onde ver | Em uma frase |
|---|---|---|
| Segurança no banco (RLS) | migration agendamento | A tela esconde, o banco **proíbe**. |
| Porta pública por função | `public_*` | Visitante sem login só chama funções que devolvem o mínimo. |
| Ponte `api.ts` | `features/*/api.ts` | Tela nunca fala direto com o banco. |
| Código de erro → mensagem | `ERROR_MESSAGES` | O banco fala códigos e o app traduz. |
| Contexto React | `auth.tsx`, `clinic-context.tsx` | Dado que todo mundo usa fica "no ar". |
| Guarda de rota | `painel/_layout.tsx` | Checa o login uma vez, na moldura. |
| Resposta com chave | `agendar/[slug].tsx` | Ignora respostas velhas sem "limpar" estado. |
| Segredo só no servidor | Edge Functions | Chave secreta nunca vai para o app. |
| Migration nova, nunca editar a velha | `supabase/migrations` | O banco evolui por passos. |

---

## 4. Como montar um sistema parecido do zero (receita)

1. **Escreva os requisitos** em frases simples (RF01: "a clínica cadastra
   serviços"…). Veja o README.
2. **Desenhe as tabelas** no papel: o que existe (clínica, paciente, horário) e
   como se liga (uma clínica tem muitos pacientes).
3. Crie o projeto no Supabase e escreva a **primeira migration**: tabelas, RLS e
   políticas. Teste no SQL Editor.
4. `npx create-expo-app` e configure o `.env` com a URL e a chave anon.
5. Faça o **login** (auth.tsx) e a **guarda de rota**.
6. Faça **uma tela por vez**, sempre com um `api.ts` por trás.
7. O que precisar de segredo vai para uma **Edge Function**.
8. Publique cedo (`npm run publicar`) e teste no celular.
9. Faça commit a cada passo que funcionar.

---

## 5. Comandos que você vai usar

```bash
cd app && npx expo start            # roda o app (w = navegador, QR code = celular)
npm run lint                        # confere erros de código
npx supabase db push                # aplica migrations novas no banco da nuvem
npx supabase functions deploy NOME  # publica uma Edge Function
npm run publicar                    # (na raiz) publica o site
git add -A && git commit -m "..." && git push
```

## 6. Dica de estudo

Leia **um arquivo por dia**. Depois de ler, tente explicar em voz alta o que ele
faz. Em seguida, faça uma pequena mudança, veja o efeito e desfaça com
`git checkout -- arquivo`. Errar num lugar seguro é a forma mais rápida de aprender.
