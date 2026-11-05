import { createRequire } from "node:module";

const req = createRequire(import.meta.resolve("@microx-technologies/microenv"));
export const z = req("zod");
export default z;
