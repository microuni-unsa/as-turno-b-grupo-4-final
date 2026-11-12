import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];

function spawnProcess(cmd: string, args: string[]): ChildProcess {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  return child;
}

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const backend = spawnProcess("bun", ["run", "packages/cockpit/src/server.ts"]);
const frontend = spawnProcess("bun", ["--filter", "@pims/cockpit", "dev:ui"]);

backend.on("exit", (code) => {
  if (!shuttingDown) {
    shutdown("SIGTERM");
    process.exit(code ?? 0);
  }
});

frontend.on("exit", (code) => {
  if (!shuttingDown) {
    shutdown("SIGTERM");
    process.exit(code ?? 0);
  }
});
