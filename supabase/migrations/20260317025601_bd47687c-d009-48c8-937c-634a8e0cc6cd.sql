
-- Add num_days column to events
ALTER TABLE public.events ADD COLUMN num_days integer NOT NULL DEFAULT 1;

-- Create event_days table
CREATE TABLE public.event_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  day_number integer NOT NULL,
  date date,
  artist text DEFAULT '',
  show_time time WITHOUT TIME ZONE,
  observations text,
  empresa_id uuid REFERENCES public.empresas(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_days ENABLE ROW LEVEL SECURITY;

-- RLS policies for event_days
CREATE POLICY "View company event days" ON public.event_days
FOR SELECT TO authenticated
USING (is_master_admin(auth.uid()) OR empresa_id = get_user_empresa_id(auth.uid()));

CREATE POLICY "Admin insert event days" ON public.event_days
FOR INSERT TO authenticated
WITH CHECK (is_master_admin(auth.uid()) OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin update event days" ON public.event_days
FOR UPDATE TO authenticated
USING (is_master_admin(auth.uid()) OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid())));

CREATE POLICY "Admin delete event days" ON public.event_days
FOR DELETE TO authenticated
USING (is_master_admin(auth.uid()) OR (has_role(auth.uid(), 'admin_empresa'::app_role) AND empresa_id = get_user_empresa_id(auth.uid())));

-- Add event_day_id to event_files for per-day riders
ALTER TABLE public.event_files ADD COLUMN event_day_id uuid REFERENCES public.event_days(id) ON DELETE CASCADE;
