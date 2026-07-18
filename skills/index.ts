// ============================================================
// Skills — public API
// ============================================================
// loadSkillsForCwd(cwd): Kimi Code-style four-scope Agent Skills scan,
// fed into subagent sessions via resourceLoader.getSkills.
// listExistingSkillDirs(cwd): existing skills dirs only, for the main
// session's resources_discover hook (pi loads them with its own scanner).

export {
  loadSkillsForCwd,
  listSkillRootDirs,
  listExistingSkillDirs,
  findProjectRoot,
  clearSkillsCache,
} from "./scanner";
export type { KimiSkill, SkillDiagnostic, LoadSkillsResult, SkillRootDir } from "./scanner";
export { parseFrontmatter, fallbackDescription } from "./frontmatter";
