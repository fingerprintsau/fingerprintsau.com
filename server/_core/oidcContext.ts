import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getSessionUser } from "./oidcAuth";

export type OidcTrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createOidcContext(
  opts: CreateExpressContextOptions
): Promise<OidcTrpcContext> {
  let user: User | null = null;
  try {
    user = (await getSessionUser(opts.req)) ?? null;
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user };
}
