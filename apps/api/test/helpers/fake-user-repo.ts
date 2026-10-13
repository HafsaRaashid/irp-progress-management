import type { UserRepo, UserRecord } from "../../src/db/user-repo.js";

// `create`/`list`/`archive`/`restore` back /api/v1/users, DELETE
// /api/v1/users/{id} and POST /api/v1/users/{id}/restore, none of which any
// suite using `fakeUserRepo` exercises — they throw if ever reached, same as
// `unusedBatchRepo`'s methods.
const unused = () => {
  throw new Error(
    "unused: userRepo.create/list/archive/restore was not expected to be called in this suite",
  );
};

export function fakeUserRepo(users: UserRecord[]): UserRepo {
  return {
    findByExternalId(externalId) {
      return Promise.resolve(users.find((u) => u.externalId === externalId) ?? null);
    },
    findById(id) {
      const u = users.find((user) => user.id === id);
      return Promise.resolve(u ? { ...u, deletedAt: null } : null);
    },
    // Mirrors the real repo's semantics (ADR-0035) rather than throwing: the
    // auth plugin calls this on every findByExternalId miss, which includes
    // the "unregistered user" fixtures every existing 403 test already
    // exercises. Mutates the fixture in place, same as the real atomic
    // UPDATE claiming the row.
    bindExternalId(email, externalId) {
      const u = users.find(
        (user) => user.externalId === null && user.email.toLowerCase() === email.toLowerCase(),
      );
      if (!u) return Promise.resolve(null);
      u.externalId = externalId;
      return Promise.resolve(u);
    },
    create: unused,
    list: unused,
    archive: unused,
    restore: unused,
  };
}
