import test from "node:test";
import assert from "node:assert/strict";
import {
  RSC_EXCEPTION,
  classifyVulnerabilities,
  validateExceptionEnvironment,
} from "../../scripts/audit-browser-spa-production-dependencies.mjs";

const allowedReport = {
  vulnerabilities: {
    "react-router": {
      severity: "high",
      via: [
        {
          name: "react-router",
          dependency: "react-router",
          url: `https://github.com/advisories/${RSC_EXCEPTION.advisoryId}`,
        },
      ],
    },
    "react-router-dom": {
      severity: "high",
      via: ["react-router"],
    },
  },
};

test("production audit allows only the scoped React Router RSC advisory chain", () => {
  assert.deepEqual(classifyVulnerabilities(allowedReport), {
    allowed: [
      { name: "react-router", severity: "high" },
      { name: "react-router-dom", severity: "high" },
    ],
    blocked: [],
  });
});

test("production audit still blocks every unrelated moderate-or-higher advisory", () => {
  const report = structuredClone(allowedReport);
  report.vulnerabilities.axios = {
    severity: "moderate",
    via: [
      {
        name: "axios",
        dependency: "axios",
        url: "https://github.com/advisories/GHSA-example-not-allowed",
      },
    ],
  };
  const result = classifyVulnerabilities(report);
  assert.deepEqual(
    result.allowed.map((entry) => entry.name),
    ["react-router", "react-router-dom"],
  );
  assert.deepEqual(
    result.blocked.map((entry) => entry.name),
    ["axios"],
  );
});

test("RSC exception fails closed on version drift, RSC adoption, and expiry", () => {
  assert.deepEqual(
    validateExceptionEnvironment({
      lockVersion: RSC_EXCEPTION.lockedVersion,
      sourceFiles: [
        {
          path: "App.tsx",
          source: 'import { Routes } from "react-router-dom"',
        },
      ],
      now: new Date("2026-07-27T00:00:00.000Z"),
    }),
    [],
  );

  const errors = validateExceptionEnvironment({
    lockVersion: "7.18.1",
    sourceFiles: [
      {
        path: "server.tsx",
        source: 'import { unstable_RSCRouteConfig } from "react-router"',
      },
    ],
    now: new Date("2026-09-01T00:00:00.000Z"),
  });
  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /7\.18\.1/);
  assert.match(errors.join("\n"), /到期/);
  assert.match(errors.join("\n"), /server\.tsx/);
});
