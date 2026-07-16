import { env } from './env';
import { createSandboxServer } from './server';

createSandboxServer().listen(env.port, env.host, () => {
  console.log(`[ws-server] listening on ${env.host}:${env.port}`);
});
