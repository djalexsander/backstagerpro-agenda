-- Fix PAULO TRINDADE's profile: link to ESTAÇÃO MIX empresa
UPDATE public.profiles 
SET empresa_id = '19a1fe1a-521c-4c29-846e-d7156069970d'
WHERE user_id = '8d27350f-00e0-40d3-b71d-51670584b872' AND empresa_id IS NULL;

-- Recreate handle_new_user to be more robust with empresa_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, empresa_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE 
      WHEN NEW.raw_user_meta_data->>'empresa_id' IS NOT NULL 
           AND NEW.raw_user_meta_data->>'empresa_id' != '' 
           AND NEW.raw_user_meta_data->>'empresa_id' != 'null'
      THEN (NEW.raw_user_meta_data->>'empresa_id')::uuid
      ELSE NULL
    END
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'role', 'usuario')::app_role);

  RETURN NEW;
END;
$$;