import { describe, expect, it } from "vitest";

import { parseConfiguration, redactConfiguration } from "../src/config.js";

describe("application configuration", () => {
  it("applies bounded defaults and environment overrides", () => {
    const configuration = parseConfiguration(
      {},
      { CHAT_SUGGEST_ENABLED: "false", CHAT_SUGGEST_DEBOUNCE_MS: "350" },
      "/workspace",
    );

    expect(configuration.enabled).toBe(false);
    expect(configuration.debounceMs).toBe(350);
    expect(configuration.provider).toBe("fake");
    expect(configuration.context.trustedProjects).toEqual([]);
  });

  it("rejects unknown fields and unsafe remote endpoints", () => {
    expect(() => parseConfiguration({ mystery: true })).toThrow(
      "configuration.mystery is not supported",
    );
    expect(() =>
      parseConfiguration({
        provider: "openai-compatible",
        remote: {
          endpoint: "http://example.com/v1",
          model: "fast",
          apiKeyEnvironmentVariable: "API_KEY",
        },
      }),
    ).toThrow("endpoint must use HTTPS");
  });

  it("reports only the key variable name, never a key value", () => {
    const configuration = parseConfiguration({
      provider: "openai-compatible",
      remote: {
        endpoint: "https://api.example.test/v1?tenant=private",
        model: "fast",
        apiKeyEnvironmentVariable: "PRIVATE_API_KEY",
        requestsPerHour: 20,
      },
    });
    const output = JSON.stringify(redactConfiguration(configuration));

    expect(output).toContain("PRIVATE_API_KEY");
    expect(output).not.toContain("tenant=private");
    expect(output).not.toContain("/v1");
    expect(output).not.toContain("super-secret-value");
  });

  it("redacts trusted project and host command paths from status", () => {
    const configuration = parseConfiguration(
      {
        context: { trustedProjects: ["/private/tenant/project"] },
        host: {
          command: "/private/bin/codex",
          allowlistedCommands: ["/private/bin/codex"],
        },
      },
      {},
      "/workspace",
    );
    const output = JSON.stringify(redactConfiguration(configuration));

    expect(output).not.toContain("/private");
    expect(output).toContain('"trustedProjectCount":1');
    expect(output).toContain('"commandConfigured":true');
  });
});
