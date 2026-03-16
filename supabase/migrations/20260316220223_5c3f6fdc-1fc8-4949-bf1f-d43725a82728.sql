
-- Allow admin_empresa to read PIX system settings (needed to generate QR code)
CREATE POLICY "Admin empresa read pix settings" ON public.system_settings
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin_empresa'::app_role) AND key LIKE 'pix_%'
);
