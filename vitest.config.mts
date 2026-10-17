import { defineConfig } from "vitest/config"

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        env: {
            NODE_ENV: "test",
            LOG_LEVEL: "silent",
            DB_NAME: "test",
            DB_USER: "test",
            DB_PASSWORD: "test",
            JWT_SECRET: "test-secret-test-secret-test-secret-123",
        },
    },
})
