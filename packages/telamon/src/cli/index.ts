import { readFile } from 'node:fs/promises';
import { parseServeArgs, UsageError, USAGE } from './args.js';
import { serve } from './serve.js';

async function version(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '-h' || command === '--help') {
    console.log(USAGE);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    console.log(await version());
    return 0;
  }
  if (command !== 'serve') {
    console.error(`Unknown command "${command}".\n\n${USAGE}`);
    return 1;
  }

  const args = parseServeArgs(rest);
  console.log(`\ntelamon ${await version()}`);

  const server = await serve(args);
  console.log(`  ${server.url}\n`);
  if (!args.enhance) {
    console.log('  --no-script: no enhancement script; every feature still works.\n');
  }
  if (args.open) {
    const { default: open } = await import('node:child_process');
    open.spawn(
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open',
      [server.url],
      { stdio: 'ignore', detached: true },
    ).unref();
  }

  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  // Resolve never: the process lives until a signal stops it.
  return new Promise<number>(() => {});
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  },
);
