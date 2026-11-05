import crypto from "node:crypto";
import type { AgentConfig } from "@pims/config";
import type { PimsAdapter, PimsRequestOverrides } from "@pims/pims-adapter";
import { CONSTANTS } from "@pims/types/constants.ts";
import { HistoryGapError, PimsNotFoundError } from "@pims/types/errors.ts";
import { type JsonObject, JsonObjectSchema } from "@pims/types/models.ts";
import type {
  PimsAsset,
  PimsIncident,
  PimsIncidentAction,
  PimsIncidentHistory,
} from "@pims/types/pims.ts";

const ALLOWED_LEDGER_KEYS: ReadonlySet<string> = new Set(
  CONSTANTS.AUDIT_TRAIL_ALLOWED_ARG_KEYS,
);

export function idempotencyKey(
  config: AgentConfig,
  incidentCode: string,
  operation: string,
): string {
  return `${config.IDEMPOTENCY_KEY_PREFIX}:${incidentCode}:${operation}:${crypto.randomUUID()}`;
}

export function redactArgs(args: JsonObject): JsonObject {
  const redacted: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (ALLOWED_LEDGER_KEYS.has(key)) {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function toJsonObject(value: object): JsonObject {
  return JsonObjectSchema.parse(JSON.parse(JSON.stringify(value)));
}

export function resolveIncidentCode(incident: PimsIncident): string {
  return incident.incident_code;
}

export function latestHistoryRow(
  history: PimsIncidentHistory[],
): PimsIncidentHistory | null {
  let latest: PimsIncidentHistory | null = null;
  for (const row of history) {
    if (latest === null) {
      latest = row;
      continue;
    }
    const rowAt = new Date(row.changed_at).getTime();
    const latestAt = new Date(latest.changed_at).getTime();
    if (rowAt > latestAt || (rowAt === latestAt && row.id > latest.id)) {
      latest = row;
    }
  }
  return latest;
}

export async function assertPostHistory(
  adapter: PimsAdapter,
  incidentId: number,
  eventType: string,
): Promise<PimsIncidentHistory> {
  const history = await adapter.getIncidentHistory(incidentId);
  const latest = latestHistoryRow(history);
  if (latest === null) {
    throw new HistoryGapError(
      `Expected newest history row of ${incidentId} to be '${eventType}', observed 'none'`,
    );
  }
  if (latest.event_type !== eventType) {
    throw new HistoryGapError(
      `Expected newest history row of ${incidentId} to be '${eventType}', observed '${latest.event_type}'`,
    );
  }
  return latest;
}

export async function appendActionWithReadModifyWrite(
  adapter: PimsAdapter,
  incidentId: number,
  action: PimsIncidentAction,
  overrides?: PimsRequestOverrides,
): Promise<PimsIncident> {
  return adapter.appendIncidentAction(incidentId, action, overrides);
}

function normalizeAssetToken(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return value.trim().toLowerCase();
}

export async function assetIdsForSystem(
  adapter: PimsAdapter,
  compromisedSystem: string | null | undefined,
): Promise<number[]> {
  const needle = normalizeAssetToken(compromisedSystem);
  if (needle.length === 0) {
    return [];
  }

  const page = await adapter.listAssets();
  const matches: number[] = [];
  for (const asset of page.results) {
    if (matchesAsset(asset, needle)) {
      matches.push(asset.id);
    }
  }
  return matches;
}

function matchesAsset(asset: PimsAsset, needle: string): boolean {
  const code = normalizeAssetToken(asset.code);
  const name = normalizeAssetToken(asset.name);
  const description = normalizeAssetToken(asset.description);
  if (code === needle || name === needle) {
    return true;
  }
  return (
    (code.length > 0 && needle.includes(code)) ||
    (name.length > 0 && needle.includes(name)) ||
    (description.length > 0 && description.includes(needle))
  );
}

export function catalogCodeExists(
  catalog: ReadonlyArray<{ code: string }>,
  code: string,
): boolean {
  return catalog.some((entry) => entry.code === code);
}

export function requireIncidentId(
  incidentId: number | null,
  tool: string,
): number {
  if (incidentId === null) {
    throw new PimsNotFoundError(tool, "incident_context");
  }
  return incidentId;
}
