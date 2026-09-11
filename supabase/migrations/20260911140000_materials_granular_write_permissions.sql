-- Backstage Pro - Materiais adopts the granular per-user permission
-- mechanism already proven by RFID, Check-in/Check-out, Controle de
-- Estoque, Manutenção and Locação (user_module_permissions/
-- user_has_module_action, 20260810090000_user_module_permissions.sql).
--
-- Unlike the other four modules in this rollout, Materiais CRUD never went
-- through RPCs - it writes straight to public.materiais/categorias_materiais/
-- materiais_fotos via PostgREST, gated by RLS policies that all require
-- can_write_company_module('gestao_materiais') unconditionally
-- (20260730073000_materials_inventory_stage_one.sql). A plain "usuario" can
-- therefore never create/edit a material or its categories/photo metadata,
-- even after an admin_empresa grants create/edit/delete on 'gestao_materiais'
-- via "Editar Usuário".
--
-- Fix: every INSERT/UPDATE/DELETE policy on these three tables now accepts
-- can_write_company_module(...) OR the matching user_has_module_action(...)
-- grant - INSERT -> 'create', UPDATE -> 'edit', DELETE -> 'delete'. SELECT
-- policies are untouched (can_read_company_module has no role gate, same as
-- every other module in this rollout).
--
-- Scope boundary, documented rather than silently skipped: this migration
-- does NOT touch the four identifier RPCs (generate_material_qr_code,
-- generate_material_barcode, replace_material_barcode,
-- clear_material_barcode - all still can_write_company_module-only) or the
-- material-photos Storage bucket policies
-- (can_read/can_manage_material_photo_object). Those remain role-only for
-- now; frontend gerarIdentificadores/gerenciarFotos stay behind the coarse
-- admin-only canManage flag in Materiais.tsx (gerenciarFotos already has no
-- effect there today - MaterialFormDialog.tsx hardcodes true for the photo
-- gallery, a pre-existing, unrelated frontend gap not introduced or widened
-- here). criar/editar are the two actions this migration makes granular,
-- matching the two RLS-enforced operations (INSERT/UPDATE) that exist on
-- these tables today.

-- ============================================================================
-- 1. categorias_materiais
-- ============================================================================

DROP POLICY IF EXISTS "Licensed tenant administrators insert material categories" ON public.categorias_materiais;
CREATE POLICY "Licensed tenant administrators insert material categories"
ON public.categorias_materiais
FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'create')
);

DROP POLICY IF EXISTS "Licensed tenant administrators update material categories" ON public.categorias_materiais;
CREATE POLICY "Licensed tenant administrators update material categories"
ON public.categorias_materiais
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
);

DROP POLICY IF EXISTS "Licensed tenant administrators delete unused material categories" ON public.categorias_materiais;
CREATE POLICY "Licensed tenant administrators delete unused material categories"
ON public.categorias_materiais
FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'delete')
);

-- ============================================================================
-- 2. materiais (no DELETE policy exists - "inativar" is a soft UPDATE)
-- ============================================================================

DROP POLICY IF EXISTS "Licensed tenant administrators insert materials" ON public.materiais;
CREATE POLICY "Licensed tenant administrators insert materials"
ON public.materiais
FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'create')
);

DROP POLICY IF EXISTS "Licensed tenant administrators update materials" ON public.materiais;
CREATE POLICY "Licensed tenant administrators update materials"
ON public.materiais
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
)
WITH CHECK (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
);

-- ============================================================================
-- 3. materiais_fotos
-- ============================================================================

DROP POLICY IF EXISTS "Licensed tenant administrators insert material photo metadata" ON public.materiais_fotos;
CREATE POLICY "Licensed tenant administrators insert material photo metadata"
ON public.materiais_fotos
FOR INSERT TO authenticated
WITH CHECK (
  (
    public.can_write_company_module(empresa_id, 'gestao_materiais')
    OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'create')
  )
  AND EXISTS (
    SELECT 1
    FROM public.materiais
    WHERE id = material_id
      AND empresa_id = materiais_fotos.empresa_id
  )
);

DROP POLICY IF EXISTS "Licensed tenant administrators update material photo metadata" ON public.materiais_fotos;
CREATE POLICY "Licensed tenant administrators update material photo metadata"
ON public.materiais_fotos
FOR UPDATE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
)
WITH CHECK (
  (
    public.can_write_company_module(empresa_id, 'gestao_materiais')
    OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'edit')
  )
  AND EXISTS (
    SELECT 1
    FROM public.materiais
    WHERE id = material_id
      AND empresa_id = materiais_fotos.empresa_id
  )
);

DROP POLICY IF EXISTS "Licensed tenant administrators delete material photo metadata" ON public.materiais_fotos;
CREATE POLICY "Licensed tenant administrators delete material photo metadata"
ON public.materiais_fotos
FOR DELETE TO authenticated
USING (
  public.can_write_company_module(empresa_id, 'gestao_materiais')
  OR public.user_has_module_action(empresa_id, 'gestao_materiais', 'delete')
);
