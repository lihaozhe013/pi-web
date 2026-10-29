import type { AttachedFile } from './attached-files';
import { MAX_ATTACHED_IMAGES, isBase64ImageWithinLimits } from './image-attachments';

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  /** Files the composer references by chip; absent while none are attached. */
  files?: AttachedFile[];
}

const drafts = new Map<string, ChatDraft>();

function cloneDraft(draft: ChatDraft): ChatDraft {
  const files = (draft.files ?? []).map((file) => ({ ...file }));
  const clone: ChatDraft = {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image }))
  };
  // An empty list is not stored, so a draft that carries no files keeps the
  // shape it had before chips existed.
  if (files.length > 0) clone.files = files;
  return clone;
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && !draft.files?.length;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

/**
 * The draft a rejected submission merges into. Chips stay what they were: only
 * the text comes back, and its `@path` mentions are plain text again.
 */
export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
  currentFiles: AttachedFile[] = []
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  const restored: ChatDraft = {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images
  };
  if (currentFiles.length > 0) restored.files = currentFiles.map((file) => ({ ...file }));
  return restored;
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[]
): ChatDraft {
  const current = getDraft(key) ?? { value: '', images: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
    current.files
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous =
    currentDraft && !isEmptyDraft(currentDraft)
      ? cloneDraft(currentDraft)
      : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(
        next.value,
        next.images,
        previous.value,
        previous.images,
        previous.files
      )
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
