
-- Add logo_url column to empresas
ALTER TABLE public.empresas ADD COLUMN logo_url text DEFAULT NULL;

-- Create logos storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true);

-- RLS policies for logos bucket
CREATE POLICY "Master admin upload logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'logos' AND public.is_master_admin(auth.uid()));

CREATE POLICY "Master admin update logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'logos' AND public.is_master_admin(auth.uid()));

CREATE POLICY "Master admin delete logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'logos' AND public.is_master_admin(auth.uid()));

CREATE POLICY "Anyone can view logos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'logos');
