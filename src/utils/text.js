// Title-case each whitespace-separated word: uppercase the first letter,
// leave the rest as typed. Length-preserving (case-only) so the caret stays
// put on end-typing. ponytail: caret jumps to end on mid-string edits —
// acceptable for short name fields; track caret via selectionStart if it bites.
export function capitalizeWords(s) {
    return s.replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase())
}
