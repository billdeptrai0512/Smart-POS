/** Mật khẩu mạnh: ≥8 ký tự, có chữ và số. Nguồn duy nhất — PasswordChecklist chỉ hiển thị lại từng điều kiện. */
export const isStrongPassword = (pw: string) => pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw)
