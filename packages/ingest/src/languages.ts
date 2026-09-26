import { basename, extname } from "node:path";

const BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".rs": "rust",
  ".php": "php",
  ".cs": "csharp",
  ".swift": "swift",
  ".scala": "scala",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".sh": "bash",
  ".tf": "terraform",
};

const BY_FILENAME: Record<string, string> = {
  Dockerfile: "dockerfile",
};

// Languages present in the file index, by extension. Sorted so the same tree always yields the
// same Workspace.languages.
export function detectLanguages(fileIndex: readonly string[]): string[] {
  const found = new Set<string>();
  for (const file of fileIndex) {
    const lang = BY_FILENAME[basename(file)] ?? BY_EXTENSION[extname(file).toLowerCase()];
    if (lang) found.add(lang);
  }
  return [...found].sort();
}
