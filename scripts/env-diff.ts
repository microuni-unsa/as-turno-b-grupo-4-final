#!/usr/bin/env bun

async function materialize(preset: string): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      ["microdev", "materialize", "--preset", preset, "--out", "-"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  } catch (err) {
    console.error(
      `Failed to spawn microdev for preset "${preset}": ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(
      `microdev materialize failed for preset "${preset}" (exit code ${exitCode}):`,
    );
    if (stderr.trim().length > 0) {
      console.error(stderr.trim());
    }
    process.exit(2);
  }

  return stdout;
}

function parseEnv(output: string, preset: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      console.error(
        `Error: Malformed line ${i + 1} in preset "${preset}" (missing '='): ${trimmed}`,
      );
      process.exit(2);
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key.length === 0) {
      console.error(
        `Error: Malformed line ${i + 1} in preset "${preset}" (empty key): ${trimmed}`,
      );
      process.exit(2);
    }

    map.set(key, value);
  }

  return map;
}

const [devOutput, prodOutput] = await Promise.all([
  materialize("dev"),
  materialize("prod"),
]);

const devMap = parseEnv(devOutput, "dev");
const prodMap = parseEnv(prodOutput, "prod");

const devOnly: string[] = [];
const prodOnly: string[] = [];
const differentValues: string[] = [];

for (const key of devMap.keys()) {
  if (!prodMap.has(key)) {
    devOnly.push(key);
  } else {
    const devVal = devMap.get(key);
    const prodVal = prodMap.get(key);
    if (devVal !== prodVal) {
      differentValues.push(key);
    }
  }
}

for (const key of prodMap.keys()) {
  if (!devMap.has(key)) {
    prodOnly.push(key);
  }
}

devOnly.sort();
prodOnly.sort();
differentValues.sort();

console.log("keys only in dev:");
if (devOnly.length === 0) {
  console.log("  (none)");
} else {
  for (const k of devOnly) {
    console.log(`  ${k}`);
  }
}

console.log("\nkeys only in prod:");
if (prodOnly.length === 0) {
  console.log("  (none)");
} else {
  for (const k of prodOnly) {
    console.log(`  ${k}`);
  }
}

console.log("\nkeys with different values:");
if (differentValues.length === 0) {
  console.log("  (none)");
} else {
  for (const k of differentValues) {
    console.log(`  ${k}`);
  }
}

if (
  devOnly.length === 0 &&
  prodOnly.length === 0 &&
  differentValues.length === 0
) {
  process.exit(0);
} else {
  process.exit(1);
}
