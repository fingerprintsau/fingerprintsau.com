import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const ownerFile = { id: 7, userId: 22, name: "Owner sheet", fileType: "sheet" as const, snapshotJson: "{}", sourceKey: null, sourceMimeType: null, sizeBytes: 2, createdAt: new Date(), updatedAt: new Date() };

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getOfficeFile: vi.fn(async (userId: number, id: number) => userId === 22 && id === 7 ? ownerFile : null),
    deleteOfficeFile: vi.fn(async (userId: number, id: number) => userId === 22 && id === 7 ? { deleted: true, storageKey: null } : false),
  };
});

const { appRouter } = await import("./routers");

function context(userId: number): TrpcContext {
  return {
    user: { id: userId, openId: `user-${userId}`, email: `${userId}@example.com`, name: `Seller ${userId}`, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), storeSlug: `seller-${userId}` },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("office ownership procedures", () => {
  it("rejects a seller trying to read another seller's file", async () => {
    await expect(appRouter.createCaller(context(11)).office.get({ id: 7 })).rejects.toThrow("File not found.");
    await expect(appRouter.createCaller(context(22)).office.get({ id: 7 })).resolves.toMatchObject({ userId: 22 });
  });

  it("rejects a seller trying to delete another seller's file", async () => {
    await expect(appRouter.createCaller(context(11)).office.delete({ id: 7 })).rejects.toThrow("File not found.");
    await expect(appRouter.createCaller(context(22)).office.delete({ id: 7 })).resolves.toMatchObject({ success: true });
  });
});
