import { buildApp, purgeExpired } from './app';

function log(message: string, source = "fastify") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

async function start() {
  // RATE_LIMIT=off is for local scripts that write much faster than people do
  const fastify = await buildApp({ rateLimit: process.env.RATE_LIMIT !== 'off' });
  const port = parseInt(process.env.PORT || "3459", 10);

  // Periodic cleanup: purge expired objects and their files every hour
  const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  setInterval(() => {
    try {
      const purged = purgeExpired();
      if (purged > 0) {
        log(`cleanup: purged ${purged} expired object(s)`);
      }
    } catch (err) {
      log(`cleanup error: ${(err as Error).message}`);
    }
  }, CLEANUP_INTERVAL);

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';

  try {
    await fastify.listen({ port, host });
    log(`serving on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
