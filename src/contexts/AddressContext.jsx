import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { fetchAddresses, createAddress as apiCreateAddress, updateAddress as apiUpdateAddress, deleteAddress as apiDeleteAddress, upsertSession, updateAddressIngredientSort as apiUpdateAddressIngredientSort } from '../services/authService'
import { getDemoAddress, setGuestIngredientSortOrder } from '../services/localRepository'
import { STORAGE_KEYS } from '../constants/storageKeys'
import { Outlet } from 'react-router-dom'

const AddressContext = createContext(null)

export function useAddress() {
    const ctx = useContext(AddressContext)
    if (!ctx) throw new Error('useAddress must be used within AddressProvider')
    return ctx
}

// Normalize a name for duplicate detection (trim + collapse spaces + lowercase)
const normalizeName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()

export function AddressProvider() {
    const { profile, isGuest } = useAuth()
    const [addresses, setAddresses] = useState([])
    const [selectedAddress, setSelectedAddressState] = useState(null)
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)

    // Load addresses when profile is available
    useEffect(() => {
        if (isGuest) {
            const demo = getDemoAddress()
            setAddresses([demo])
            setSelectedAddressState(demo)
            setLoading(false)
            return
        }

        if (!profile?.id) {
            setAddresses([])
            setLoading(false)
            return
        }

        let addressOwnerId = null
        if (profile.role === 'admin') {
            addressOwnerId = 'ALL'
        } else if (profile.role === 'manager') {
            // co-manager has manager_id pointing to the main manager
            addressOwnerId = profile.manager_id || profile.id
        } else {
            addressOwnerId = profile.manager_id
        }

        if (!addressOwnerId && profile.role !== 'admin') {
            setLoading(false)
            return
        }

        if (addresses.length === 0) setLoading(true)
        setFetchError(null)
        fetchAddresses(addressOwnerId).then(({ data, error }) => {
            if (error) {
                setFetchError(error.message || 'Không tải được danh sách địa chỉ')
                setLoading(false)
                return
            }
            const addrs = data || []
            setAddresses(addrs)

            // Restore previously selected address from localStorage
            const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_ADDRESS)
            const saved = addrs.find(a => a.id === savedId)
            if (saved) {
                setSelectedAddressState(saved)
            } else if (addrs.length === 1) {
                // Auto-select if only one address
                setSelectedAddressState(addrs[0])
                localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS, addrs[0].id)
            }

            setLoading(false)
        })
    }, [profile])

    const setSelectedAddress = useCallback((addr) => {
        setSelectedAddressState(addr)
        if (addr) {
            localStorage.setItem(STORAGE_KEYS.SELECTED_ADDRESS, addr.id)
            if (profile?.id) {
                upsertSession(profile.id, addr.id)
                localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, profile.id)
            }
        } else {
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
            localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER_ID)
        }
    }, [profile])

    const createNewAddress = useCallback(async (name) => {
        if (isGuest) throw new Error('Vui lòng đăng ký tài khoản để tạo quán mới!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể tạo địa chỉ')
        const cleanName = (name || '').trim().replace(/\s+/g, ' ')
        if (!cleanName) throw new Error('Tên địa chỉ không được để trống')
        const norm = normalizeName(cleanName)
        if (addresses.some(a => normalizeName(a.name) === norm)) {
            throw new Error(`Địa chỉ "${cleanName}" đã tồn tại`)
        }
        // co-manager creates under main manager's id
        const ownerId = profile.manager_id || profile.id
        const newAddr = await apiCreateAddress(ownerId, cleanName)
        setAddresses(prev => [...prev, newAddr])
        return newAddr
    }, [profile, addresses])

    const renameAddress = useCallback(async (addressId, newName) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể sửa địa chỉ')
        const cleanName = (newName || '').trim().replace(/\s+/g, ' ')
        if (!cleanName) throw new Error('Tên địa chỉ không được để trống')
        const norm = normalizeName(cleanName)
        if (addresses.some(a => a.id !== addressId && normalizeName(a.name) === norm)) {
            throw new Error(`Địa chỉ "${cleanName}" đã tồn tại`)
        }
        const updatedAddr = await apiUpdateAddress(addressId, cleanName)
        setAddresses(prev => prev.map(a => a.id === addressId ? updatedAddr : a))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(updatedAddr)
        }
        return updatedAddr
    }, [profile, selectedAddress, addresses])

    const removeAddress = useCallback(async (addressId) => {
        if (isGuest) throw new Error('Tính năng này chỉ dành cho tài khoản chính thức!')
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có thể xóa địa chỉ')
        await apiDeleteAddress(addressId)
        setAddresses(prev => prev.filter(a => a.id !== addressId))
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(null)
            localStorage.removeItem(STORAGE_KEYS.SELECTED_ADDRESS)
        }
    }, [profile, selectedAddress])

    const updateSortOrder = useCallback(async (addressId, sortOrderArray) => {
        if (!profile?.id || (profile.role !== 'manager' && profile.role !== 'admin')) throw new Error('Chỉ quản lý mới có quyền')
        if (isGuest) {
            // Persist in localStorage so the order survives reloads — getDemoAddress() reads it back.
            setGuestIngredientSortOrder(sortOrderArray)
        } else {
            // addressId=null routes to app_settings (default template); else updates the address row.
            await apiUpdateAddressIngredientSort(addressId, sortOrderArray)
        }
        if (addressId) {
            setAddresses(prev => prev.map(a => a.id === addressId ? { ...a, ingredient_sort_order: sortOrderArray } : a))
        }
        if (selectedAddress?.id === addressId) {
            setSelectedAddressState(prev => ({ ...prev, ingredient_sort_order: sortOrderArray }))
        }
    }, [profile, selectedAddress, isGuest])

    return (
        <AddressContext.Provider value={{
            addresses,
            selectedAddress,
            setSelectedAddress,
            createNewAddress,
            renameAddress,
            removeAddress,
            updateSortOrder,
            loading,
            fetchError
        }}>
            <Outlet />
        </AddressContext.Provider>
    )
}
