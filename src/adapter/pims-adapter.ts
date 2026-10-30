import { execSync } from "node:child_process";
import {
  NotifyNoRecipientsError,
  PimsAuthFailedError,
  PimsConflictCodeError,
  PimsErrorShapeUnknownError,
  PimsGateBlockedError,
  PimsNotFoundError,
  PimsPermissionDeniedError,
  PimsThrottledError,
  PimsUnavailableError,
  PimsValidationError,
} from "@/types/errors.ts";
import type {
  LoginRequest,
  LoginResponse,
  PimsAnnexAMetaResponse,
  PimsAudit,
  PimsDashboardResponse,
  PimsIncident,
  PimsIncidentAction,
  PimsIncidentAttachment,
  PimsIncidentHistory,
  PimsIncidentRecipient,
  PimsRiskCatalogResponse,
  PimsRiskEvaluation,
  TokenRefreshResponse,
  UserProfile,
} from "@/types/pims.ts";

export interface PimsAdapterConfig {
  baseUrl: string;
  schema: string;
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKeyPrefix?: string;
  tokenCmd?: string[];
  username?: string;
  password?: string;
}

export interface PaginatedResult<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export class PimsAdapter {
  readonly baseUrl: string;
  readonly schema: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly idempotencyKeyPrefix: string;
  private readonly tokenCmd?: string[];
  private username?: string;
  private password?: string;

  accessToken: string | null = null;
  refreshTokenVal: string | null = null;
  nestedActionMode: "replace" | "merge" = "replace";
  nestedAuditMode: "replace" | "merge" = "replace";

  constructor(config: PimsAdapterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.schema = config.schema;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.maxRetries = config.maxRetries ?? 3;
    this.idempotencyKeyPrefix = config.idempotencyKeyPrefix ?? "agi1";
    this.tokenCmd = config.tokenCmd;
    this.username = config.username;
    this.password = config.password;
  }

  setCredentials(username: string, password: string): void {
    this.username = username;
    this.password = password;
  }

  setTokens(access: string, refresh?: string): void {
    this.accessToken = access;
    if (refresh) {
      this.refreshTokenVal = refresh;
    }
  }

  // --- Endpoints E01-E04 Auth ---

  async login(username?: string, password?: string): Promise<LoginResponse> {
    const user = username ?? this.username;
    const pass = password ?? this.password;
    if (!user || !pass) {
      throw new PimsAuthFailedError("No credentials available for PIMS login");
    }

    const payload: LoginRequest = { username: user, password: pass };
    const res = await this.request<LoginResponse>("POST", "/business/login/", {
      body: payload,
      isPublic: true,
      operation: "login",
    });

    this.accessToken = res.access;
    this.refreshTokenVal = res.refresh;
    return res;
  }

  async refreshToken(refreshTokenToUse?: string): Promise<string> {
    const token = refreshTokenToUse ?? this.refreshTokenVal;
    if (!token) {
      throw new PimsAuthFailedError(
        "No refresh token available to rotate access token",
      );
    }

    const res = await this.request<TokenRefreshResponse>(
      "POST",
      "/business/token/refresh/",
      {
        body: { refresh: token },
        isPublic: true,
        operation: "refresh_token",
      },
    );

    this.accessToken = res.access;
    return res.access;
  }

  async getTenantInfo(): Promise<{ name: string }> {
    return this.request<{ name: string }>("GET", "/business/info/", {
      operation: "tenant_info",
    });
  }

  async getProfile(): Promise<UserProfile> {
    return this.request<UserProfile>("GET", "/business/profile/", {
      operation: "profile",
    });
  }

  // --- Endpoints E05-E13 Incidents ---

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
    return this.request<PaginatedResult<PimsIncident>>("GET", path, {
      operation: "list_incidents",
    });
  }

  async createIncident(data: Partial<PimsIncident>): Promise<PimsIncident> {
    return this.request<PimsIncident>("POST", "/api/incidents/", {
      body: data,
      operation: "create_incident",
      incidentCode: data.incident_code,
    });
  }

  async getIncident(id: number): Promise<PimsIncident> {
    return this.request<PimsIncident>("GET", `/api/incidents/${id}/`, {
      operation: "get_incident",
    });
  }

  async updateIncident(
    id: number,
    data: Partial<PimsIncident>,
  ): Promise<PimsIncident> {
    return this.request<PimsIncident>("PATCH", `/api/incidents/${id}/`, {
      body: data,
      operation: "update_incident",
      incidentCode: data.incident_code,
    });
  }

  async deleteIncident(id: number): Promise<void> {
    await this.request<void>("DELETE", `/api/incidents/${id}/`, {
      operation: "delete_incident",
    });
  }

  async getIncidentHistory(id: number): Promise<PimsIncidentHistory[]> {
    return this.request<PimsIncidentHistory[]>(
      "GET",
      `/api/incidents/${id}/history/`,
      {
        operation: "get_incident_history",
      },
    );
  }

  async getIncidentAttachments(id: number): Promise<PimsIncidentAttachment[]> {
    return this.request<PimsIncidentAttachment[]>(
      "GET",
      `/api/incidents/${id}/attachments/`,
      {
        operation: "get_incident_attachments",
      },
    );
  }

  async uploadIncidentAttachment(
    id: number,
    file: Blob | Buffer | Uint8Array,
    fileName: string,
  ): Promise<PimsIncidentAttachment[]> {
    const formData = new FormData();
    const blob =
      file instanceof Blob ? file : new Blob([Buffer.from(file as Uint8Array)]);
    formData.append("file", blob, fileName);

    return this.request<PimsIncidentAttachment[]>(
      "POST",
      `/api/incidents/${id}/attachments/`,
      {
        formData,
        operation: "upload_attachment",
      },
    );
  }

  async notifyIncident(id: number): Promise<PimsIncident> {
    return this.request<PimsIncident>("POST", `/api/incidents/${id}/notify/`, {
      body: {},
      operation: "notify_incident",
    });
  }

  // --- Endpoints E14-E16 Incident Recipients ---

  async listRecipients(): Promise<PaginatedResult<PimsIncidentRecipient>> {
    return this.request<PaginatedResult<PimsIncidentRecipient>>(
      "GET",
      "/api/incident-recipients/",
      {
        operation: "list_recipients",
      },
    );
  }

  async createRecipient(data: {
    email: string;
    label: string;
    is_active: boolean;
  }): Promise<PimsIncidentRecipient> {
    return this.request<PimsIncidentRecipient>(
      "POST",
      "/api/incident-recipients/",
      {
        body: data,
        operation: "create_recipient",
      },
    );
  }

  async deleteRecipient(id: number): Promise<void> {
    await this.request<void>("DELETE", `/api/incident-recipients/${id}/`, {
      operation: "delete_recipient",
    });
  }

  // --- Endpoints E17-E19 Audits ---

  async listAudits(params?: {
    status?: string;
  }): Promise<PaginatedResult<PimsAudit>> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    const path = `/api/audits/${query.toString() ? `?${query.toString()}` : ""}`;
    return this.request<PaginatedResult<PimsAudit>>("GET", path, {
      operation: "list_audits",
    });
  }

  async createAudit(data: Record<string, unknown>): Promise<PimsAudit> {
    return this.request<PimsAudit>("POST", "/api/audits/", {
      body: data,
      operation: "create_audit",
    });
  }

  async updateAudit(
    id: number,
    data: Record<string, unknown>,
  ): Promise<PimsAudit> {
    return this.request<PimsAudit>("PATCH", `/api/audits/${id}/`, {
      body: data,
      operation: "update_audit",
    });
  }

  // --- Endpoints E20-E24 Risks & Assets ---

  async listRiskEvaluations(): Promise<PaginatedResult<PimsRiskEvaluation>> {
    return this.request<PaginatedResult<PimsRiskEvaluation>>(
      "GET",
      "/api/risk-evaluations/",
      {
        operation: "list_risk_evaluations",
      },
    );
  }

  async createRiskEvaluation(
    data: Record<string, unknown>,
  ): Promise<PimsRiskEvaluation> {
    return this.request<PimsRiskEvaluation>("POST", "/api/risk-evaluations/", {
      body: data,
      operation: "create_risk_evaluation",
    });
  }

  async getRiskCatalogs(): Promise<PimsRiskCatalogResponse> {
    return this.request<PimsRiskCatalogResponse>(
      "GET",
      "/api/risk-evaluations/catalogs/",
      {
        operation: "get_risk_catalogs",
      },
    );
  }

  async getEligibleAssets(): Promise<PaginatedResult<unknown>> {
    return this.request<PaginatedResult<unknown>>(
      "GET",
      "/api/risk-evaluations/eligible-assets/",
      {
        operation: "get_eligible_assets",
      },
    );
  }

  async listAssets(): Promise<PaginatedResult<unknown>> {
    return this.request<PaginatedResult<unknown>>("GET", "/api/assets/", {
      operation: "list_assets",
    });
  }

  // --- Endpoints E25-E26 Dashboard & Annex A ---

  async getDashboardKpis(tab = "summary"): Promise<PimsDashboardResponse> {
    return this.request<PimsDashboardResponse>(
      "GET",
      `/api/dashboard/?tab=${encodeURIComponent(tab)}`,
      {
        operation: "get_dashboard_kpis",
      },
    );
  }

  async getAnnexAControlsMeta(): Promise<PimsAnnexAMetaResponse> {
    return this.request<PimsAnnexAMetaResponse>(
      "GET",
      "/api/annex-a-controls/meta/",
      {
        operation: "get_annex_a_meta",
      },
    );
  }

  // --- Startup Probes ---

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

      let strategy: "replace" | "merge" = "replace";
      if (actions.length === 1 && actions[0]?.action_type === "A") {
        strategy = "replace";
      } else if (actions.length >= 2) {
        strategy = "merge";
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

    try {
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

      let strategy: "replace" | "merge" = "replace";
      if (findings.length === 1 && findings[0]?.classification === "M") {
        strategy = "replace";
      } else if (findings.length >= 2) {
        strategy = "merge";
      }

      console.info(`NESTED_PROBE:audit:${strategy}`);
      this.nestedAuditMode = strategy;
      return strategy;
    } finally {
      // Completed audit probe
    }
  }

  // --- HTTP Request Core ---

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    options: {
      body?: unknown;
      formData?: FormData;
      isPublic?: boolean;
      operation: string;
      incidentCode?: string | null;
      attempt?: number;
    },
  ): Promise<T> {
    const attempt = options.attempt ?? 1;
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-PIMS-Schema": this.schema,
    };

    if (!options.isPublic) {
      if (!this.accessToken) {
        await this.obtainToken();
      }
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    if (method !== "GET") {
      const code = options.incidentCode ?? "global";
      headers["Idempotency-Key"] =
        `${this.idempotencyKeyPrefix}:${code}:${options.operation}:${crypto.randomUUID()}`;
    }

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
      clearTimeout(timer);
    } catch (_err: unknown) {
      if (attempt <= this.maxRetries) {
        const backoff = attempt === 1 ? 1000 : attempt === 2 ? 5000 : 30000;
        await new Promise((r) => setTimeout(r, backoff));
        return this.request<T>(method, endpoint, {
          ...options,
          attempt: attempt + 1,
        });
      }
      throw new PimsUnavailableError(
        `Network failure contacting PIMS at ${endpoint}`,
      );
    }

    // Handle 401 unauthorized
    if (response.status === 401 && !options.isPublic) {
      if (attempt === 1) {
        const refreshed = await this.tryRefreshTokenOrReLogin();
        if (refreshed) {
          return this.request<T>(method, endpoint, {
            ...options,
            attempt: attempt + 1,
          });
        }
      }
      throw new PimsAuthFailedError(
        "Authentication credentials rejected or token expired",
      );
    }

    // Handle 429 rate limit
    if (response.status === 429) {
      if (attempt <= 3) {
        const backoff = attempt === 1 ? 1000 : attempt === 2 ? 5000 : 30000;
        await new Promise((r) => setTimeout(r, backoff));
        return this.request<T>(method, endpoint, {
          ...options,
          attempt: attempt + 1,
        });
      }
      throw new PimsThrottledError("PIMS rate limit exceeded (HTTP 429)");
    }

    // Handle 5xx server failure
    if (response.status >= 500) {
      const rawError = await response.text().catch(() => "");
      console.error(`PIMS HTTP ${response.status} at ${endpoint}:`, rawError);
      if (attempt <= this.maxRetries) {
        const backoff = attempt === 1 ? 1000 : attempt === 2 ? 5000 : 30000;
        await new Promise((r) => setTimeout(r, backoff));
        return this.request<T>(method, endpoint, {
          ...options,
          attempt: attempt + 1,
        });
      }
      throw new PimsUnavailableError(
        `PIMS server failure HTTP ${response.status} at ${endpoint}: ${rawError}`,
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T;
    }

    // Parse Response
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
      return data as T;
    }

    // Handle HTTP 400 validation and errors
    if (response.status === 400) {
      const errObj = data as Record<string, unknown>;
      if (
        typeof errObj.detail === "string" &&
        errObj.detail.includes("No hay destinatarios")
      ) {
        throw new NotifyNoRecipientsError(errObj.detail);
      }
      // DRF field errors: {"field": ["msg"]}
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
        typeof errObj.detail === "string" ? errObj.detail : "Validation failed",
      );
    }

    // Handle HTTP 403 Forbidden
    if (response.status === 403) {
      const errObj = data as Record<string, unknown>;
      if (
        errObj.detail === "LICENSE_EXPIRED" ||
        errObj.detail === "SERVICE_SUSPENDED"
      ) {
        throw new PimsGateBlockedError(errObj.detail as string);
      }
      throw new PimsPermissionDeniedError(
        endpoint,
        typeof errObj.detail === "string" ? errObj.detail : undefined,
      );
    }

    // Handle HTTP 404 Not Found
    if (response.status === 404) {
      throw new PimsNotFoundError(endpoint, "resource");
    }

    // Handle HTTP 409 Conflict
    if (response.status === 409) {
      throw new PimsConflictCodeError("Resource conflict code");
    }

    throw new PimsErrorShapeUnknownError(
      `Unexpected HTTP status ${response.status} from PIMS`,
      rawText,
    );
  }

  private async obtainToken(): Promise<void> {
    if (this.username && this.password) {
      await this.login(this.username, this.password);
      return;
    }

    if (this.tokenCmd && this.tokenCmd.length > 0) {
      try {
        const cmd = this.tokenCmd.join(" ");
        const output = execSync(cmd, { encoding: "utf-8" }).trim();
        this.accessToken = output;
        return;
      } catch (err: unknown) {
        throw new PimsAuthFailedError(
          `PIMS_TOKEN_CMD execution failed: ${String(err)}`,
        );
      }
    }

    throw new PimsAuthFailedError(
      "No authentication method configured for PIMS adapter",
    );
  }

  private async tryRefreshTokenOrReLogin(): Promise<boolean> {
    if (this.refreshTokenVal) {
      try {
        await this.refreshToken();
        return true;
      } catch {
        // Refresh token failed, try re-login
      }
    }

    if (this.username && this.password) {
      try {
        await this.login(this.username, this.password);
        return true;
      } catch {
        return false;
      }
    }

    if (this.tokenCmd) {
      try {
        await this.obtainToken();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
}
