/** `err.message` của lỗi bắt từ catch (Error hoặc object lỗi của Supabase), rơi về `fallback` khi trống. */
export const errorMessage = (err: unknown, fallback: string) =>
    (err as { message?: string } | null | undefined)?.message || fallback
