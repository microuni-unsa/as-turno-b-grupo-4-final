import { assertAttachmentMeta } from "@pims/types/attachments.ts";
import {
  DEFAULT_IDEMPOTENCY_KEY_PREFIX,
  DEFAULT_PIMS_MAX_RETRIES,
  DEFAULT_PIMS_TIMEOUT_MS,
  DEFAULT_RETRY_BACKOFF_MS,
  MAX_ATTACHMENT_SIZE_MB,
} from "@pims/types/constants.ts";
import {
  NotifyNoRecipientsError,
  PimsAuthFailedError,
  PimsBaseError,
  PimsClientBugError,
  PimsConflictCodeError,
  PimsErrorShapeUnknownError,
  PimsGateBlockedError,
  PimsNotFoundError,
  PimsPermissionDeniedError,
  PimsThrottledError,
  PimsUnavailableError,
  PimsValidationError,
  RestoreFailedError,
} from "@pims/types/errors.ts";
import type {
  LoginResponse,
  PaginatedResult,
  PimsAnnexAMetaResponse,
  PimsAsset,
  PimsAudit,
  PimsAuditCreate,
  PimsAuditUpdate,
  PimsDashboardResponse,
  PimsIncident,
  PimsIncidentAction,
  PimsIncidentAttachment,
  PimsIncidentCreate,
  PimsIncidentHistory,
  PimsIncidentRecipient,
  PimsIncidentRecipientCreate,
  PimsIncidentUpdate,
  PimsMutationRecord,
  PimsRiskCatalogResponse,
  PimsRiskEvaluation,
  PimsRiskEvaluationCreate,
  UserProfile,
} from "@pims/types/pims.ts";
import {
  AnnexAControlsMetaSchema,
  DashboardKpisSchema,
  LoginResponseSchema,
  PimsAssetSchema,
  PimsAuditSchema,
  PimsIncidentAttachmentSchema,
  PimsIncidentHistorySchema,
  PimsIncidentRecipientSchema,
  PimsIncidentSchema,
  PimsRiskCatalogSchema,
  PimsRiskEvaluationSchema,
  paginatedResultSchema,
  TenantInfoSchema,
  TokenRefreshResponseSchema,
  UserProfileSchema,
} from "@pims/types/pims.ts";

export interface PimsAdapterConfig {
  baseUrl: string;
  schema: string;
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKeyPrefix?: string;
  username?: string;
  password?: string;
  extraHeaders?: Record<string, string>;
  cookies?: Record<string, string>;
  onMutation?: (record: PimsMutationRecord) => void;
}

export interface PimsRequestOverrides {
  incidentCode?: string | null;
  idempotencyKey?: string;
}

export class PimsAdapter {
  readonly baseUrl: string;
  readonly schema: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly idempotencyKeyPrefix: string;
  readonly extraHeaders?: Record<string, string>;
  readonly cookies?: Record<string, string>;
  private readonly onMutation?: (record: PimsMutationRecord) => void;
  private username?: string;
  private password?: string;

  accessToken: string | null = null;
  refreshTokenVal: string | null = null;
  nestedActionMode: "replace" | "merge" = "replace";
  nestedAuditMode: "replace" | "merge" = "replace";

  constructor(config: PimsAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.schema = config.schema;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_PIMS_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_PIMS_MAX_RETRIES;
    this.idempotencyKeyPrefix =
      config.idempotencyKeyPrefix ?? DEFAULT_IDEMPOTENCY_KEY_PREFIX;
    this.extraHeaders = config.extraHeaders;
    this.cookies = config.cookies;
    this.onMutation = config.onMutation;
    this.username = config.username;
    this.password = config.password;
  }

  setCredentials(username: string, password: string): void {
    this.username = username;
    this.password = password;
  }

  setTokens(access: string, refresh?: string): void {
    this.accessToken = access;
    if (refresh !== undefined) {
      this.refreshTokenVal = refresh;
    }
  }

  async login(username?: string, password?: string): Promise<LoginResponse> {
    const user = username ?? this.username;
    const pass = password ?? this.password;
    if (!user || !pass) {
      throw new PimsAuthFailedError("No credentials available for PIMS login");
    }

    const payload = { username: user, password: pass };
    const raw = await this.request<unknown>("POST", "/business/login/", {
      body: payload,
      isPublic: true,
      operation: "login",
    });

    const parsed = LoginResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid login response format from PIMS",
        JSON.stringify(raw),
      );
    }

    this.accessToken = parsed.data.access;
    this.refreshTokenVal = parsed.data.refresh;
    return parsed.data;
  }

  async refreshToken(refreshTokenToUse?: string): Promise<string> {
    const token = refreshTokenToUse ?? this.refreshTokenVal;
    if (!token) {
      throw new PimsAuthFailedError(
        "No refresh token available to rotate access token",
      );
    }

    const raw = await this.request<unknown>(
      "POST",
      "/business/token/refresh/",
      {
        body: { refresh: token },
        isPublic: true,
        operation: "refresh_token",
      },
    );

    const parsed = TokenRefreshResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid token refresh response from PIMS",
        JSON.stringify(raw),
      );
    }

    this.accessToken = parsed.data.access;
    return parsed.data.access;
  }

  async getTenantInfo(): Promise<{ name: string; schema_name?: string }> {
    const raw = await this.request<unknown>("GET", "/business/info/", {
      operation: "tenant_info",
    });
    const parsed = TenantInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid tenant info format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getProfile(): Promise<UserProfile> {
    const raw = await this.request<unknown>("GET", "/business/profile/", {
      operation: "profile",
    });
    const parsed = UserProfileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid user profile format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async listIncidents(params?: {
    search?: string;
    status?: string;
    severity?: string;
    incident_type?: string;
    page?: number;
    page_size?: number;
  }): Promise<PaginatedResult<PimsIncident>> {
    const query = new URLSearchParams();
    if (params?.search) query.set("search", params.search);
    if (params?.status) query.set("status", params.status);
    if (params?.severity) query.set("severity", params.severity);
    if (params?.incident_type) query.set("incident_type", params.incident_type);
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));

    const path = `/api/incidents/${query.toString() ? `?${query.toString()}` : ""}`;
    const raw = await this.request<unknown>("GET", path, {
      operation: "list_incidents",
    });
    const schema = paginatedResultSchema(PimsIncidentSchema);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid incident list response from PIMS",
        JSON.stringify(raw),
      );
    }

    let results = parsed.data.results;

    if (params?.severity) {
      const ignored = results.some((i) => i.severity !== params.severity);
      if (ignored) {
        console.warn("PIMS_FILTER_IGNORED:severity");
        results = results.filter((i) => i.severity === params.severity);
      }
    }

    if (params?.incident_type) {
      const ignored = results.some(
        (i) => i.incident_type !== params.incident_type,
      );
      if (ignored) {
        console.warn("PIMS_FILTER_IGNORED:incident_type");
        results = results.filter(
          (i) => i.incident_type === params.incident_type,
        );
      }
    }

    return {
      ...parsed.data,
      count: results.length,
      results,
    };
  }

  async createIncident(
    data: PimsIncidentCreate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncident> {
    const raw = await this.request<unknown>("POST", "/api/incidents/", {
      body: data,
      operation: "create_incident",
      incidentCode: overrides?.incidentCode ?? data.incident_code,
      idempotencyKey: overrides?.idempotencyKey,
    });
    const parsed = PimsIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid incident response on create from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getIncident(id: number): Promise<PimsIncident> {
    const raw = await this.request<unknown>("GET", `/api/incidents/${id}/`, {
      operation: "get_incident",
    });
    const parsed = PimsIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid incident format for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async updateIncident(
    id: number,
    data: PimsIncidentUpdate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncident> {
    const raw = await this.request<unknown>("PATCH", `/api/incidents/${id}/`, {
      body: data,
      operation: "update_incident",
      incidentCode: overrides?.incidentCode ?? data.incident_code,
      idempotencyKey: overrides?.idempotencyKey,
    });
    const parsed = PimsIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid incident format on update for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async deleteIncident(
    id: number,
    overrides?: PimsRequestOverrides,
  ): Promise<void> {
    await this.request<void>("DELETE", `/api/incidents/${id}/`, {
      operation: "delete_incident",
      incidentCode: overrides?.incidentCode,
      idempotencyKey: overrides?.idempotencyKey,
    });
  }

  async appendIncidentAction(
    id: number,
    action: PimsIncidentAction,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncident> {
    const appended: PimsIncidentAction = {
      action_type: action.action_type,
      responsible: action.responsible,
      action_date: action.action_date,
      description: action.description,
      evidence: action.evidence ?? null,
    };

    if (this.nestedActionMode === "merge") {
      return this.updateIncident(id, { actions: [appended] }, overrides);
    }

    const before = await this.getIncident(id);
    const after = await this.getIncident(id);

    let base = after;
    if (after.updated_at !== before.updated_at) {
      const fresh = await this.getIncident(id);
      if (fresh.updated_at !== after.updated_at) {
        throw new PimsConflictCodeError("READ_MODIFY_WRITE_CONFLICT");
      }
      base = fresh;
    }

    const nextActions: PimsIncidentAction[] = [
      ...(base.actions ?? []),
      appended,
    ];

    return this.updateIncident(id, { actions: nextActions }, overrides);
  }

  async restoreIncident(
    id: number,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncident> {
    try {
      await this.request<unknown>("PATCH", `/api/incidents/${id}/`, {
        body: { is_deleted: false, deleted_at: null },
        operation: "restore_incident",
        incidentCode: overrides?.incidentCode,
        idempotencyKey: overrides?.idempotencyKey,
      });
    } catch (error: unknown) {
      if (error instanceof PimsNotFoundError) {
        console.warn(`RESTORE:${String(id)}:rejected`);
        throw new RestoreFailedError(String(id));
      }
      throw error;
    }

    const restored = await this.getIncident(id);
    const accepted = restored.is_deleted === false;
    console.info(
      `RESTORE:${restored.incident_code}:${accepted ? "ok" : "rejected"}`,
    );
    if (!accepted) {
      throw new RestoreFailedError(restored.incident_code);
    }
    return restored;
  }

  async downloadAttachment(
    fileUrl: string,
    overrides?: PimsRequestOverrides,
  ): Promise<Buffer> {
    const url = fileUrl.startsWith("http")
      ? fileUrl
      : `${this.baseUrl}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
    const startedAt = Date.now();
    const observedAtUtc = new Date().toISOString();
    const idempotencyKey =
      overrides?.idempotencyKey ??
      `${this.idempotencyKeyPrefix}:${overrides?.incidentCode ?? "global"}:download_attachment:${crypto.randomUUID()}`;
    let status = 0;
    let observed = false;
    const observe = (errorCode: string | null): void => {
      if (observed) {
        return;
      }
      observed = true;
      this.onMutation?.({
        at_utc: observedAtUtc,
        method: "GET",
        endpoint:
          (fileUrl.startsWith("http")
            ? new URL(fileUrl).pathname
            : fileUrl.split("?")[0]) ?? fileUrl,
        operation: "download_attachment",
        incident_code: overrides?.incidentCode ?? null,
        idempotency_key: idempotencyKey,
        duration_ms: Date.now() - startedAt,
        status,
        attempt: 1,
        payload_keys: [],
        error_code: errorCode,
      });
    };

    try {
      if (!this.accessToken) {
        await this.obtainToken();
      }

      const headers: Record<string, string> = {
        Accept: "*/*",
        "X-PIMS-Schema": this.schema,
        "Idempotency-Key": idempotencyKey,
      };
      if (this.accessToken) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(url, { method: "GET", headers });
      status = response.status;
      if (response.status === 404) {
        throw new PimsNotFoundError("Attachment", fileUrl);
      }
      if (response.status >= 500) {
        throw new PimsUnavailableError(
          `PIMS attachment download failed with HTTP ${response.status}`,
        );
      }
      if (!response.ok) {
        throw new PimsErrorShapeUnknownError(
          `Unexpected HTTP status ${response.status} downloading attachment`,
          await response.text().catch(() => ""),
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      observe(null);
      return bytes;
    } catch (error: unknown) {
      observe(errorCodeOf(error));
      throw error;
    }
  }

  async getIncidentHistory(id: number): Promise<PimsIncidentHistory[]> {
    const raw = await this.request<unknown>(
      "GET",
      `/api/incidents/${id}/history/`,
      {
        operation: "get_incident_history",
      },
    );
    const schema = PimsIncidentHistorySchema.array();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid incident history format for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getIncidentAttachments(id: number): Promise<PimsIncidentAttachment[]> {
    const raw = await this.request<unknown>(
      "GET",
      `/api/incidents/${id}/attachments/`,
      {
        operation: "get_incident_attachments",
      },
    );
    const schema = PimsIncidentAttachmentSchema.array();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid attachments response for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async uploadIncidentAttachment(
    id: number,
    file: Blob | Buffer | Uint8Array,
    fileName: string,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncidentAttachment[]> {
    const byteLength = file instanceof Blob ? file.size : file.byteLength;
    assertAttachmentMeta(fileName, byteLength, MAX_ATTACHMENT_SIZE_MB);

    const formData = new FormData();
    const blob =
      file instanceof Blob ? file : new Blob([Buffer.from(file as Uint8Array)]);
    formData.append("file", blob, fileName);

    const raw = await this.request<unknown>(
      "POST",
      `/api/incidents/${id}/attachments/`,
      {
        formData,
        operation: "upload_attachment",
        incidentCode: overrides?.incidentCode,
        idempotencyKey: overrides?.idempotencyKey,
      },
    );
    const schema = PimsIncidentAttachmentSchema.array();
    const parsedArray = schema.safeParse(raw);
    if (parsedArray.success) {
      return parsedArray.data;
    }
    const parsedSingle = PimsIncidentAttachmentSchema.safeParse(raw);
    if (parsedSingle.success) {
      return [parsedSingle.data];
    }
    throw new PimsErrorShapeUnknownError(
      `Invalid upload attachment response for id ${id}`,
      JSON.stringify(raw),
    );
  }

  async notifyIncident(
    id: number,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncident> {
    const raw = await this.request<unknown>(
      "POST",
      `/api/incidents/${id}/notify/`,
      {
        body: {},
        operation: "notify_incident",
        incidentCode: overrides?.incidentCode,
        idempotencyKey: overrides?.idempotencyKey,
      },
    );
    const parsed = PimsIncidentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid notify response format for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async listRecipients(): Promise<PaginatedResult<PimsIncidentRecipient>> {
    const raw = await this.request<unknown>(
      "GET",
      "/api/incident-recipients/",
      {
        operation: "list_recipients",
      },
    );
    const schema = paginatedResultSchema(PimsIncidentRecipientSchema);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid incident recipient list from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async createRecipient(
    data: PimsIncidentRecipientCreate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsIncidentRecipient> {
    const raw = await this.request<unknown>(
      "POST",
      "/api/incident-recipients/",
      {
        body: data,
        operation: "create_recipient",
        incidentCode: overrides?.incidentCode,
        idempotencyKey: overrides?.idempotencyKey,
      },
    );
    const parsed = PimsIncidentRecipientSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid create recipient response from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async deleteRecipient(
    id: number,
    overrides?: PimsRequestOverrides,
  ): Promise<void> {
    await this.request<void>("DELETE", `/api/incident-recipients/${id}/`, {
      operation: "delete_recipient",
      incidentCode: overrides?.incidentCode,
      idempotencyKey: overrides?.idempotencyKey,
    });
  }

  async listAudits(params?: {
    status?: string;
  }): Promise<PaginatedResult<PimsAudit>> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const path = `/api/audits/${query.toString() ? `?${query.toString()}` : ""}`;
    const raw = await this.request<unknown>("GET", path, {
      operation: "list_audits",
    });
    const schema = paginatedResultSchema(PimsAuditSchema);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid audit list format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async createAudit(
    data: PimsAuditCreate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsAudit> {
    const raw = await this.request<unknown>("POST", "/api/audits/", {
      body: data,
      operation: "create_audit",
      incidentCode: overrides?.incidentCode,
      idempotencyKey: overrides?.idempotencyKey,
    });
    const parsed = PimsAuditSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid audit response on create from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async updateAudit(
    id: number,
    data: PimsAuditUpdate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsAudit> {
    const raw = await this.request<unknown>("PATCH", `/api/audits/${id}/`, {
      body: data,
      operation: "update_audit",
      incidentCode: overrides?.incidentCode,
      idempotencyKey: overrides?.idempotencyKey,
    });
    const parsed = PimsAuditSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        `Invalid audit response on update for id ${id}`,
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async listRiskEvaluations(): Promise<PaginatedResult<PimsRiskEvaluation>> {
    const raw = await this.request<unknown>("GET", "/api/risk-evaluations/", {
      operation: "list_risk_evaluations",
    });
    const schema = paginatedResultSchema(PimsRiskEvaluationSchema);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid risk evaluations list from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async createRiskEvaluation(
    data: PimsRiskEvaluationCreate,
    overrides?: PimsRequestOverrides,
  ): Promise<PimsRiskEvaluation> {
    const raw = await this.request<unknown>("POST", "/api/risk-evaluations/", {
      body: data,
      operation: "create_risk_evaluation",
      incidentCode: overrides?.incidentCode,
      idempotencyKey: overrides?.idempotencyKey,
    });
    const parsed = PimsRiskEvaluationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid risk evaluation response from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getRiskCatalogs(): Promise<PimsRiskCatalogResponse> {
    const raw = await this.request<unknown>(
      "GET",
      "/api/risk-evaluations/catalogs/",
      {
        operation: "get_risk_catalogs",
      },
    );
    const parsed = PimsRiskCatalogSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid risk catalogs format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getEligibleAssets(): Promise<PaginatedResult<Partial<PimsAsset>>> {
    const raw = await this.request<unknown>(
      "GET",
      "/api/risk-evaluations/eligible-assets/",
      {
        operation: "get_eligible_assets",
      },
    );
    const schema = paginatedResultSchema(PimsAssetSchema.partial());
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid eligible assets response from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async listAssets(): Promise<PaginatedResult<PimsAsset>> {
    const raw = await this.request<unknown>("GET", "/api/assets/", {
      operation: "list_assets",
    });
    const schema = paginatedResultSchema(PimsAssetSchema);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid assets list from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getDashboardKpis(tab = "summary"): Promise<PimsDashboardResponse> {
    const raw = await this.request<unknown>(
      "GET",
      `/api/dashboard/?tab=${encodeURIComponent(tab)}`,
      {
        operation: "get_dashboard_kpis",
      },
    );
    const parsed = DashboardKpisSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid dashboard KPIs format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async getAnnexAControlsMeta(): Promise<PimsAnnexAMetaResponse> {
    const raw = await this.request<unknown>(
      "GET",
      "/api/annex-a-controls/meta/",
      {
        operation: "get_annex_a_meta",
      },
    );
    const parsed = AnnexAControlsMetaSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PimsErrorShapeUnknownError(
        "Invalid Annex A controls meta format from PIMS",
        JSON.stringify(raw),
      );
    }
    return parsed.data;
  }

  async probeNestedArrayMutationStrategy(): Promise<"replace" | "merge"> {
    const throwaway = await this.createIncident({
      title: "STARTUP_NESTED_PROBE_THROWAWAY",
      involves_personal_data: false,
      incident_date: "2026-01-01",
      incident_type: "OT",
      status: "O",
    });

    try {
      const actionC: Partial<PimsIncidentAction> = {
        action_type: "C",
        responsible: "Probe Runner",
        action_date: "2026-01-01",
        description: "Probe action C",
        evidence: "",
      };
      await this.updateIncident(throwaway.id, {
        actions: [actionC as PimsIncidentAction],
      });

      const actionA: Partial<PimsIncidentAction> = {
        action_type: "A",
        responsible: "Probe Runner",
        action_date: "2026-01-02",
        description: "Probe action A",
        evidence: "",
      };
      await this.updateIncident(throwaway.id, {
        actions: [actionA as PimsIncidentAction],
      });

      const retrieved = await this.getIncident(throwaway.id);
      const actions = retrieved.actions ?? [];

      let strategy: "replace" | "merge";
      if (actions.length === 1 && actions[0]?.action_type === "A") {
        strategy = "replace";
      } else if (actions.length >= 2) {
        strategy = "merge";
      } else {
        throw new PimsErrorShapeUnknownError(
          "probeNestedArrayMutationStrategy returned unexpected actions shape",
          JSON.stringify(actions),
        );
      }

      console.info(`NESTED_PROBE:${strategy}`);
      this.nestedActionMode = strategy;
      return strategy;
    } finally {
      await this.deleteIncident(throwaway.id);
    }
  }

  async probeAuditMutationStrategy(): Promise<"replace" | "merge"> {
    const throwawayAudit = await this.createAudit({
      audit_type: "I",
      name: "AUDIT_PROBE_THROWAWAY",
      status: "P",
    });

    await this.updateAudit(throwawayAudit.id, {
      findings: [
        {
          classification: "N",
          description: "Probe finding 1",
          evidence: "",
          actions: [],
        },
      ],
    });

    await this.updateAudit(throwawayAudit.id, {
      findings: [
        {
          classification: "M",
          description: "Probe finding 2",
          evidence: "",
          actions: [],
        },
      ],
    });

    const auditList = await this.listAudits();
    const current = auditList.results.find((a) => a.id === throwawayAudit.id);
    const findings = current?.findings ?? [];

    let strategy: "replace" | "merge";
    if (findings.length === 1 && findings[0]?.classification === "M") {
      strategy = "replace";
    } else if (findings.length >= 2) {
      strategy = "merge";
    } else {
      throw new PimsErrorShapeUnknownError(
        "probeAuditMutationStrategy returned unexpected findings shape",
        JSON.stringify(findings),
      );
    }

    console.info(`NESTED_PROBE:audit:${strategy}`);
    this.nestedAuditMode = strategy;
    return strategy;
  }

  async probeNullClearCapability(
    field: keyof PimsIncidentUpdate = "description",
  ): Promise<"ok" | "rejected"> {
    const throwaway = await this.createIncident({
      title: "STARTUP_NULL_CLEAR_PROBE_THROWAWAY",
      involves_personal_data: false,
      incident_date: "2026-01-01",
      incident_type: "OT",
      status: "O",
      [field]: "initial-probe-val",
    });

    try {
      await this.updateIncident(throwaway.id, {
        [field]: null,
      });

      const retrieved = await this.getIncident(throwaway.id);
      const val = retrieved[field as keyof PimsIncident];
      const isCleared =
        val === null || val === "" || (Array.isArray(val) && val.length === 0);

      const result: "ok" | "rejected" = isCleared ? "ok" : "rejected";
      console.info(`NULL_CLEAR:${String(field)}:${result}`);
      return result;
    } finally {
      await this.deleteIncident(throwaway.id);
    }
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    options: {
      body?: unknown;
      formData?: FormData;
      isPublic?: boolean;
      operation: string;
      incidentCode?: string | null;
      idempotencyKey?: string;
      attempt?: number;
    },
  ): Promise<T> {
    const attempt = options.attempt ?? 1;
    const startedAt = Date.now();
    const observedAtUtc = new Date().toISOString();
    const endpointPath = endpoint.split("?")[0] ?? endpoint;
    const payloadKeys = collectPayloadKeys(options.body, options.formData);
    let observed = false;
    let responseStatus = 0;
    let recordIdempotencyKey: string | null = options.idempotencyKey ?? null;
    const observe = (status: number, errorCode: string | null): void => {
      if (observed) {
        return;
      }
      observed = true;
      this.onMutation?.({
        at_utc: observedAtUtc,
        method,
        endpoint: endpointPath,
        operation: options.operation,
        incident_code: options.incidentCode ?? null,
        idempotency_key: recordIdempotencyKey,
        duration_ms: Date.now() - startedAt,
        status,
        attempt,
        payload_keys: payloadKeys,
        error_code: errorCode,
      });
    };

    try {
      const url = `${this.baseUrl}${endpoint}`;

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(this.extraHeaders ?? {}),
      };

      if (this.cookies && Object.keys(this.cookies).length > 0) {
        headers.Cookie = Object.entries(this.cookies)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("; ");
      }

      headers["X-PIMS-Schema"] = this.schema;

      if (!options.isPublic) {
        if (!this.accessToken) {
          await this.obtainToken();
        }
        headers.Authorization = `Bearer ${this.accessToken}`;
      }

      let idempotencyKey = options.idempotencyKey;
      if (method !== "GET") {
        const code = options.incidentCode ?? "global";
        idempotencyKey =
          idempotencyKey ??
          `${this.idempotencyKeyPrefix}:${code}:${options.operation}:${crypto.randomUUID()}`;
        headers["Idempotency-Key"] = idempotencyKey;
      }
      recordIdempotencyKey = idempotencyKey ?? null;

      let requestBody: string | FormData | undefined;
      if (options.formData) {
        requestBody = options.formData;
      } else if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(options.body);
      }

      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        response = await fetch(url, {
          method,
          headers,
          body: requestBody,
          signal: controller.signal,
        });
        responseStatus = response.status;
        clearTimeout(timer);
      } catch (_err: unknown) {
        if (attempt <= this.maxRetries) {
          const backoff =
            DEFAULT_RETRY_BACKOFF_MS[attempt - 1] ??
            DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1];
          await new Promise((r) => setTimeout(r, backoff));
          observe(0, "PIMS_UNAVAILABLE");
          return this.request<T>(method, endpoint, {
            ...options,
            idempotencyKey,
            attempt: attempt + 1,
          });
        }
        throw new PimsUnavailableError(
          `Network failure contacting PIMS at ${endpoint}`,
        );
      }

      if (response.status === 401) {
        if (options.isPublic) {
          throw new PimsAuthFailedError(
            "Authentication credentials rejected by PIMS",
          );
        }
        const rawBody = await response.text().catch(() => "");
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          parsedBody = {};
        }

        if (
          parsedBody.detail === "bad_authorization_header" ||
          rawBody.includes("bad_authorization_header")
        ) {
          throw new PimsClientBugError(
            "PIMS client bug: bad_authorization_header received",
            { rawBody },
          );
        }

        if (attempt === 1) {
          const refreshed = await this.reAuthenticate();
          if (refreshed) {
            observe(401, "PIMS_AUTH_FAILED");
            return this.request<T>(method, endpoint, {
              ...options,
              idempotencyKey,
              attempt: attempt + 1,
            });
          }
        }
        throw new PimsAuthFailedError(
          "Authentication credentials rejected or token expired",
        );
      }

      if (response.status === 429) {
        if (attempt <= 3) {
          const backoff =
            DEFAULT_RETRY_BACKOFF_MS[attempt - 1] ??
            DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1];
          await new Promise((r) => setTimeout(r, backoff));
          observe(429, "PIMS_THROTTLED");
          return this.request<T>(method, endpoint, {
            ...options,
            idempotencyKey,
            attempt: attempt + 1,
          });
        }
        throw new PimsThrottledError("PIMS rate limit exceeded (HTTP 429)");
      }

      if (response.status >= 500) {
        const rawError = await response.text().catch(() => "");
        console.error(`PIMS HTTP ${response.status} at ${endpoint}:`, rawError);
        if (attempt <= this.maxRetries) {
          const backoff =
            DEFAULT_RETRY_BACKOFF_MS[attempt - 1] ??
            DEFAULT_RETRY_BACKOFF_MS[DEFAULT_RETRY_BACKOFF_MS.length - 1];
          await new Promise((r) => setTimeout(r, backoff));
          observe(response.status, "PIMS_UNAVAILABLE");
          return this.request<T>(method, endpoint, {
            ...options,
            idempotencyKey,
            attempt: attempt + 1,
          });
        }
        throw new PimsUnavailableError(
          `PIMS server failure HTTP ${response.status} at ${endpoint}: ${rawError}`,
        );
      }

      if (response.status === 204) {
        observe(response.status, null);
        return undefined as unknown as T;
      }

      let data: unknown;
      const rawText = await response.text();
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new PimsErrorShapeUnknownError(
          "Unparseable response JSON from PIMS",
          rawText,
        );
      }

      if (response.ok) {
        observe(response.status, null);
        return data as T;
      }

      if (response.status === 400) {
        const errObj = data as Record<string, unknown>;
        if (
          typeof errObj.detail === "string" &&
          errObj.detail.includes("No hay destinatarios")
        ) {
          throw new NotifyNoRecipientsError(errObj.detail);
        }
        const keys = Object.keys(errObj);
        if (keys.length > 0 && Array.isArray(errObj[keys[0] as string])) {
          const firstField = keys[0] as string;
          const messages = errObj[firstField] as string[];
          throw new PimsValidationError(
            firstField,
            messages[0] ?? `Validation failed for ${firstField}`,
            errObj as Record<string, string[]>,
          );
        }
        throw new PimsValidationError(
          "general",
          typeof errObj.detail === "string"
            ? errObj.detail
            : "Validation failed",
        );
      }

      if (response.status === 403) {
        const errObj = data as Record<string, unknown>;
        if (
          errObj.detail === "LICENSE_EXPIRED" ||
          errObj.detail === "SERVICE_SUSPENDED" ||
          errObj.detail === "DOCUMENT_LIMIT_REACHED"
        ) {
          throw new PimsGateBlockedError(errObj.detail as string);
        }
        throw new PimsPermissionDeniedError(
          endpoint,
          typeof errObj.detail === "string" ? errObj.detail : undefined,
        );
      }

      if (response.status === 404) {
        const match = endpoint.match(/\/api\/([^/]+)\/(?:(\d+)\/)?/);
        const model = match?.[1] ?? "resource";
        const id = match?.[2] ?? "unknown";
        throw new PimsNotFoundError(model, id);
      }

      if (response.status === 409) {
        throw new PimsConflictCodeError("Resource conflict code");
      }

      throw new PimsErrorShapeUnknownError(
        `Unexpected HTTP status ${response.status} from PIMS`,
        rawText,
      );
    } catch (error: unknown) {
      if (!observed) {
        observe(responseStatus, errorCodeOf(error));
      }
      throw error;
    }
  }

  private async obtainToken(): Promise<void> {
    if (this.username && this.password) {
      await this.login(this.username, this.password);
      return;
    }

    throw new PimsAuthFailedError(
      "No authentication credentials configured for PIMS adapter",
    );
  }

  private async reAuthenticate(): Promise<boolean> {
    if (this.refreshTokenVal) {
      try {
        await this.refreshToken();
        return true;
      } catch {
        this.refreshTokenVal = null;
      }
    }

    if (this.username && this.password) {
      await this.login(this.username, this.password);
      return true;
    }

    throw new PimsAuthFailedError(
      "No primary authentication credentials configured for PIMS re-authentication",
    );
  }
}

function collectPayloadKeys(body: unknown, formData?: FormData): string[] {
  if (formData !== undefined) {
    return Array.from(formData.keys());
  }
  if (body === undefined || body === null) {
    return [];
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  return Object.keys(body);
}

function errorCodeOf(error: unknown): string {
  if (error instanceof PimsBaseError) {
    return error.code;
  }
  return "UNKNOWN";
}
