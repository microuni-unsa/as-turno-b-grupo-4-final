import path from "node:path";
import {
  defineStack,
  type PortRange,
  type StackHandle,
} from "@microx-technologies/microcompose";
import { Wait } from "testcontainers";

export interface CreateStackOptions {
  projectRoot?: string;
  defaultRange?: PortRange;
  includePresidio?: boolean;
}

export const DEFAULT_STACK_PORT_RANGE: PortRange = [43000, 43999] as const;

export function createStack(options?: CreateStackOptions): StackHandle {
  const projectRoot = options?.projectRoot ?? process.cwd();
  const defaultRange = options?.defaultRange ?? DEFAULT_STACK_PORT_RANGE;
  const includePresidio = options?.includePresidio ?? true;

  const builder = defineStack()
    .defaultRange(defaultRange)
    .service("evidence_db", {
      image: "pgvector/pgvector:pg16",
      ports: [{ container: 5432 }],
      env: {
        POSTGRES_USER: "pims",
        POSTGRES_PASSWORD: "pims",
        POSTGRES_DB: "pims_evidence",
      },
      waitFor: Wait.forAll([Wait.forHealthCheck(), Wait.forListeningPorts()]),
    })
    .withHealthCheck({
      test: [
        "CMD-SHELL",
        "PGPASSWORD=pims pg_isready --host localhost --username pims --dbname pims_evidence",
      ],
      interval: 250,
      timeout: 1000,
      retries: 1000,
    })
    .withBindMounts([
      {
        source: path.resolve(projectRoot, "data/gestitel_base_de_datos.sql"),
        target: "/docker-entrypoint-initdb.d/01-gestitel.sql",
        mode: "ro",
      },
      {
        source: path.resolve(projectRoot, "data/02-init-unsa-seed.sql"),
        target: "/docker-entrypoint-initdb.d/02-seed.sql",
        mode: "ro",
      },
    ]);

  const envTemplates: Record<string, string> = {
    EVIDENCE_DB_URL:
      "postgres://pims:pims@{{host:evidence_db}}:{{port:evidence_db:5432}}/pims_evidence",
  };

  if (includePresidio) {
    builder.service("presidio", {
      image: "presidio-analyzer:2.2.x-es",
      ports: [{ container: 3000 }],
      env: {
        PORT: "3000",
      },
      waitFor: Wait.forHttp("/health", 3000).withStartupTimeout(120_000),
    });
    envTemplates.PRESIDIO_URL =
      "http://{{host:presidio}}:{{port:presidio:3000}}";
  } else {
    delete envTemplates.PRESIDIO_URL;
  }

  builder.env(envTemplates);

  return builder.build();
}

export const stack: StackHandle = createStack();
export default stack;
export type { PortRange, StackHandle };
