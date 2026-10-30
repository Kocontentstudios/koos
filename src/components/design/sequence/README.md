# Design Studio: sets of frames (KOOS-AI-002)

The client side of carousels and presentations. A set is one thing to the
user: one card in the history, one viewer, one ZIP or PDF.

| File | What it is |
| --- | --- |
| `set-model.ts` | Pure: rows to a `DesignSet` (every index, in order), the live row per index, gallery grouping, role labels, download URLs. |
| `use-frame-set.ts` | One set on screen plus per-frame regenerate (`POST /api/design/generations/[id]/regenerate-frame`, polled, swapped in place). Pending keys are `regen:${generationId}`. |
| `progress.ts` | Reads the sequence job's progress mark; "Planning your carousel…", "Frame k of N…". |
| `set-viewer.tsx` | Stage (`set-stage.tsx`), filmstrip (`frame-rail.tsx`), the selected frame's actions and inline editor (`frame-editor.tsx`), downloads (`set-downloads.tsx`). |
| `set-progress.tsx` | The wait for a whole set in the directions dialog. |
| `set-card.tsx`, `set-viewer-dialog.tsx` | The history grid's card and the dialog it opens. |

`use-design-generation.ts` composes `useFrameSet`: a job result with
`kind: "sequence"` loads its frames by id and exposes them as `set`.

## What the other units must send

- **Progress mark.** The sequence job adds `sequence: { kind, frameCount, phase: "plan" | "render" }`
  to every progress write, `done` counting delivered frames. Without it the
  dialog shows the directions progress copy until the result arrives.
- **Frame copy on the wire.** `SerializedGeneration` carries `headline` only.
  `frameCopyOf` already reads `subheadline` and `cta` when the serializer adds
  them; until then those fields open empty and an empty field keeps the
  frame's line rather than deleting it.

## Testing

`pnpm vitest run src/components/design/sequence src/components/design/use-design-generation.sequence.test.ts`
