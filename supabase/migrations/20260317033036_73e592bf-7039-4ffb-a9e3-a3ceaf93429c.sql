
ALTER TABLE public.pagamentos ADD COLUMN comprovante_path text;

INSERT INTO storage.buckets (id, name, public) VALUES ('comprovantes', 'comprovantes', true);

CREATE POLICY "Empresa upload comprovante" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovantes');

CREATE POLICY "View comprovantes" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'comprovantes');
