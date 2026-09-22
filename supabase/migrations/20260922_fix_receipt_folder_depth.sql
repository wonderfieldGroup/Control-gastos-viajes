-- Correct receipt object path validation.
-- storage.foldername(name) excludes the filename, so
-- <user_id>/<expense_id>/comprobante.ext contains exactly two folders.

alter policy users_upload_own_receipts
on storage.objects
with check (
  bucket_id = 'receipts'
  and private.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and storage.filename(name) = any (array['comprobante.jpg', 'comprobante.png', 'comprobante.pdf'])
);

alter policy users_update_own_receipts
on storage.objects
using (
  bucket_id = 'receipts'
  and private.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'receipts'
  and private.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and storage.filename(name) = any (array['comprobante.jpg', 'comprobante.png', 'comprobante.pdf'])
);

alter policy users_view_own_receipts
on storage.objects
using (
  bucket_id = 'receipts'
  and private.is_active_user()
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and storage.filename(name) = any (array['comprobante.jpg', 'comprobante.png', 'comprobante.pdf'])
);
