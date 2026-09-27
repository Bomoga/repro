/**
 * Files handed to a model up front, so it doesn't spend a request on read_file for text the harness
 * already knows it needs: the Challenger (on the Pro tier, where every request counts against the
 * daily quota) gets the patched files and the tests that exercise them, and Repair gets the files
 * its findings point to. Each is read exactly as read_file reads it: through WorkspaceFiles, so
 * secrets are redacted and line endings are LF.
 */
import * as path from "node:path";
import { fence } from "./diagnose/prompt.js";
import { WorkspacePathError, splitLines, type WorkspaceFiles } from "./workspace-files.js";

export interface PreloadedFile {
  path: string;
  /** The redacted text, or undefined when the file couldn't be read. */
  text?: string;
  /** Why the file couldn't be read. */
  note?: string;
}

/** Reads each path as read_file would. A path that can't be read (a file the patch deleted, say) is kept with a note. */
export async function readFilesForPrompt(files: WorkspaceFiles, paths: string[]): Promise<PreloadedFile[]> {
  const preloaded: PreloadedFile[] = [];
  for (const file of [...new Set(paths)]) {
    try {
      preloaded.push({ path: files.normalize(file), text: await files.readView(file) });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (error instanceof WorkspacePathError || code === "ENOENT") {
        preloaded.push({ path: file, note: code === "ENOENT" ? "not in the tree (the patch deletes it)" : (error as Error).message });
      } else {
        throw error;
      }
    }
  }
  return preloaded;
}

const TEST_FILE = /(?:^|\/)(?:tests?|__tests__|specs?)\/|(?:^|\/)test_[^/]*\.py$|_test\.py$|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)conftest\.py$/i;
const CODE_FILE = /\.(?:py|[cm]?[jt]sx?)$/i;
const MAX_TEST_FILES_READ = 200;

export function isTestFile(file: string): boolean {
  return CODE_FILE.test(file) && TEST_FILE.test(file);
}

/** The name a test would use for a module: `db` for src/db.js, the directory for an index or __init__ file. */
function moduleName(file: string): string | undefined {
  const parsed = path.posix.parse(file.replace(/\\/g, "/"));
  const name = ["index", "__init__"].includes(parsed.name) ? path.posix.basename(parsed.dir) : parsed.name;
  return name.length >= 2 ? name : undefined;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tracked test files that mention a changed module by name, most related first: a test named
 * after the module and importing it ranks above one that only mentions it. At most `perModule`
 * for each changed file.
 */
export async function relatedTestFiles(files: WorkspaceFiles, changed: string[], perModule = 3): Promise<string[]> {
  const changedSet = new Set(changed.map((file) => file.replace(/\\/g, "/")));
  const names = changed.map(moduleName).filter((name): name is string => name !== undefined);
  if (names.length === 0) return [];
  const candidates = files.workspace.fileIndex.filter((file) => isTestFile(file) && !changedSet.has(file));
  // Tests named after a changed module first, so a large suite can't crowd them out of the read limit.
  const named = (file: string) => names.some((name) => path.posix.basename(file).toLowerCase().includes(name.toLowerCase()));
  const toRead = [...candidates.filter(named), ...candidates.filter((file) => !named(file))].slice(0, MAX_TEST_FILES_READ);

  const texts = new Map<string, string>();
  for (const file of toRead) {
    try {
      texts.set(file, await files.readView(file));
    } catch {
      // Unreadable here means unreadable by read_file too: leave it out.
    }
  }
  const chosen: string[] = [];
  for (const name of names) {
    const word = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);
    const ranked = [...texts]
      .filter(([, text]) => word.test(text))
      .map(([file, text]) => {
        const imports = splitLines(text).some((line) => /\b(?:require|import|from)\b/.test(line) && word.test(line));
        const namedAfter = path.posix.basename(file).toLowerCase().includes(name.toLowerCase());
        return { file, score: (namedAfter ? 2 : 0) + (imports ? 1 : 0) };
      })
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    for (const { file } of ranked.slice(0, perModule)) if (!chosen.includes(file)) chosen.push(file);
  }
  return chosen;
}

const MIN_TRUNCATED_CHARS = 500;

/**
 * The files as read_file would return each of them, `maxChars` in total at most. A file that
 * doesn't fit is cut with a visible marker, and any after it are named as left out.
 */
export function renderPreloadedFiles(preloaded: PreloadedFile[], maxChars: number): string {
  const blocks: string[] = [];
  const omitted: string[] = [];
  let remaining = maxChars;
  const take = (block: string) => {
    blocks.push(block);
    remaining -= block.length + 2; // and the blank line after it
  };
  for (const file of preloaded) {
    const text = file.text;
    if (text === undefined) {
      take(`${file.path}: ${file.note ?? "not readable"}`);
      continue;
    }
    const lines = splitLines(text).length;
    const whole = `${file.path} (${lines} lines)\n${fence(text)}`;
    if (whole.length <= remaining) {
      take(whole);
      continue;
    }
    if (remaining < MIN_TRUNCATED_CHARS) {
      omitted.push(file.path);
      continue;
    }
    const cut = (keep: number) => {
      const kept = text.slice(0, keep);
      const marker = `…[truncated: ${text.length - kept.length} more characters; read_file returns the whole file]`;
      return `${file.path} (${lines} lines, cut short)\n${fence(`${kept}\n${marker}`)}`;
    };
    let keep = remaining;
    let block = cut(keep);
    while (block.length > remaining && keep > 0) {
      keep = Math.max(0, keep - (block.length - remaining));
      block = cut(keep);
    }
    take(block);
  }
  if (omitted.length > 0) blocks.push(`Left out to keep this input short (read_file returns them): ${omitted.join(", ")}`);
  return blocks.join("\n\n");
}
