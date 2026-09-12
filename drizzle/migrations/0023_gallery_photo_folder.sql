-- Proofs the client hearts, then an edited subfolder they can download.
ALTER TABLE public.gallery_photos
  ADD COLUMN IF NOT EXISTS folder text NOT NULL DEFAULT 'proofs';
ALTER TABLE public.gallery_photos
  DROP CONSTRAINT IF EXISTS gallery_photos_folder_check;
ALTER TABLE public.gallery_photos
  ADD CONSTRAINT gallery_photos_folder_check CHECK (folder IN ('proofs', 'edited'));
CREATE INDEX IF NOT EXISTS idx_gallery_photos_folder ON public.gallery_photos(gallery_id, folder);
