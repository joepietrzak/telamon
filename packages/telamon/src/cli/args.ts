/** Argument parsing for the CLI, kept separate so it can be tested without a server. */

export interface ServeArgs {
  dir: string;
  port: number;
  host: string;
  basename?: string;
  title?: string;
  enhance: boolean;
  open: boolean;
}

export class UsageError extends Error {}

export const USAGE = `telamon serve [directory] [options]

  Serve an OKF bundle, rendered on the server.

Options
  -p, --port <number>    Port to listen on. Default 3000.
      --host <host>      Interface to bind. Default localhost.
      --basename <path>  Sub-path the site is mounted at, e.g. /docs.
      --title <title>    Site title. Defaults to the bundle root's own.
      --no-script        Serve HTML with no enhancement script at all.
      --open             Open a browser once listening.
  -h, --help             Show this message.
  -v, --version          Print the version.
`;

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('-')) {
    throw new UsageError(`${flag} needs a value.`);
  }
  return value;
}

export function parseServeArgs(argv: string[]): ServeArgs {
  const args: ServeArgs = {
    dir: '.',
    port: 3000,
    host: 'localhost',
    enhance: true,
    open: false,
  };
  let sawDir = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '-p':
      case '--port': {
        const value = Number(requireValue(arg, argv[++i]));
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
          throw new UsageError(`--port must be a port number, got "${argv[i]}".`);
        }
        args.port = value;
        break;
      }
      case '--host':
        args.host = requireValue(arg, argv[++i]);
        break;
      case '--basename':
        args.basename = requireValue(arg, argv[++i]);
        break;
      case '--title':
        args.title = requireValue(arg, argv[++i]);
        break;
      case '--no-script':
        args.enhance = false;
        break;
      case '--open':
        args.open = true;
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option "${arg}".`);
        if (sawDir) throw new UsageError(`Unexpected argument "${arg}".`);
        args.dir = arg;
        sawDir = true;
    }
  }

  return args;
}
