import fs from "node:fs";
import path from "node:path";
import { PresidioClient } from "@pims/agent/llm/presidio-client.ts";
import { AgentModelClient } from "@pims/agent/llm/safe-prompt.ts";
import { createCockpitApp } from "@pims/cockpit/app.ts";
import { SessionRegistry } from "@pims/cockpit/auth.ts";
import type { AgentConfig } from "@pims/config";
import { OpenAIModelProvider } from "@pims/models";
import {
  PiiRedactionUnavailableError,
  PromptPiiBlockedError,
} from "@pims/types/errors.ts";
import {
  type IntegrationHarness,
  startIntegrationHarness,
} from "@tests/helpers/integration-harness.ts";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface RedactionFixture {
  id: string;
  description: string;
  input: string;
  expected_redacted: string;
  expected_entities: string[];
  expected_tokens: string[];
}

describe("Acceptance Tests A23 & A24: Presidio PII Redaction", {
  timeout: 180_000,
}, () => {
  let presidioContainer: StartedTestContainer;
  let presidioUrl: string;
  let presidioClient: PresidioClient;
  let harness: IntegrationHarness;
  let fixtures: RedactionFixture[];

  beforeAll(async () => {
    presidioContainer = await new GenericContainer("presidio-analyzer:2.2.x-es")
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp("/health", 3000))
      .withStartupTimeout(60_000)
      .start();

    const host = presidioContainer.getHost();
    const port = presidioContainer.getMappedPort(3000);
    presidioUrl = `http://${host}:${port}`;

    presidioClient = new PresidioClient({
      baseUrl: presidioUrl,
      timeoutMs: 5000,
      minScore: 0.5,
    });

    const fixturesPath = path.resolve(
      process.cwd(),
      "tests/fixtures/redaction-fixtures.json",
    );
    fixtures = JSON.parse(
      fs.readFileSync(fixturesPath, "utf-8"),
    ) as RedactionFixture[];

    harness = await startIntegrationHarness();
  }, 180_000);

  afterAll(async () => {
    if (presidioContainer) {
      await presidioContainer.stop();
    }
    if (harness) {
      await harness.stop();
    }
  });

  describe("A24: Golden redaction fixtures through presidio-client", () => {
    it("presidio-client is healthy against running sidecar", async () => {
      const healthy = await presidioClient.isHealthy();
      expect(healthy).toBe(true);
    });

    it("redacts each golden fixture to exact expected tokenized output per §11.3", async () => {
      for (const fixture of fixtures) {
        const result = await presidioClient.redact(fixture.input);
        expect(result.redactedText).toBe(fixture.expected_redacted);

        for (const token of fixture.expected_tokens) {
          expect(result.redactedText).toContain(token);
        }

        // Spec §11.3: residual gate scan must pass cleanly on redacted output
        expect(() => {
          AgentModelClient.assertPromptSafe(result.redactedText);
        }).not.toThrow();
      }
    });

    it("detects residual unredacted PII if fed raw input with phone or email", () => {
      // Unredacted phone must be caught by formal libphonenumber-js gate
      expect(() => {
        AgentModelClient.assertPromptSafe("Llamar al +51 987654321");
      }).toThrow(PromptPiiBlockedError);

      // Unredacted email must be caught by formal zod email gate
      expect(() => {
        AgentModelClient.assertPromptSafe("Enviar a dpo@unsa.edu.pe");
      }).toThrow(PromptPiiBlockedError);

      // Unredacted URL must be caught by formal tldts gate
      expect(() => {
        AgentModelClient.assertPromptSafe(
          "Acceder a https://internal-portal.unsa.edu.pe",
        );
      }).toThrow(PromptPiiBlockedError);
    });
  });

  describe("A23: Presidio sidecar failure fail-closed", () => {
    it("fails closed with PII_REDACTION_UNAVAILABLE when sidecar is unreachable", async () => {
      // Point to an inactive port
      const deadClient = new PresidioClient({
        baseUrl: "http://127.0.0.1:19999",
        timeoutMs: 500,
        minScore: 0.5,
      });

      const healthy = await deadClient.isHealthy();
      expect(healthy).toBe(false);

      await expect(
        deadClient.analyze("Juan Pérez con DNI 12345678"),
      ).rejects.toThrow(PiiRedactionUnavailableError);

      await expect(
        deadClient.redact("Juan Pérez con DNI 12345678"),
      ).rejects.toThrow(/PII_REDACTION_UNAVAILABLE/);
    });

    it("blocks model calls and never executes provider chat_json on redaction failure", async () => {
      const deadClient = new PresidioClient({
        baseUrl: "http://127.0.0.1:19999",
        timeoutMs: 500,
        minScore: 0.5,
      });

      const modelConfig = {
        provider: "openai",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
        auth_env: "OPENAI_API_KEY",
        timeout_ms: 20000,
        max_retries: 0,
        fallback: "none" as const,
      };

      const provider = new OpenAIModelProvider({
        reasoningConfig: modelConfig,
        fastConfig: modelConfig,
        visionConfig: modelConfig,
        embeddingsConfig: { ...modelConfig, model: "text-embedding-3-small" },
        rerankerConfig: modelConfig,
        apiKey: "test-key",
      });

      const chatSpy = vi.spyOn(provider, "chat_json");

      const safeClient = new AgentModelClient(provider, deadClient);

      await expect(
        safeClient.chat_json({
          route: "FAST_MODEL",
          system: "Extract data",
          messages: [
            { role: "user", content: "Test content Juan Pérez 12345678" },
          ],
          max_tokens: 100,
          temperature: 0,
        }),
      ).rejects.toThrow(/PII_REDACTION_UNAVAILABLE/);

      // Spec A23: no unredacted send, no regex fallback, provider never called
      expect(chatSpy).not.toHaveBeenCalled();
    });

    it("causes Cockpit /readyz to fail with HTTP 503 until sidecar is recovered", async () => {
      const sessions = new SessionRegistry();

      // App with healthy presidio client on agent
      const healthyApp = createCockpitApp({
        config: {
          ...harness.config,
          PRESIDIO_URL: presidioUrl,
        } as AgentConfig,
        adapter: harness.adapter,
        store: harness.store,
        agent: {
          ...harness.agent,
          presidioClient,
        },
        ragService: harness.ragService,
        events: harness.events,
        sessions,
        clock: () => harness.now,
      });

      const healthyRes = await healthyApp.request("/readyz");
      expect(healthyRes.status).toBe(200);
      const healthyBody = (await healthyRes.json()) as {
        status: string;
        checks: { presidio: boolean };
      };
      expect(healthyBody.status).toBe("ready");
      expect(healthyBody.checks.presidio).toBe(true);

      // App with dead presidio client on agent
      const deadPresidio = new PresidioClient({
        baseUrl: "http://127.0.0.1:19999",
        timeoutMs: 500,
      });

      const deadApp = createCockpitApp({
        config: {
          ...harness.config,
          PRESIDIO_URL: "http://127.0.0.1:19999",
        } as AgentConfig,
        adapter: harness.adapter,
        store: harness.store,
        agent: {
          ...harness.agent,
          presidioClient: deadPresidio,
        },
        ragService: harness.ragService,
        events: harness.events,
        sessions,
        clock: () => harness.now,
      });

      const deadRes = await deadApp.request("/readyz");
      expect(deadRes.status).toBe(503);
      const deadBody = (await deadRes.json()) as {
        status: string;
        checks: { presidio: boolean };
      };
      expect(deadBody.status).toBe("not_ready");
      expect(deadBody.checks.presidio).toBe(false);
    });
  });
});
