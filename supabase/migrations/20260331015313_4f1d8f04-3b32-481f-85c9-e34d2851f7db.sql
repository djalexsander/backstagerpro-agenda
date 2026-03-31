
-- Function to validate event creation against plan limits
CREATE OR REPLACE FUNCTION public.check_event_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max_eventos integer;
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

  -- Get max_eventos from the plan
  SELECT max_eventos INTO v_max_eventos FROM public.planos WHERE id = v_plano_id;
  
  IF v_max_eventos IS NULL THEN
    RETURN NEW; -- No limit set, allow
  END IF;

  -- Count current events for this empresa
  SELECT COUNT(*) INTO v_current_count FROM public.events WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_eventos THEN
    RAISE EXCEPTION 'Limite de eventos do plano atingido (% de %)', v_current_count, v_max_eventos;
  END IF;

  RETURN NEW;
END;
$$;

-- Function to validate user creation against plan limits
CREATE OR REPLACE FUNCTION public.check_user_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max_usuarios integer;
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

  -- Get max_usuarios from the plan
  SELECT max_usuarios INTO v_max_usuarios FROM public.planos WHERE id = v_plano_id;
  
  IF v_max_usuarios IS NULL THEN
    RETURN NEW;
  END IF;

  -- Count current users for this empresa
  SELECT COUNT(*) INTO v_current_count FROM public.empresa_usuarios WHERE empresa_id = NEW.empresa_id;

  IF v_current_count >= v_max_usuarios THEN
    RAISE EXCEPTION 'Limite de usuários do plano atingido (% de %)', v_current_count, v_max_usuarios;
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER check_event_limit_trigger
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.check_event_limit();

CREATE TRIGGER check_user_limit_trigger
  BEFORE INSERT ON public.empresa_usuarios
  FOR EACH ROW
  EXECUTE FUNCTION public.check_user_limit();
