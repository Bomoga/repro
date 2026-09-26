import { InMemoryRunStore } from "../src/store/index.ts";
import { describeRunStore } from "./helpers/conformance.ts";

describeRunStore("in-memory", async () => new InMemoryRunStore());
