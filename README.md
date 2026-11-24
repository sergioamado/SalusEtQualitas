# Salus Et Qualitas — Módulo de Agendamento

App único para **computador (navegador), Android e iPhone**, feito com Expo (React Native + TypeScript) e Supabase (Postgres).

```
app/        App Expo (web + Android + iOS)
supabase/   Banco de dados: migrations e dados de demonstração
```

## Status

| Etapa | Requisitos | Situação |
|---|---|---|
| Banco de dados completo | RF01–RF14, RN01–RN04 (estrutura) | ✅ |
| Portal público do paciente | RF08–RF12, RN01, RN03, RN04, RNF01, RNF02, RNF05 | ✅ |
| Login, gerente do sistema, isolamento entre clínicas | — | ✅ |
| Recebimento de agendamentos (tempo real) e aprovação | RF05, RNF03, RN04 | ✅ |
| Aparência editável (cores, fonte, logo, foto de fundo) | — | ✅ |
| Google Agenda do gerente | — | ✅ |
| Cadastro de serviços (foto, vídeo do YouTube, o que aparece no link) | — | ✅ |
| Cadastro de profissionais, salas e horários (inclui clínica de uma pessoa só) | RF13 | ✅ |
| Agenda interna: calendário dia/semana/lista, filtros, encaixe, bloqueios, lista de espera, arrastar | RF01–RF07, RNF04 | ✅ |
| Dashboard | RF14 | ✅ |

## Como rodar

### 1. Banco (Supabase)

1. Crie um projeto em https://supabase.com.
2. No **SQL Editor**, execute, nesta ordem:
   - `supabase/migrations/20261123000000_agendamento.sql`
   - `supabase/seed.sql` (opcional; cria a clínica de demonstração `demo`)
3. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.

Também dá para usar a CLI: `supabase link` e depois `supabase db push`.

### 2. App

```bash
cd app
cp .env.example .env       # preencha com a URL e a chave anon
npm install
npm run web                # computador (navegador)
npm run android            # Android (emulador ou app Expo Go)
npm run ios                # iPhone (precisa de macOS ou do app Expo Go)
```

Portal de demonstração: `http://localhost:8081/agendar/demo`

### 3. Publicar

- **Web / link público:** `npx expo export --platform web` gera `app/dist/`, que pode ser hospedado em qualquer site estático com HTTPS (Vercel, Netlify, Cloudflare Pages). Configure o host para redirecionar todas as rotas para `index.html`.
- **Lojas:** `npx eas-cli@latest build -p android` e `npx eas-cli@latest build -p ios`. Não é preciso ter Mac para isso.

## Etapa 2 — login, painel e Google Agenda

### Perfis de acesso

| Perfil | O que vê | Onde é criado |
|---|---|---|
| Gerente do sistema | Todas as clínicas; cria clínicas e acessos | SQL (abaixo), uma vez |
| Gerente da clínica | Só a própria clínica: agendamentos, aparência, equipe | Pelo gerente do sistema |
| Recepção / Profissional | Só os agendamentos da própria clínica | Pelo gerente da clínica |

O isolamento é feito no banco (RLS). Mesmo que alguém altere o app, uma clínica não consegue ler os dados de outra.

### 1. Aplicar o SQL novo

No SQL Editor, rode `supabase/migrations/20261123010000_admin_marca_google.sql`.

Ou, com `SUPABASE_DB_URL` correto no `app/.env`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20261123010000_admin_marca_google.sql
```

### 2. Criar o gerente do sistema

1. Em **Authentication → Users → Add user**, crie o seu usuário com e-mail e senha e marque *Auto Confirm User*.
2. No SQL Editor, rode:

```sql
insert into platform_admins (user_id)
select id from auth.users where email = 'seu-email@exemplo.com';
```

3. No app, abra `/entrar` e entre com esse usuário. Você vai para a lista de clínicas, onde pode criar clínicas e os gerentes delas.

### 3. Publicar as Edge Functions

```bash
npx supabase login
npx supabase link --project-ref SEU-PROJETO
npx supabase functions deploy admin-users google-calendar-sync
```

`admin-users` cria logins com senha. Ela precisa da *service role*, que fica só no servidor.

### 4. Google Agenda (opcional)

1. Em https://console.cloud.google.com, crie um projeto e ative a **Google Calendar API**.
2. Crie uma **conta de serviço** em *IAM → Contas de serviço* e gere uma **chave JSON**.
3. Configure os segredos:

```bash
npx supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat chave-conta-servico.json)"
SEGREDO=$(openssl rand -hex 24) && echo "$SEGREDO"   # copie este valor
npx supabase secrets set SALUS_WEBHOOK_SECRET="$SEGREDO"
```

4. No SQL Editor, rode o comando abaixo, colando o **mesmo** valor de `SEGREDO`:

```sql
-- Pode rodar mais de uma vez: cria o que falta e atualiza o que já existe.
do $$
declare
  v_url    text := 'https://SEU-PROJETO.supabase.co/functions/v1';
  v_secret text := 'O-MESMO-SEGREDO';
  v_id     uuid;
begin
  select id into v_id from vault.secrets where name = 'salus_functions_url';
  if v_id is null then perform vault.create_secret(v_url, 'salus_functions_url');
  else perform vault.update_secret(v_id, v_url); end if;

  select id into v_id from vault.secrets where name = 'salus_webhook_secret';
  if v_id is null then perform vault.create_secret(v_secret, 'salus_webhook_secret');
  else perform vault.update_secret(v_id, v_secret); end if;
end $$;
```

5. Cada gerente de clínica faz o resto sozinho em **Clínica e aparência → Google Agenda**. Lá há um passo a passo de 7 etapas, com botões que abrem as páginas certas do Google: criar uma agenda só da clínica, compartilhar com o e-mail do sistema (botão de copiar) com a permissão "Fazer alterações nos eventos", copiar o ID da agenda, colar, clicar em **Salvar e testar** e instalar o app no celular. Também há uma seção "Deu erro?" com as soluções mais comuns.

Como funciona: cada agendamento novo, alterado ou cancelado dispara um gatilho no banco. O gatilho chama a função, que cria, atualiza ou apaga o evento na agenda do gerente. O evento tem cor por status e lembretes de 1 hora (aviso no celular) e de 1 dia (e-mail). Se o Google falhar, o agendamento não é afetado, e o erro aparece no card do agendamento no painel.

## Etapa 3a — Serviços

Rode `supabase/migrations/20261124000000_servicos_midia.sql` (SQL Editor ou `psql "$SUPABASE_DB_URL" -f ...`).

No painel, a aba **Serviços** (só para o gerente da clínica e o gerente do sistema) permite:
- criar, editar, desativar e excluir serviços (nome, descrição, duração, preço, clínica/residencial, sala);
- escolher se o serviço aparece no link de agendamento e em que ordem;
- enviar uma foto e/ou colar um link do YouTube (watch, youtu.be ou Shorts). No portal, o paciente vê a foto (ou a miniatura do vídeo) e o botão **Ver vídeo**;
- marcar quais profissionais realizam o serviço.

Um serviço só aparece no link se estiver ativo, marcado como disponível e tiver pelo menos um profissional ativo. Serviço com agendamentos não pode ser excluído, só desativado (o histórico fica guardado).

## Etapa 3b — Profissionais, horários e salas

Rode `supabase/migrations/20261124010000_profissionais.sql`.

Aba **Profissionais e horários** (gerente da clínica e gerente do sistema):
- **Clínica pequena:** se quem gerencia também atende, basta tocar em **“Sim, eu atendo”**. O sistema cria o perfil de profissional ligado ao mesmo login (Seg–Sex 8h–18h, almoço 12h–13h, todos os serviços), e dá para ajustar depois. A pessoa continua gerente: vê agendamentos, aparência, equipe e agora a própria agenda. Ao criar uma clínica nova, o gerente do sistema também pode marcar “O gerente também atende”.
- Profissionais: nome, especialidade, cor, login ligado, serviços que realiza, atendimento residencial (com tempo de deslocamento) e horário semanal com pausa (RF13).
- Salas: opcional. Só faz sentido quando várias pessoas dividem o espaço.

`save_professional(jsonb)` grava perfil, serviços, horários e pausas numa transação só, respeitando o RLS.

## Etapa 4 — Agenda

Rode `supabase/migrations/20261124020000_agenda.sql`.

A página inicial de cada clínica no painel agora é a **Agenda**:
- **Visões:** Dia (uma coluna por profissional), Semana (os dias lado a lado, com a cor de cada profissional) e Lista, mais confortável no celular. Fora do expediente e nas pausas, a grade aparece sombreada, e uma linha vermelha marca a hora atual.
- **Agendar pela recepção:** toque num horário vazio ou em **+ Agendar**. Dá para buscar o paciente por nome, telefone ou e-mail, ou cadastrar um novo. Se o telefone ou e-mail já existir, o cadastro é reaproveitado (RN01). Também se registra o canal (telefone, WhatsApp, Instagram…), a duração, o valor, o convênio e as observações.
- **Encaixe:** fora do expediente, na pausa ou num bloqueio, o sistema pede confirmação ("Encaixar mesmo assim"). Um horário em que o profissional já tem outro atendimento, ou sem sala livre, é sempre recusado (RN03/RNF03).
- **Remarcar:** no computador, arraste o bloco para outro horário ou, na visão Dia, para outro profissional (RNF04). No celular, use "Editar / remarcar".
- **Situação (RF05):** agendado, aguardando aprovação, confirmado, concluído, não compareceu e cancelado (com motivo). Ao cancelar, a agenda avisa se há pacientes na lista de espera.
- **Bloqueios (RF07):** folga, feriado, reunião ou outro, para um profissional ou para a clínica inteira, de dia inteiro ou num horário. O link público não oferece esses horários.
- **Filtros (RF04):** situação, profissional, paciente, serviço e sala.
- **Lista de espera (RF06):** aba própria. "Encaixar na agenda" abre o agendamento já preenchido e tira o paciente da lista.
- **Tempo real:** agendamentos feitos pelo link aparecem na agenda na hora.
- Quem tem o papel *Profissional* abre a agenda já filtrada na própria coluna.

## Etapa 5 — Dashboard (RF14)

Rode `supabase/migrations/20261124030000_dashboard.sql`.

Aba **Dashboard**. Começa na semana atual. Dá para trocar para **Quinzena** (1 a 15 ou 16 ao fim do mês), **Mês**, **Ano** ou **Intervalo** (datas de/até, até 400 dias), voltar períodos com ‹ › e filtrar por profissional.
- **Ociosidade por período:** a semana, a quinzena, o mês e o ano de hoje (ou do período escolhido) lado a lado, além do intervalo escolhido.
- **Números:**
  - agendamentos, comparados ao período anterior;
  - ociosidade: a parte do expediente, já sem pausas e bloqueios, que ficou sem paciente;
  - lista de espera;
  - cancelamentos e faltas.
- **Vendas (só para o gerente):** realizadas (concluídos), previstas (agendados, confirmados e aguardando), perdidas com faltas e vendas por serviço.
- **Gráficos:**
  - agendamentos por período (dia, semana ou mês, conforme o tamanho do intervalo);
  - por situação, por convênio e por canal;
  - pacientes frequentes.
- Tudo é calculado no banco pela função `clinic_dashboard`, que respeita o isolamento entre clínicas.

## Como o portal funciona

O link de cada clínica é `/agendar/<slug>`. O paciente passa por 5 passos:
1. Serviço.
2. Local: Na clínica ou Residencial (RF10).
3. Profissional, ou "qualquer profissional".
4. Dia e horário.
5. Dados: nome, e-mail e WhatsApp. No atendimento residencial, também o endereço, preenchido automaticamente pelo CEP via ViaCEP (RF11/RF12). O aceite LGPD é obrigatório.

### Regras garantidas pelo banco

- **Sem overbooking (RNF03/RN03):** restrições de exclusão impedem dois agendamentos no mesmo horário para o mesmo profissional ou a mesma sala. Isso vale também quando dois pacientes confirmam ao mesmo tempo.
- **Disponibilidade (RN03/RF13):** um horário só aparece se estiver dentro do expediente do profissional, fora das pausas e de bloqueios (RF07), sem outro agendamento e com sala livre quando é na clínica. No atendimento residencial, o tempo de deslocamento (`travel_buffer_min`) é reservado antes e depois da visita.
- **Match de contato (RN01):** o sistema procura o paciente pelo e-mail e depois pelo telefone. Se encontrar, vincula o agendamento ao cadastro existente sem sobrescrever dados. Se não encontrar, cria um contato como `lead`.
- **Confirmação (RN04):** `clinics.public_booking_status` = `reservado` (aguarda a recepção) ou `agendado` (confirmação automática).
- **LGPD (RNF05):** o usuário anônimo não lê nenhuma tabela. O portal só chama três funções:
  - `public_clinic`: dados públicos da clínica.
  - `public_available_slots`: horários livres.
  - `public_book`: confirma o agendamento e devolve apenas o resumo do próprio agendamento.

  A equipe acessa os dados por RLS, restrita aos membros da clínica (`clinic_members`).

### Simplificações conhecidas

- **Dois atendimentos residenciais seguidos:** cada visita reserva o deslocamento dos dois lados, então o intervalo exigido entre elas é de 2× o deslocamento. É uma estimativa conservadora.
- **Proteção contra abuso (rate limit, captcha):** ainda não implementada no portal. Vale adicionar antes de divulgar o link.
- **Raio de atendimento (RN02):** previsto como futuro, ainda não implementado.
