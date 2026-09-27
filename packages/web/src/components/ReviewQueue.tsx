import { AnimatePresence, motion } from "framer-motion";
import type { Patch, Run } from "@repro/contracts";
import type { PatchDecision } from "@repro/api";
import type { Poll } from "../lib/poll.ts";
import type { ReviewItem } from "../lib/review.ts";
import { toHash } from "../lib/route.ts";
import { plural, rel, targetTitle } from "../lib/format.ts";
import { Skeleton } from "./Bits.tsx";
import { PatchCard } from "./PatchCard.tsx";

export function ReviewQueue({
  review,
  onDecided,
  onError,
}: {
  review: Poll<ReviewItem[]>;
  onDecided: (patch: Patch, decision: PatchDecision) => void;
  onError: (message: string) => void;
}) {
  const items = review.data;
  if (!items) {
    return (
      <div className="view stack-14">
        <Skeleton height={60} width="60%" />
        <Skeleton height={260} />
      </div>
    );
  }

  const groups: { run: Run; items: ReviewItem[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.run.id === item.run.id);
    if (group) group.items.push(item);
    else groups.push({ run: item.run, items: [item] });
  }

  return (
    <div className="view view--review">
      <p className="sentence">
        {items.length ? (
          <>
            <span data-ink="needs">{plural(items.length, "patch", "patches")}</span>
            <span data-ink="ink2">
              {items.length === 1 ? " passed verification and is waiting for your decision." : " passed verification and are waiting for your decision."}
            </span>
          </>
        ) : (
          <span data-ink="ink">Nothing to review.</span>
        )}
      </p>

      {groups.length === 0 && (
        <p className="boxed boxed--lg boxed--narrow">Nothing to review. Patches that pass verification show up here for you to merge or reject.</p>
      )}

      {groups.map((group) => (
        <section key={group.run.id} className="group" aria-label={targetTitle(group.run.target)}>
          <div className="group__head">
            <a className="group__name" href={toHash({ tab: "review", runId: group.run.id })}>
              {targetTitle(group.run.target)} →
            </a>
            <span className="group__time">{rel(group.run.startedAt)}</span>
          </div>
          <AnimatePresence initial={false}>
            {group.items.map((item) => (
              <motion.div key={item.patch.id} layout exit={{ opacity: 0, height: 0, transition: { duration: 0.25 } }}>
                <PatchCard patch={item.patch} diagnosis={item.diagnosis} trust={item.trust} leaveOnDecide onDecided={onDecided} onError={onError} />
              </motion.div>
            ))}
          </AnimatePresence>
        </section>
      ))}
    </div>
  );
}
