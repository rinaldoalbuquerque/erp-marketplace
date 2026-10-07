import "server-only";

import { parseServerEnv } from "./env-schema";

/** Validated server environment. Importing this from client code fails the build. */
export const env = parseServerEnv(process.env);
