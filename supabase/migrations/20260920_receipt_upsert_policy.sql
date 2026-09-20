-- Required for Storage upsert: an active user may read only its own approved receipt path.
create policy "users_view_own_receipts" on storage.objects
for select to authenticated
using (
  bucket_id = 'receipts'
  and private.is_active_user()
  and (storage.foldername(name))[1] = ((select auth.uid())::text)
  and array_length(storage.foldername(name), 1) = 3
  and storage.filename(name) = any (array['comprobante.jpg', 'comprobante.png', 'comprobante.pdf'])
);
