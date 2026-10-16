-- Raise only the receipt size limit. Preserve privacy, MIME types and policies.
update storage.buckets set file_size_limit = 5242880 where id = 'receipts';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'receipts';
