import { copyFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readVars } from "@unsareport/define/scripts/read-vars.ts";

const PACKAGE_NAME = "@unsareport/standard-report";
const CONFIG_FILENAME = "unsareport.toml";
const REPORT_DIR_ENV = "UNSAREP_REPORT_DIR";
const TYPST_ENTRY_ENV = "UNSAREP_TYPST_ENTRY";
const FORMAT_ENV = "UNSAREP_CONFIG_STANDARD_REPORT_FILENAME_FORMAT";
const TYPST_EXTENSION = ".typ";
const PDF_EXTENSION = ".pdf";
const TOKEN_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

function formatFilename(
  pattern: string,
  metadata: Record<string, string>,
): string {
  const formatted = pattern.replace(
    TOKEN_PATTERN,
    (_match, token: string) => {
      if (token in metadata) {
        return metadata[token];
      }
      throw new Error(
        `Required metadata variable '${token}' not found in document metadata. ` +
          `Available variables: ${JSON.stringify(Object.keys(metadata).sort())}`,
      );
    },
  );
  return formatted.endsWith(PDF_EXTENSION)
    ? formatted
    : `${formatted}${PDF_EXTENSION}`;
}

const rootDir = process.cwd();
if (!existsSync(join(rootDir, CONFIG_FILENAME))) {
  throw new Error(
    `Could not find '${CONFIG_FILENAME}' in current directory '${rootDir}' ` +
      "(unsarep build sets cwd to the project root)",
  );
}

const reportName = process.env[REPORT_DIR_ENV] ?? Bun.argv[2];
if (!reportName) {
  throw new Error(
    `Missing report dir: environment variable ${REPORT_DIR_ENV} is unset and no argument was provided`,
  );
}
const reportDir = join(rootDir, reportName);
if (!existsSync(reportDir) || !statSync(reportDir).isDirectory()) {
  throw new Error(`Report dir does not exist: ${reportDir}`);
}

const entryName = process.env[TYPST_ENTRY_ENV];
if (!entryName) {
  throw new Error(
    `Missing required environment variable: ${TYPST_ENTRY_ENV} is unset`,
  );
}
if (!entryName.endsWith(TYPST_EXTENSION)) {
  throw new Error(
    `Typst entry file '${entryName}' does not have '${TYPST_EXTENSION}' extension`,
  );
}

const entryFile = join(reportDir, entryName);
if (!existsSync(entryFile)) {
  throw new Error(`Typst entry file not found: '${entryFile}'`);
}

const compiledPdfName = `${entryName.slice(0, -TYPST_EXTENSION.length)}${PDF_EXTENSION}`;
const sourcePdf = join(reportDir, compiledPdfName);
if (!existsSync(sourcePdf)) {
  throw new Error(`Compiled PDF not found: expected '${sourcePdf}'`);
}

const pattern = process.env[FORMAT_ENV];
if (!pattern) {
  throw new Error(
    `Missing required config: ${FORMAT_ENV} is unset (install ${PACKAGE_NAME} with its required filename_format)`,
  );
}

const metadata = await readVars(rootDir, entryFile);
if (Object.keys(metadata).length === 0) {
  throw new Error(
    `No exported metadata variables (<var_export>) found in '${entryFile}'`,
  );
}

const targetPdf = join(reportDir, formatFilename(pattern, metadata));
copyFileSync(sourcePdf, targetPdf);
console.log(
  `[${PACKAGE_NAME}] Copied compiled report to: ${relative(rootDir, targetPdf)}`,
);
