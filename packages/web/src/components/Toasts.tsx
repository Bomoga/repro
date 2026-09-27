import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  error: boolean;
}

export function useToasts(): [Toast[], (text: string, error?: boolean) => void] {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const push = useCallback((text: string, error = false) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, text, error }].slice(-3));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), error ? 6000 : 3600);
  }, []);
  return [toasts, push];
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            role="status"
            layout
            className="toast"
            data-error={toast.error || undefined}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            {toast.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
