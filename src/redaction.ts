import type { AtifTrajectory } from "./schema.js";

export interface RedactionProfile {
  id: string;
  transform(trajectory: AtifTrajectory): AtifTrajectory | Promise<AtifTrajectory>;
}

export const rawRedactionProfile: RedactionProfile = {
  id: "raw-v1",
  transform: (trajectory) => structuredClone(trajectory),
};
