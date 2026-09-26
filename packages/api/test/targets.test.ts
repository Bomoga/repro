import { describe, expect, it } from "vitest";
import { targetProblem } from "../src/targets.ts";

const github = (ref: string) => targetProblem({ kind: "github", ref });
const local = (ref: string) => targetProblem({ kind: "local", ref });

describe("targetProblem", () => {
  it("accepts the GitHub forms ingest parses", () => {
    for (const ref of ["octo/example", "octo/example#main", "octo/example#v1.2.0", "https://github.com/octo/example", "https://github.com/octo/example.git#feature/x"]) {
      expect(github(ref), ref).toBeNull();
    }
  });

  it("refuses GitHub refs ingest would refuse", () => {
    expect(github("main")).toMatch(/not a GitHub ref/);
    expect(github("octo/example/extra")).toMatch(/not a GitHub ref/);
    expect(github("https://gitlab.com/octo/example")).toMatch(/not a GitHub ref/);
    expect(github("octo/exa mple")).toMatch(/not a GitHub ref/);
    expect(github("octo/example#--upload-pack=evil")).toMatch(/unsafe revision/);
  });

  it("accepts absolute local paths, with or without a revision", () => {
    expect(local("/home/dev/project")).toBeNull();
    expect(local("/home/dev/project#abc123")).toBeNull();
  });

  it("refuses relative local paths, which the API host can't resolve for the caller", () => {
    expect(local("./project")).toMatch(/absolute path/);
    expect(local("project")).toMatch(/absolute path/);
    expect(local("#main")).toMatch(/empty local path/);
    expect(local("/srv/project#-x")).toMatch(/unsafe revision/);
  });

  it("refuses empty, padded, and oversized refs", () => {
    expect(github("")).toMatch(/empty/);
    expect(github(" octo/example")).toMatch(/whitespace/);
    expect(local(`/${"a".repeat(2000)}`)).toMatch(/longer than/);
  });
});
