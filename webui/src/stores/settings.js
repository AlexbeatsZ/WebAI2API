import { defineStore } from 'pinia';

export const useSettingsStore = defineStore('settings', {
    state: () => ({
        token: localStorage.getItem('admin_token') || '',
        authEnabled: null
    }),

    actions: {
        setToken(token) {
            this.token = token;
            if (token) localStorage.setItem('admin_token', token);
            else localStorage.removeItem('admin_token');
        },

        getHeaders() {
            const headers = { 'Content-Type': 'application/json' };
            if (this.token) headers.Authorization = `Bearer ${this.token}`;
            return headers;
        },

        async fetchAuthStatus() {
            try {
                const response = await fetch('/admin/auth/status');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                this.authEnabled = data.enabled === true;
            } catch {
                this.authEnabled = true;
            }
            return this.authEnabled;
        },

        async checkAuth() {
            if (this.authEnabled === null) await this.fetchAuthStatus();
            if (!this.authEnabled) return true;
            try {
                const response = await fetch('/admin/status', { headers: this.getHeaders() });
                return response.ok;
            } catch {
                return false;
            }
        }
    }
});
