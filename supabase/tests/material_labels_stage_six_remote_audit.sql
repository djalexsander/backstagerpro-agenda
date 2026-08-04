WITH audit_rows AS (
  SELECT 'audit_timestamp'::text AS section, 'remote'::text AS object, clock_timestamp()::text AS detail
  UNION ALL
  SELECT 'table', c.relname, 'rls=' || c.relrowsecurity::text
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('etiqueta_modelos','etiqueta_impressoes')
  UNION ALL
  SELECT 'column', table_name || '.' || column_name,
    data_type || CASE WHEN is_nullable='NO' THEN ' NOT NULL' ELSE '' END
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name IN ('etiqueta_modelos','etiqueta_impressoes')
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid, true)
  FROM pg_constraint
  WHERE connamespace='public'::regnamespace
    AND conrelid IN ('public.etiqueta_modelos'::regclass,'public.etiqueta_impressoes'::regclass)
  UNION ALL
  SELECT 'index', tablename || '.' || indexname, indexdef
  FROM pg_indexes
  WHERE schemaname='public' AND tablename IN ('etiqueta_modelos','etiqueta_impressoes')
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
    cmd || ' roles=' || array_to_string(roles,',') || ' using=' || COALESCE(qual,'')
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('etiqueta_modelos','etiqueta_impressoes')
  UNION ALL
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'security_definer=' || p.prosecdef || ' volatility=' || p.provolatile::text ||
    ' authenticated_execute=' || has_function_privilege('authenticated',p.oid,'EXECUTE') ||
    ' anon_execute=' || has_function_privilege('anon',p.oid,'EXECUTE') ||
    ' service_execute=' || has_function_privilege('service_role',p.oid,'EXECUTE')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'resolve_material_labels_company','validate_material_label_fields',
    'protect_material_label_projection','protect_material_label_history',
    'salvar_modelo_etiqueta','inativar_modelo_etiqueta','listar_modelos_etiqueta',
    'buscar_materiais_etiqueta','registrar_solicitacao_impressao_etiqueta',
    'listar_historico_impressoes_etiqueta','obter_indicadores_etiquetas'
  )
  UNION ALL
  SELECT 'table_privilege', table_name || '.' || privilege_type, grantee
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name IN ('etiqueta_modelos','etiqueta_impressoes')
    AND grantee IN ('anon','authenticated','service_role')
  UNION ALL
  SELECT 'module', c.feature_key, 'active=' || c.ativo || ' metadata=' || c.metadata::text
  FROM public.module_catalog c WHERE c.feature_key='etiquetas_materiais'
  UNION ALL
  SELECT 'dependency', child.feature_key, parent.feature_key
  FROM public.module_dependencies d
  JOIN public.module_catalog child ON child.id=d.module_id
  JOIN public.module_catalog parent ON parent.id=d.required_module_id
  WHERE child.feature_key='etiquetas_materiais'
  UNION ALL
  SELECT 'identification_enum', e.enumlabel, e.enumsortorder::text
  FROM pg_enum e WHERE e.enumtypid='public.material_identification_type'::regtype
  UNION ALL
  SELECT 'row_count', 'etiqueta_modelos', count(*)::text FROM public.etiqueta_modelos
  UNION ALL
  SELECT 'row_count', 'etiqueta_impressoes', count(*)::text FROM public.etiqueta_impressoes
  UNION ALL
  SELECT 'parallel_system_check', 'material_tables', string_agg(tablename,', ' ORDER BY tablename)
  FROM pg_tables
  WHERE schemaname='public' AND (tablename LIKE 'materia%' OR tablename LIKE 'etiqueta%')
)
SELECT section, object, detail FROM audit_rows ORDER BY section, object;
