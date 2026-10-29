'use client';

import { useId, useState } from 'react';

/** A small opt-in entry point; the normal Stop control interrupts a running goal. */
export function GoalControl({
  onSend,
  disabled
}: {
  onSend: (message: string) => void;
  disabled: boolean;
}) {
  const [objective, setObjective] = useState('');
  const objectiveId = useId();
  return (
    <details className="mx-auto w-full max-w-[var(--chat-content-max-width,820px)] px-4 pb-2 text-sm text-text-muted">
      <summary className="w-fit cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
        Goal
      </summary>
      <form
        className="mt-2 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = objective.trim();
          if (!value || disabled) return;
          onSend(`/goal start ${value}`);
        }}
      >
        <label htmlFor={objectiveId}>What should be achieved?</label>
        <textarea
          id={objectiveId}
          className="min-h-20 w-full rounded border border-current bg-transparent p-2 text-text-primary focus-visible:outline focus-visible:outline-2"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          maxLength={4000}
        />
        <p>
          Runs automatically with up to 5 continuations, 200,000 tokens or 30 minutes. Limits are
          checked between runs and may be exceeded. Stop interrupts the current run.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-current px-3 py-1 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            disabled={disabled || !objective.trim()}
            type="submit"
          >
            Start goal
          </button>
          <button
            className="rounded border border-current px-3 py-1 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onSend('/goal resume')}
          >
            Resume goal
          </button>
          <button
            className="rounded border border-current px-3 py-1 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onSend('/goal status')}
          >
            Goal status
          </button>
          <button
            className="rounded border border-current px-3 py-1 focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onSend('/goal clear')}
          >
            Clear goal
          </button>
        </div>
      </form>
    </details>
  );
}
