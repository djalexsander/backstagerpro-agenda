
-- ============================================================================
-- ETAPA 4: Atualizar triggers de limite para somar módulos de capacidade
-- Fallback seguro: sem módulos = comportamento idêntico ao anterior
-- ============================================================================

-- 1. CHECK EVENT LIMIT (com módulos)
CREATE OR REPLACE FUNCTION public.check_event_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_eventos integer;
  v_extra_eventos integer;
  v_current_count integer;
  v_plano_id uuid;
  v_is_master boolean;
BEGIN
  -- Master admins bypass limits
  SELECT public.is_master_admin(auth.uid()) INTO v_is_master;
  IF v_is_master THEN
    RETURN NEW;
  END IF;

  -- Get the plan for this empresa
  SELECT plano_id INTO v_plano_id FROM public.empresas WHERE id = NEW.empresa_id;
  
  IF v_plano_id IS NULL THEN
    RETURN NEW; -- No plan assigned, allow
  END IF;

  -- Get max_eventos from the plan (base limit)
  SELECT max_eventos INTO v_max_eventos FROM public.planos WHERE id = v_plano_id;
  
  IF v_max_eventos IS NULL THEN
    RETURN NEW; -- No limit set (unlimited), allow
  END IF;

  -- Sum extra capacity from active modules
  SELECT COALESCE(SUM(mc.capacidade_extra_eventos), 0)
    INTO v_extra_eventos
    FROM public.empresa_modules em
    JOIN public.module_catalog mc ON mc.id = em.module_id
   WHERE em.empresa_id = NEW.empresa_id
     AND em.status = 'active'
     AND mc.is_capacity_module = true
     AND mc.capacidade_extra_eventos > 0;

  v_max_eventos := v_max_eventos + v_extra_eventos;

  -- Count current events for this empresa
  SELECT COUNT(*) INTO v_current_count FROM public.events WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_eventos THEN
    RAISE EXCEPTION 'Limite de eventos do plano atingido (% de %)', v_current_count, v_max_eventos;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. CHECK USER LIMIT (com módulos)
CREATE OR REPLACE FUNCTION public.check_user_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_usuarios integer;
  v_extra_usuarios integer;
  v_current_count integer;
  v_plano_id uuid;
  v_is_master boolean;
BEGIN
  -- Master admins bypass limits
  SELECT public.is_master_admin(auth.uid()) INTO v_is_master;
  IF v_is_master THEN
    RETURN NEW;
  END IF;

  -- Get the plan for this empresa
  SELECT plano_id INTO v_plano_id FROM public.empresas WHERE id = NEW.empresa_id;
  
  IF v_plano_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get max_usuarios from the plan (base limit)
  SELECT max_usuarios INTO v_max_usuarios FROM public.planos WHERE id = v_plano_id;
  
  IF v_max_usuarios IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sum extra capacity from active modules
  SELECT COALESCE(SUM(mc.capacidade_extra_usuarios), 0)
    INTO v_extra_usuarios
    FROM public.empresa_modules em
    JOIN public.module_catalog mc ON mc.id = em.module_id
   WHERE em.empresa_id = NEW.empresa_id
     AND em.status = 'active'
     AND mc.is_capacity_module = true
     AND mc.capacidade_extra_usuarios > 0;

  v_max_usuarios := v_max_usuarios + v_extra_usuarios;

  -- Count current users for this empresa
  SELECT COUNT(*) INTO v_current_count FROM public.empresa_usuarios WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_usuarios THEN
    RAISE EXCEPTION 'Limite de usuários do plano atingido (% de %)', v_current_count, v_max_usuarios;
  END IF;

  RETURN NEW;
END;
$function$;
