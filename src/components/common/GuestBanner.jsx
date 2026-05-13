import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function GuestBanner({ onClose }) {
  const navigate = useNavigate()

  const handleRegister = () => {
    navigate('/signup')
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-primary text-white p-4 flex items-center justify-between shadow-lg animate-fade-in-up">
      <span className="font-medium">Bạn đang dùng chế độ Demo. Để lưu quán và dữ liệu, hãy đăng ký tài khoản.</span>
      <div className="flex gap-3">
        <button
          onClick={handleRegister}
          className="px-4 py-2 bg-white text-primary rounded-[12px] font-semibold hover:bg-gray-100 transition"
        >
          Đăng ký ngay
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1 text-sm opacity-80 hover:opacity-100 transition"
        >
          Đóng
        </button>
      </div>
    </div>
  )
}
