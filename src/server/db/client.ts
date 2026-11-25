import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { WorkspaceError } from "../workspace/errors";

const cache = globalThis as typeof globalThis & { fisPrisma?: PrismaClient };

export function database() {
  if (cache.fisPrisma) return cache.fisPrisma;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new WorkspaceError(503, "The learning workspace database is not configured.");
  cache.fisPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 4, connectionTimeoutMillis: 5_000 }),
  });
  return cache.fisPrisma;
}
