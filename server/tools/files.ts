import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import type { Tool } from './shared';
import { errorP, plainP, requestOrigin } from './shared';
import * as objectStore from '../objectStore';
import { FILES_DIR } from '../paths';

if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

/** Remove a share's directory, e.g. after lazy expiration deleted its DB row. */
function removeShareDir(shareId: string): void {
  const shareDir = path.join(FILES_DIR, shareId);
  if (fs.existsSync(shareDir)) {
    fs.rmSync(shareDir, { recursive: true, force: true });
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

type ShareData = { files: Array<{ name: string; storedName: string }> };

export const files: Tool = {
  id: 'files',
  href: '/files/new',
  category: 'share',
  icon: '<path d="M3 6h6l2 2h10v12H3z"/>',

  onPurge(row) {
    if (row.type === 'fileshare') removeShareDir(row.id);
  },

  routes(fastify) {
    // Create form page
    fastify.get('/files/new', async (request, reply) => {
      return reply.view('files/new', { title: request.i18n.t('files.new.title') });
    });

    // Upload files
    fastify.post('/files', async (request, reply) => {
      const parts = request.parts();
      const uploadedFiles: Array<{ name: string; storedName: string; size: number; sizeFormatted: string }> = [];

      // Generate share ID upfront
      const shareId = crypto.randomBytes(8).toString('base64url');
      const shareDir = path.join(FILES_DIR, shareId);
      let expiryDays = 3; // default

      try {
        fs.mkdirSync(shareDir, { recursive: true });

        for await (const part of parts) {
          if (part.type === 'field' && part.fieldname === 'expiry') {
            const val = parseInt(part.value as string, 10);
            if ([1, 3, 7, 30].includes(val)) expiryDays = val;
          }
          if (part.type === 'file' && part.filename) {
            const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = path.join(shareDir, safeName);

            await pipeline(part.file, fs.createWriteStream(filePath));

            const stats = fs.statSync(filePath);
            uploadedFiles.push({
              name: part.filename,
              storedName: safeName,
              size: stats.size,
              sizeFormatted: formatFileSize(stats.size)
            });
          }
        }

        if (uploadedFiles.length === 0) {
          fs.rmdirSync(shareDir);
          return reply.type('text/html').send(errorP(request.i18n, 'files.err.none'));
        }

        const expiresAt = Date.now() + expiryDays * 24 * 60 * 60 * 1000;
        objectStore.createWithId(shareId, 'fileshare', { files: uploadedFiles }, expiresAt);

        return reply.view('_created', {
          heading: request.i18n.t('files.created'),
          url: `${requestOrigin(request)}/files/${shareId}`,
          hint: request.i18n.tn('files.expiresIn', expiryDays)
        });
      } catch (err) {
        removeShareDir(shareId);
        return reply.type('text/html').send(errorP(request.i18n, 'files.err.upload', { message: (err as Error).message }));
      }
    });

    // View share page
    fastify.get('/files/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const share = objectStore.get(id);

      if (!share) {
        removeShareDir(id);
        return reply.view('files/gone', { title: request.i18n.t('files.gone.title') });
      }

      return reply.view('files/show', {
        title: request.i18n.t('files.show.title'),
        share,
        shareUrl: `${requestOrigin(request)}/files/${id}`
      });
    });

    // Download single file
    fastify.get('/files/:id/download/:filename', async (request, reply) => {
      const { id, filename } = request.params as { id: string; filename: string };
      const share = objectStore.get(id);

      if (!share) {
        removeShareDir(id);
        return reply.status(404).send('Not found');
      }

      const file = (share.data as ShareData).files.find(f => f.name === filename);
      if (!file) return reply.status(404).send('File not found');

      const filePath = path.join(FILES_DIR, id, file.storedName);
      if (!fs.existsSync(filePath)) return reply.status(404).send('File not found');

      return reply.header('Content-Disposition', `attachment; filename="${file.name}"`).send(fs.createReadStream(filePath));
    });

    // Download all as ZIP
    fastify.get('/files/:id/zip', async (request, reply) => {
      const { id } = request.params as { id: string };
      const share = objectStore.get(id);

      if (!share) {
        removeShareDir(id);
        return reply.status(404).send('Not found');
      }

      const shareDir = path.join(FILES_DIR, id);

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="files-${id}.zip"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.on('error', (err) => { throw err; });

      for (const file of (share.data as ShareData).files) {
        const filePath = path.join(shareDir, file.storedName);
        if (fs.existsSync(filePath)) archive.file(filePath, { name: file.name });
      }

      archive.finalize();
      return reply.send(archive);
    });

    // Delete share
    fastify.delete('/files/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const share = objectStore.get(id);

      removeShareDir(id);
      if (!share) {
        return reply.type('text/html').send(plainP(request.i18n, 'files.notFound'));
      }

      objectStore.remove(id);
      return reply.type('text/html').send(`<p>${request.i18n.t('files.deleted')}</p><p><a href="/files/new">${request.i18n.t('files.shareMore')}</a></p>`);
    });
  }
};
