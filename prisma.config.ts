import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation and validation run without connecting to a database.
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://localhost:5432/fis_unconfigured" },
});
