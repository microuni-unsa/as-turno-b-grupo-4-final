import type { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import type { AgentConfig } from "@pims/config";
import type { RAGService } from "@pims/rag/rag-service.ts";
import {
  type CounterfactualControl,
  type FaultTree,
  FaultTreeSchema,
  type Fishbone,
  FishboneSchema,
  type FiveWhys,
  FiveWhysSchema,
  type RiskCatalogCodes,
  RiskCatalogCodesSchema,
  type TotAnalysis,
  TotAnalysisSchema,
  type TotEvidence,
  type TotHypothesis,
  TotHypothesisSchema,
  TotMethodSchema,
} from "@pims/types/agent.ts";
import {
  MAX_CUT_SETS,
  MODEL_ROUTE_FAST,
  MODEL_ROUTE_REASONING,
} from "@pims/types/constants.ts";
import {
  ModelSchemaViolationError,
  PimsUnknownCodeError,
  RootCauseAmbiguousError,
  RootCauseUnprovenError,
} from "@pims/types/errors.ts";
import type { JsonObject } from "@pims/types/models.ts";
import type {
  PimsIncident,
  PimsIncidentAction,
  PimsIncidentHistory,
  PimsThreat,
  PimsVulnerability,
} from "@pims/types/pims.ts";
import { z } from "zod";

export const TOT_SYSTEM =
  "You run Tree-of-Thoughts neuro-symbolic root-cause analysis per §5.2 and §9.3. Expand TOT_BRANCH_FACTOR competing causal hypotheses, score each against the supplied evidence (attachments, history, IOCs, actions, citations) with prior and likelihood, and commit to the MAP hypothesis using: single causal chain → 5-whys (exactly five falsifiable levels, each {level, claim, evidence_ref|null}); multi-factor → fishbone (bones People, Process, Technology, Data, Suppliers, Environment, at least one cause per bone or an explicit bone_empty:<bone>:<reason> cause); system failure/availability → fault-tree (top_event names a gate, AND/OR gates resolve to basic events). Return only the requested JSON object. Never invent evidence references, control codes, citations, or PIMS codes.";

export const RISK_CATALOG_SYSTEM =
  "You map one root-cause statement to the live PIMS risk catalogs per §6.1.3. Match the threat and vulnerability that the cause exercises. Use ONLY codes present in the supplied threat/vulnerability arrays; when no listed code matches, return null for that field. Return only the requested JSON object.";

export interface TotAnalyzerDeps {
  modelClient: AgentModelClient;
  ragService: RAGService;
  config: AgentConfig;
}

const CounterfactualMappingSchema = z
  .object({
    control_code: z.string().min(1),
    basic_event_ids: z.array(z.string().min(1)),
    rationale: z.string().min(1),
  })
  .strict();

const TotModelOutputSchema = z
  .object({
    method: TotMethodSchema,
    hypotheses: z.array(TotHypothesisSchema),
    five_whys: FiveWhysSchema.nullable(),
    fishbone: FishboneSchema.nullable(),
    fault_tree: FaultTreeSchema.nullable(),
    systemic: z.boolean(),
    remediation: z.string().min(1),
    counterfactual_mapping: z.array(CounterfactualMappingSchema),
    citations: z.array(z.string().min(1)),
  })
  .strict();

type TotModelOutput = z.infer<typeof TotModelOutputSchema>;

const FISHBONE_BONE_NAMES = [
  "People",
  "Process",
  "Technology",
  "Data",
  "Suppliers",
  "Environment",
] as const;

const TOT_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "method",
    "hypotheses",
    "five_whys",
    "fishbone",
    "fault_tree",
    "systemic",
    "remediation",
    "counterfactual_mapping",
    "citations",
  ],
  properties: {
    method: { type: "string", enum: ["5-whys", "fishbone", "fault-tree"] },
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "claim",
          "prior",
          "likelihood",
          "evidence_refs",
          "ioc_refs",
          "causes",
        ],
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          prior: { type: "number", minimum: 0, maximum: 1 },
          likelihood: { type: "number", minimum: 0, maximum: 1 },
          evidence_refs: { type: "array", items: { type: "string" } },
          ioc_refs: { type: "array", items: { type: "string" } },
          causes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["cause", "control_codes"],
              properties: {
                cause: { type: "string" },
                control_codes: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
    five_whys: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["levels"],
          properties: {
            levels: {
              type: "array",
              minItems: 5,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["level", "claim", "evidence_ref"],
                properties: {
                  level: { type: "integer", minimum: 1, maximum: 5 },
                  claim: { type: "string" },
                  evidence_ref: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      ],
    },
    fishbone: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["bones"],
          properties: {
            bones: {
              type: "object",
              additionalProperties: false,
              required: [...FISHBONE_BONE_NAMES],
              properties: Object.fromEntries(
                FISHBONE_BONE_NAMES.map((bone): [string, JsonObject] => [
                  bone,
                  {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["cause", "evidence_ref", "control_codes"],
                      properties: {
                        cause: { type: "string" },
                        evidence_ref: { type: ["string", "null"] },
                        control_codes: {
                          type: "array",
                          items: { type: "string" },
                        },
                      },
                    },
                  },
                ]),
              ),
            },
          },
        },
      ],
    },
    fault_tree: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["top_event", "gates", "basic_events"],
          properties: {
            top_event: { type: "string" },
            gates: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["gate_id", "op", "inputs"],
                properties: {
                  gate_id: { type: "string" },
                  op: { type: "string", enum: ["AND", "OR"] },
                  inputs: { type: "array", items: { type: "string" } },
                },
              },
            },
            basic_events: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "event_id",
                  "description",
                  "evidence_ref",
                  "control_codes",
                ],
                properties: {
                  event_id: { type: "string" },
                  description: { type: "string" },
                  evidence_ref: { type: ["string", "null"] },
                  control_codes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      ],
    },
    systemic: { type: "boolean" },
    remediation: { type: "string" },
    counterfactual_mapping: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["control_code", "basic_event_ids", "rationale"],
        properties: {
          control_code: { type: "string" },
          basic_event_ids: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
      },
    },
    citations: { type: "array", items: { type: "string" } },
  },
};

const RISK_CATALOG_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["threat_code", "vulnerability_code"],
  properties: {
    threat_code: { type: ["string", "null"] },
    vulnerability_code: { type: ["string", "null"] },
  },
};

function buildAnalysisPrompt(input: TotAnalyzeInput): JsonObject {
  const incident = input.incident;
  return {
    incident_code: incident.incident_code,
    incident_type: incident.incident_type,
    severity: incident.severity ?? null,
    impact: incident.impact ?? null,
    title: incident.title,
    description: incident.description ?? null,
    affected_data_types: [...incident.affected_data_types],
    compromised_system: incident.compromised_system ?? null,
    adopted_measures: [...input.adoptedMeasures],
    annex_a_controls: input.annexAControls.map((control) => ({
      code: control.code,
      name: control.name,
    })),
    history: input.history.map((row) => ({
      event_type: row.event_type ?? null,
      description: row.description ?? null,
      changed_at: row.changed_at,
    })),
    actions: input.actions.map((action) => ({
      action_type: action.action_type,
      description: action.description,
    })),
    evidence: input.evidence.map((item) => ({
      ref: item.ref,
      kind: item.kind,
      description: item.description,
    })),
    rag_citations: [...input.ragCitations],
  };
}

export interface TotAnalyzeInput {
  incident: PimsIncident;
  history: PimsIncidentHistory[];
  actions: PimsIncidentAction[];
  evidence: TotEvidence[];
  adoptedMeasures: string[];
  annexAControls: Array<{ code: string; name: string }>;
  ragCitations: string[];
}

interface ScoredHypothesis {
  hypothesis: TotHypothesis;
  posterior: number;
}

export class TotAnalyzer {
  private readonly modelClient: AgentModelClient;
  private readonly ragService: RAGService;
  private readonly config: AgentConfig;

  constructor(deps: TotAnalyzerDeps) {
    this.modelClient = deps.modelClient;
    this.ragService = deps.ragService;
    this.config = deps.config;
  }

  async analyze(input: TotAnalyzeInput): Promise<TotAnalysis> {
    const response = await this.modelClient.chat_json({
      system: TOT_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify(buildAnalysisPrompt(input)),
        },
      ],
      json_schema: TOT_JSON_SCHEMA,
      max_tokens: 3000,
      temperature: this.config.TEMP_REASONING,
      route: MODEL_ROUTE_REASONING,
    });

    const parsed = TotModelOutputSchema.safeParse(response.content);
    if (!parsed.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Root-cause analysis returned invalid shape: ${parsed.error.message}`,
      );
    }
    const output = parsed.data;

    for (const citation of output.citations) {
      this.ragService.validateCitation(citation, true);
    }

    const scored = this.scoreHypotheses(output.hypotheses);
    const selected = this.selectMapHypothesis(scored);
    const rootCauseUnproven = this.validateMethod(output);
    const cutSets = this.buildCutSets(output, selected.hypothesis);
    const counterfactuals = this.buildCounterfactuals(
      output,
      cutSets,
      selected.hypothesis,
      selected.posterior,
      input,
    );

    return TotAnalysisSchema.parse({
      method: output.method,
      hypotheses: output.hypotheses,
      posteriors: scored.map((entry) => ({
        hypothesis_id: entry.hypothesis.id,
        posterior: entry.posterior,
      })),
      selected_hypothesis_id: selected.hypothesis.id,
      tot_posterior: selected.posterior,
      five_whys: output.five_whys,
      fishbone: output.fishbone,
      fault_tree: output.fault_tree,
      systemic: output.systemic,
      remediation: output.remediation,
      counterfactuals,
      root_cause_unproven: rootCauseUnproven,
    });
  }

  async selectRiskCatalogCodes(input: {
    cause: string;
    threats: PimsThreat[];
    vulnerabilities: PimsVulnerability[];
  }): Promise<RiskCatalogCodes> {
    const response = await this.modelClient.chat_json({
      system: RISK_CATALOG_SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            cause: input.cause,
            threats: input.threats.map((threat) => ({
              code: threat.code,
              label: threat.label,
              category: threat.category,
            })),
            vulnerabilities: input.vulnerabilities.map((vulnerability) => ({
              code: vulnerability.code,
              label: vulnerability.label,
              category: vulnerability.category,
            })),
          }),
        },
      ],
      json_schema: RISK_CATALOG_JSON_SCHEMA,
      max_tokens: 500,
      temperature: this.config.TEMP_CLASSIFIER,
      route: MODEL_ROUTE_FAST,
    });

    const parsed = RiskCatalogCodesSchema.safeParse(response.content);
    if (!parsed.success) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_FAST,
        `Risk catalog selection returned invalid shape: ${parsed.error.message}`,
      );
    }
    const codes = parsed.data;
    const threatCode = codes.threat_code;
    const vulnerabilityCode = codes.vulnerability_code;

    if (
      threatCode !== null &&
      !input.threats.some((threat) => threat.code === threatCode)
    ) {
      throw new PimsUnknownCodeError("threat_code", threatCode);
    }
    if (
      vulnerabilityCode !== null &&
      !input.vulnerabilities.some(
        (vulnerability) => vulnerability.code === vulnerabilityCode,
      )
    ) {
      throw new PimsUnknownCodeError("vulnerability_code", vulnerabilityCode);
    }

    return codes;
  }

  private scoreHypotheses(hypotheses: TotHypothesis[]): ScoredHypothesis[] {
    if (hypotheses.length !== this.config.TOT_BRANCH_FACTOR) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Expected ${this.config.TOT_BRANCH_FACTOR} hypotheses, received ${hypotheses.length}`,
      );
    }

    const raw = hypotheses.map((hypothesis) => ({
      hypothesis,
      weight: hypothesis.prior * hypothesis.likelihood,
    }));
    const sum = raw.reduce((acc, entry) => acc + entry.weight, 0);
    if (sum === 0 || !Number.isFinite(sum)) {
      throw new RootCauseUnprovenError(
        "All Tree-of-Thoughts hypotheses scored zero posterior weight; root cause is unproven",
      );
    }

    return raw.map((entry) => ({
      hypothesis: entry.hypothesis,
      posterior: Math.min(1, entry.weight / sum),
    }));
  }

  private selectMapHypothesis(scored: ScoredHypothesis[]): ScoredHypothesis {
    const ordered = [...scored].sort(
      (left, right) => right.posterior - left.posterior,
    );
    const top = ordered[0];
    if (top === undefined) {
      throw new RootCauseUnprovenError(
        "No Tree-of-Thoughts hypothesis was produced",
      );
    }
    const second = ordered[1];
    if (second !== undefined && top.posterior - second.posterior < 1e-9) {
      throw new RootCauseAmbiguousError(
        `Top hypotheses '${top.hypothesis.id}' and '${second.hypothesis.id}' are indistinguishable at 1e-9`,
      );
    }
    return top;
  }

  private validateMethod(output: TotModelOutput): boolean {
    switch (output.method) {
      case "5-whys":
        return this.validateFiveWhys(output.five_whys);
      case "fishbone":
        this.validateFishbone(output.fishbone);
        return false;
      case "fault-tree":
        this.validateFaultTree(output.fault_tree);
        return false;
      default: {
        const exhaustive: never = output.method;
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Unsupported root-cause method: ${String(exhaustive)}`,
        );
      }
    }
  }

  private validateFiveWhys(fiveWhys: FiveWhys | null): boolean {
    if (fiveWhys === null) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        "Method '5-whys' requires a five_whys analysis",
      );
    }
    if (fiveWhys.levels.length !== 5) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `5-whys requires exactly 5 levels, received ${fiveWhys.levels.length}`,
      );
    }
    fiveWhys.levels.forEach((level, index) => {
      if (level.level !== index + 1) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `5-whys level ${index + 1} is labeled ${level.level}`,
        );
      }
    });
    const last = fiveWhys.levels[4];
    return last.evidence_ref === null;
  }

  private validateFishbone(fishbone: Fishbone | null): void {
    if (fishbone === null) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        "Method 'fishbone' requires a fishbone analysis",
      );
    }
    for (const bone of FISHBONE_BONE_NAMES) {
      const causes = fishbone.bones[bone];
      const hasExplicitEmpty = causes.some((cause) =>
        cause.cause.includes(`bone_empty:${bone}:`),
      );
      if (causes.length === 0 && !hasExplicitEmpty) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Fishbone bone '${bone}' has no cause and no bone_empty marker`,
        );
      }
    }
  }

  private validateFaultTree(faultTree: FaultTree | null): void {
    if (faultTree === null) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        "Method 'fault-tree' requires a fault_tree analysis",
      );
    }

    const gateById = new Map(
      faultTree.gates.map((gate) => [gate.gate_id, gate] as const),
    );
    if (gateById.size !== faultTree.gates.length) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        "Fault-tree gate ids are not unique",
      );
    }
    const eventIds = new Set(
      faultTree.basic_events.map((event) => event.event_id),
    );
    if (eventIds.size !== faultTree.basic_events.length) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        "Fault-tree basic event ids are not unique",
      );
    }
    for (const eventId of eventIds) {
      if (gateById.has(eventId)) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Fault-tree id '${eventId}' is both a gate and a basic event`,
        );
      }
    }
    if (!gateById.has(faultTree.top_event)) {
      throw new ModelSchemaViolationError(
        MODEL_ROUTE_REASONING,
        `Fault-tree top_event '${faultTree.top_event}' is not a gate id`,
      );
    }
    for (const gate of faultTree.gates) {
      for (const child of gate.inputs) {
        if (!gateById.has(child) && !eventIds.has(child)) {
          throw new ModelSchemaViolationError(
            MODEL_ROUTE_REASONING,
            `Fault-tree gate '${gate.gate_id}' references unknown input '${child}'`,
          );
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (gateId: string): void => {
      if (visited.has(gateId)) {
        return;
      }
      if (visiting.has(gateId)) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Fault-tree contains a cycle through gate '${gateId}'`,
        );
      }
      visiting.add(gateId);
      const gate = gateById.get(gateId);
      if (gate === undefined) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Fault-tree gate '${gateId}' is missing`,
        );
      }
      for (const child of gate.inputs) {
        if (gateById.has(child)) {
          visit(child);
        }
      }
      visiting.delete(gateId);
      visited.add(gateId);
    };
    visit(faultTree.top_event);
  }

  private buildCutSets(
    output: TotModelOutput,
    mapHypothesis: TotHypothesis,
  ): string[][] {
    if (output.method === "fault-tree") {
      const faultTree = output.fault_tree;
      if (faultTree === null) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          "Fault-tree cut sets require fault_tree analysis",
        );
      }
      return minimalCutSets(faultTree);
    }

    const causeSet = [
      ...new Set(mapHypothesis.causes.map((cause) => cause.cause)),
    ].sort();
    return [causeSet];
  }

  private buildCounterfactuals(
    output: TotModelOutput,
    cutSets: string[][],
    mapHypothesis: TotHypothesis,
    totPosterior: number,
    input: TotAnalyzeInput,
  ): CounterfactualControl[] {
    const knownControls = new Set<string>(input.adoptedMeasures);
    for (const control of input.annexAControls) {
      knownControls.add(control.code);
    }

    const allowedIds =
      output.method === "fault-tree"
        ? new Set(
            (output.fault_tree?.basic_events ?? []).map(
              (event) => event.event_id,
            ),
          )
        : new Set(mapHypothesis.causes.map((cause) => cause.cause));

    const totalEvents = new Set(cutSets.flat()).size;

    const counterfactuals = output.counterfactual_mapping.map((mapping) => {
      if (!knownControls.has(mapping.control_code)) {
        throw new ModelSchemaViolationError(
          MODEL_ROUTE_REASONING,
          `Counterfactual control code '${mapping.control_code}' is neither adopted nor an Annex A control`,
        );
      }
      for (const id of mapping.basic_event_ids) {
        if (!allowedIds.has(id)) {
          throw new ModelSchemaViolationError(
            MODEL_ROUTE_REASONING,
            `Counterfactual id '${id}' is not part of the selected ${output.method} structure`,
          );
        }
      }

      const blocked = [...new Set(mapping.basic_event_ids)];
      const blocksCutSet = cutSets.every((cutSet) =>
        cutSet.some((id) => blocked.includes(id)),
      );
      const blockedEvents = blocked.filter((id) =>
        cutSets.some((cutSet) => cutSet.includes(id)),
      ).length;
      const residualProbabilityDelta =
        totalEvents === 0
          ? 0
          : Number((-totPosterior * (blockedEvents / totalEvents)).toFixed(6));

      return {
        control_code: mapping.control_code,
        blocks_cut_set: blocksCutSet,
        residual_probability_delta: residualProbabilityDelta,
        proof_rationale: mapping.rationale,
      };
    });

    return counterfactuals.sort((left, right) =>
      left.control_code < right.control_code
        ? -1
        : left.control_code > right.control_code
          ? 1
          : 0,
    );
  }
}

function minimalCutSets(faultTree: FaultTree): string[][] {
  const gateById = new Map(
    faultTree.gates.map((gate) => [gate.gate_id, gate] as const),
  );

  const expand = (id: string): string[][] => {
    const gate = gateById.get(id);
    if (gate === undefined) {
      return [[id]];
    }
    const childSets = gate.inputs.map((child) => expand(child));
    if (gate.op === "OR") {
      const union = childSets.flat();
      if (union.length > MAX_CUT_SETS) {
        throw new RootCauseAmbiguousError(
          `Fault-tree cut sets exceed ${MAX_CUT_SETS} entries`,
        );
      }
      return union;
    }

    let product: string[][] = [[]];
    for (const sets of childSets) {
      const next: string[][] = [];
      for (const base of product) {
        for (const set of sets) {
          next.push([...base, ...set]);
          if (next.length > MAX_CUT_SETS) {
            throw new RootCauseAmbiguousError(
              `Fault-tree cut sets exceed ${MAX_CUT_SETS} entries`,
            );
          }
        }
      }
      product = next;
    }
    return product;
  };

  const raw = expand(faultTree.top_event);
  const unique = new Map<string, string[]>();
  for (const set of raw) {
    const normalized = [...new Set(set)].sort();
    unique.set(normalized.join("\u0000"), normalized);
  }
  const candidates = [...unique.values()];

  const minimal = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          other.length < candidate.length &&
          other.every((id) => candidate.includes(id)),
      ),
  );

  return minimal.sort((left, right) => {
    const leftKey = left.join("\u0000");
    const rightKey = right.join("\u0000");
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
