import { createApp } from './app';

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const app = await createApp();
  // Development-only Mock auth must never be exposed as a public service.
  await app.listen(port, '127.0.0.1');
  app.enableShutdownHooks();
  console.log(`LinguaPath Mock API listening on loopback port ${port}; no paid APIs enabled`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
