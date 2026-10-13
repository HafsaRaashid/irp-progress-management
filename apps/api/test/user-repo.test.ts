import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createPrismaClient } from "../src/db/client.js";
import { createUserRepo } from "../src/db/user-repo.js";
import { resetDb } from "./helpers/db.js";
import { dbUrl } from "./helpers/require-db.js";

describe.skipIf(!dbUrl)("createUserRepo", () => {
  const prisma = createPrismaClient(dbUrl!);
  const repo = createUserRepo(prisma);

  beforeEach(async () => { await resetDb(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  it("finds an active user by externalId", async () => {
    await prisma.user.create({
      data: { externalId: "oid-1", email: "a@bistecglobal.com", displayName: "Amaya", role: "STUDENT" },
    });
    const found = await repo.findByExternalId("oid-1");
    expect(found?.email).toBe("a@bistecglobal.com");
    expect(found?.role).toBe("STUDENT");
  });

  it("returns null for an unknown externalId", async () => {
    expect(await repo.findByExternalId("nobody")).toBeNull();
  });

  it("hides a soft-deleted user (FR-5) — treated as unregistered", async () => {
    await prisma.user.create({
      data: { externalId: "oid-2", email: "b@bistecglobal.com", displayName: "Ben", role: "ADMIN", deletedAt: new Date() },
    });
    expect(await repo.findByExternalId("oid-2")).toBeNull();
  });

  // ADR-0035: registration no longer asks for externalId up front; it binds
  // itself to the real oid on this person's first successful sign-in,
  // matched by email.
  describe("bindExternalId", () => {
    it("binds a pending registration's externalId, matched by email", async () => {
      await prisma.user.create({
        data: { email: "nuwan@bistecglobal.com", displayName: "Nuwan", role: "STUDENT" },
      });
      const bound = await repo.bindExternalId("nuwan@bistecglobal.com", "entra-oid-1");
      expect(bound?.externalId).toBe("entra-oid-1");
      expect(await repo.findByExternalId("entra-oid-1")).not.toBeNull();
    });

    it("matches the email case-insensitively", async () => {
      await prisma.user.create({
        data: { email: "sachini@bistecglobal.com", displayName: "Sachini", role: "STUDENT" },
      });
      const bound = await repo.bindExternalId("SACHINI@BistecGlobal.com", "entra-oid-2");
      expect(bound?.email).toBe("sachini@bistecglobal.com");
    });

    it("never rebinds a row whose externalId is already set, even under a reused email", async () => {
      await prisma.user.create({
        data: { externalId: "already-bound", email: "reused@bistecglobal.com", displayName: "Kavindu", role: "STUDENT" },
      });
      expect(await repo.bindExternalId("reused@bistecglobal.com", "new-hire-oid")).toBeNull();
      // The original binding survives untouched.
      expect(await repo.findByExternalId("already-bound")).not.toBeNull();
      expect(await repo.findByExternalId("new-hire-oid")).toBeNull();
    });

    it("does not bind a soft-deleted (archived) user", async () => {
      await prisma.user.create({
        data: { email: "tharindu@bistecglobal.com", displayName: "Tharindu", role: "STUDENT", deletedAt: new Date() },
      });
      expect(await repo.bindExternalId("tharindu@bistecglobal.com", "entra-oid-3")).toBeNull();
    });

    it("returns null when no row matches the email at all", async () => {
      expect(await repo.bindExternalId("nobody@bistecglobal.com", "entra-oid-4")).toBeNull();
    });
  });
});
