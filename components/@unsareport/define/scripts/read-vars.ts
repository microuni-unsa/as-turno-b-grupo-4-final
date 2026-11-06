export const METADATA_LABEL = "<var_export>";
export const METADATA_EVAL_EXPR = `query(${METADATA_LABEL}).map(it => it.value)`;

const TYPST_BINARY = "typst";
const EVAL_SUBCOMMAND = "eval";
const IN_FLAG = "--in";
const ROOT_FLAG = "--root";
const ARRAY_JOIN_SEPARATOR = ", ";

type QueryItem = {
  name?: unknown;
  value?: unknown;
};

export async function readVars(
  rootDir: string,
  entryFile: string,
): Promise<Record<string, string>> {
  if (Bun.which(TYPST_BINARY) === null) {
    throw new Error(`Could not find '${TYPST_BINARY}' executable on PATH`);
  }
  const proc = Bun.spawn(
    [
      TYPST_BINARY,
      EVAL_SUBCOMMAND,
      METADATA_EVAL_EXPR,
      IN_FLAG,
      entryFile,
      ROOT_FLAG,
      rootDir,
    ],
    { cwd: rootDir, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Typst eval failed (code ${code}): ${stderr.trim()}`);
  }
  const text = stdout.trim();
  if (text === "") {
    return {};
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from typst eval: ${err}\nOutput: ${text}`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected query output format: ${typeof data}`);
  }
  const metadata: Record<string, string> = {};
  for (const item of data as QueryItem[]) {
    if (item?.name == null || item?.value == null) {
      continue;
    }
    const value = item.value;
    metadata[String(item.name)] = Array.isArray(value)
      ? value.map((v) => String(v)).join(ARRAY_JOIN_SEPARATOR)
      : String(value);
  }
  return metadata;
}
