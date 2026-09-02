CREATE POLICY "photographers upload own delivery files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deliveries' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "photographers read own delivery files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deliveries' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "photographers update own delivery files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'deliveries' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "photographers delete own delivery files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'deliveries' AND (storage.foldername(name))[1] = auth.uid()::text);