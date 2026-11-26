// Gestão de usuários com login e senha.
//  - Gerente do sistema: qualquer clínica, qualquer papel.
//  - Gerente da clínica: só a própria clínica.
//
// Ações (POST JSON):
//   { action: 'list',         clinic_id }
//   { action: 'create',       clinic_id, email, password, full_name, role }
//   { action: 'set_password', clinic_id, user_id, password }
//   { action: 'set_role',     clinic_id, user_id, role }
//   { action: 'remove',       clinic_id, user_id }
//   { action: 'delete_clinic', clinic_id, confirm_slug, delete_users }  (só gerente do sistema)
import { corsHeaders, json, requireUser, serviceClient } from '../_shared/http.ts';

const ROLES = ['admin', 'recepcao', 'profissional'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = await requireUser(req);
  if (!auth) return json({ error: 'Não autenticado' }, 401);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  if (typeof b.clinic_id !== 'string') return json({ error: 'clinic_id obrigatório' }, 400);

  const { data: allowed } = await auth.client.rpc('can_manage_clinic', { p_clinic_id: b.clinic_id });
  if (!allowed) return json({ error: 'Sem permissão para esta clínica' }, 403);

  const db = serviceClient();

  // O usuário alvo precisa pertencer à clínica informada.
  const assertMember = async () => {
    const { data } = await db
      .from('clinic_members')
      .select('user_id')
      .eq('clinic_id', b.clinic_id)
      .eq('user_id', b.user_id)
      .maybeSingle();
    return !!data;
  };

  switch (b.action) {
    case 'list': {
      const { data: members, error } = await db
        .from('clinic_members')
        .select('user_id, role, created_at')
        .eq('clinic_id', b.clinic_id)
        .order('created_at');
      if (error) return json({ error: error.message }, 500);
      const users = await Promise.all(
        (members ?? []).map(async (m) => {
          const { data } = await db.auth.admin.getUserById(m.user_id);
          return {
            ...m,
            email: data.user?.email ?? null,
            full_name: data.user?.user_metadata?.full_name ?? null,
            last_sign_in_at: data.user?.last_sign_in_at ?? null,
          };
        }),
      );
      return json({ members: users });
    }

    case 'create': {
      const email = String(b.email ?? '').trim().toLowerCase();
      const password = String(b.password ?? '');
      const role = ROLES.includes(b.role) ? b.role : 'recepcao';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
      if (password.length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres' }, 400);

      const { data: created, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: String(b.full_name ?? '').trim() || null },
      });
      if (error || !created.user) {
        const exists = /already|registered|exists/i.test(error?.message ?? '');
        return json({ error: exists ? 'Já existe um usuário com este e-mail.' : error?.message }, 400);
      }
      const { error: memberError } = await db
        .from('clinic_members')
        .insert({ clinic_id: b.clinic_id, user_id: created.user.id, role });
      if (memberError) {
        await db.auth.admin.deleteUser(created.user.id);
        return json({ error: memberError.message }, 500);
      }
      return json({ ok: true, user_id: created.user.id });
    }

    case 'set_password': {
      if (!(await assertMember())) return json({ error: 'Usuário não pertence à clínica' }, 404);
      if (String(b.password ?? '').length < 8) return json({ error: 'A senha precisa ter pelo menos 8 caracteres' }, 400);
      const { error } = await db.auth.admin.updateUserById(b.user_id, { password: b.password });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    case 'set_role': {
      if (!(await assertMember())) return json({ error: 'Usuário não pertence à clínica' }, 404);
      if (!ROLES.includes(b.role)) return json({ error: 'Papel inválido' }, 400);
      const { error } = await db
        .from('clinic_members')
        .update({ role: b.role })
        .eq('clinic_id', b.clinic_id)
        .eq('user_id', b.user_id);
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }

    case 'remove': {
      if (b.user_id === auth.user.id) return json({ error: 'Você não pode remover a si mesmo.' }, 400);
      if (!(await assertMember())) return json({ error: 'Usuário não pertence à clínica' }, 404);
      await db.from('clinic_members').delete().eq('clinic_id', b.clinic_id).eq('user_id', b.user_id);
      // Se não sobrou vínculo com nenhuma clínica e não é admin do sistema, apaga o login.
      const [{ count }, { data: admin }] = await Promise.all([
        db.from('clinic_members').select('*', { count: 'exact', head: true }).eq('user_id', b.user_id),
        db.from('platform_admins').select('user_id').eq('user_id', b.user_id).maybeSingle(),
      ]);
      if (!count && !admin) await db.auth.admin.deleteUser(b.user_id);
      return json({ ok: true });
    }

    // Exclusão definitiva da clínica (só gerente do sistema): arquivos, dados e,
    // se pedido, os logins que não pertencem a nenhuma outra clínica.
    case 'delete_clinic': {
      const { data: isAdmin } = await auth.client.rpc('is_platform_admin');
      if (!isAdmin) return json({ error: 'Somente o gerente do sistema pode excluir clínicas.' }, 403);
      const { data: clinic } = await db.from('clinics').select('id, slug').eq('id', b.clinic_id).maybeSingle();
      if (!clinic) return json({ error: 'Clínica não encontrada.' }, 404);
      if (String(b.confirm_slug ?? '').trim() !== clinic.slug) {
        return json({ error: 'Confirmação incorreta: digite o link da clínica exatamente como aparece.' }, 400);
      }
      const { data: members } = await db.from('clinic_members').select('user_id').eq('clinic_id', clinic.id);

      const bucket = db.storage.from('clinic-assets');
      let removedFiles = 0;
      for (;;) {
        const { data: files, error } = await bucket.list(clinic.id, { limit: 1000 });
        if (error) return json({ error: `Não foi possível listar os arquivos: ${error.message}` }, 500);
        if (!files?.length) break;
        const paths = files.map((f) => `${clinic.id}/${f.name}`);
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) return json({ error: `Não foi possível apagar os arquivos: ${removeError.message}` }, 500);
        removedFiles += paths.length;
        if (files.length < 1000) break;
      }

      const { error: purgeError } = await db.rpc('admin_purge_clinic', { p_clinic_id: clinic.id });
      if (purgeError) return json({ error: `Não foi possível apagar os dados: ${purgeError.message}` }, 500);

      let removedUsers = 0;
      if (b.delete_users) {
        for (const m of members ?? []) {
          if (m.user_id === auth.user.id) continue;
          const [{ count }, { data: admin }] = await Promise.all([
            db.from('clinic_members').select('*', { count: 'exact', head: true }).eq('user_id', m.user_id),
            db.from('platform_admins').select('user_id').eq('user_id', m.user_id).maybeSingle(),
          ]);
          if (!count && !admin) {
            const { error } = await db.auth.admin.deleteUser(m.user_id);
            if (!error) removedUsers++;
          }
        }
      }
      return json({ ok: true, removed_files: removedFiles, removed_users: removedUsers });
    }

    default:
      return json({ error: 'Ação desconhecida' }, 400);
  }
});
