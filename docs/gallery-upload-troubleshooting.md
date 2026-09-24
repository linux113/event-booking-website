# Gallery uploads on Vercel

## Configure Blob storage

Gallery images are stored in Vercel Blob; Neon stores only the image metadata and Blob URLs. If `/admin/gallery` shows the storage setup banner, or an upload says Blob rejected the deployment credentials:

1. Open **Vercel → Project → Storage → Create → Blob**.
2. Create the Blob store and connect it to this project.
3. Enable it for **Production**. Also enable **Preview** if uploads are made from preview deployments.
4. In **Project → Settings → Environment Variables**, confirm `BLOB_READ_WRITE_TOKEN` is available to the same deployment environment. The application checks this variable before accepting uploads.
5. Redeploy after connecting the store or changing an environment variable.

If the store is connected and the token is present but writes still fail, check the Vercel Function logs for `[gallery] upload to storage failed`. A 401/403 response usually means the deployment is using a missing, expired, or wrong-store credential. Reconnect the correct store, confirm the Production/Preview environment selection, and redeploy.

## Upload sizes

Vercel Functions have an approximately 4.5 MiB request-body cap. The admin uploader reduces photos above 800 KB to WebP in the browser, then sends sequential batches with no more than 3.5 MiB of image bytes. The API rejects a request above its 4 MiB safety limit before parsing the multipart form. If a browser cannot decode or compress a selected photo enough, choose a smaller file or convert it to JPEG/WebP and try again.

## Why an uploaded photo is not on `/gallery`

Uploads intentionally arrive as **drafts**. The admin gallery lists published rows only on the public site. The admin screen labels the number of drafts as “not visible on the site yet”; choose **Publish** on the photo to show it publicly. Publishing updates the row status and invalidates the public gallery/homepage cache. The photo can still be inspected in Admin → Gallery through its authenticated preview route before publishing.

The Blob store is a single **public** Blob store; publication is controlled by the gallery row, not by moving an object between private and public buckets. Draft rows and their URLs are excluded from the public website, but a public Blob URL is accessible to anyone who already knows it. Treat drafts as unlisted, not as private storage, and do not upload sensitive images.

## If uploads succeed but previews fail

The preview route first reads the gallery row from Neon, then uses the Blob token to `head()` and download the thumbnail. Confirm both `DATABASE_URL` and the matching Blob credentials are set for the deployment environment. Function logs include `[gallery] preview download failed` if Blob cannot retrieve an object. If the database row points to a missing object, remove the broken draft and upload it again.
