-- ============================================================================
-- IMAGENS: corrige a exclusão de fotos antigas (clinic-assets)
-- ----------------------------------------------------------------------------
-- O bucket é público (o paciente vê as fotos pela URL), mas para APAGAR um
-- arquivo pela API o Supabase Storage primeiro precisa "enxergá-lo" com a
-- permissão de quem pede — ou seja, precisa de uma política de SELECT.
-- Sem ela, remove() respondia "ok" sem apagar nada, e cada foto trocada
-- ficava esquecida no armazenamento, ocupando espaço.
-- A regra é a mesma das outras: só quem gerencia a clínica, só na pasta dela.
-- ============================================================================
drop policy if exists clinic_assets_select on storage.objects;
create policy clinic_assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'clinic-assets'
    and exists (
      select 1 from clinics c
      where c.id::text = (storage.foldername(objects.name))[1] and can_manage_clinic(c.id)
    )
  );
