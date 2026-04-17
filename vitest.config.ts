import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "shared/**/test/**/*.test.ts",
      "packages/**/test/**/*.test.ts",
      "scripts/test/**/*.test.ts"
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "scripts/**"
      ],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 65,
        statements: 80
      }
    }
  }
});
