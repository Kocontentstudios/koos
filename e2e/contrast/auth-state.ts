import path from "node:path";
import type { QaAccount } from "./seed";

export const AUTH_DIR = path.join("test-results", ".auth");
export const authState = (who: QaAccount) => path.join(AUTH_DIR, `${who}.json`);
export const SEEDED_IDS = path.join(AUTH_DIR, "seeded-ids.json");
