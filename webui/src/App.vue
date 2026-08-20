<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import LoginModal from '@/components/auth/LoginModal.vue';
import {
  AppstoreOutlined,
  ApiOutlined,
  SendOutlined,
  DesktopOutlined,
  SettingOutlined,
  MenuOutlined,
  CloseOutlined,
  BugOutlined,
  LogoutOutlined
} from '@ant-design/icons-vue';

const router = useRouter();
const route = useRoute();
const settings = useSettingsStore();
const ready = ref(false);
const loginVisible = ref(false);
const mobileNav = ref(false);
const diagnosticsOpen = ref(false);
const logs = ref([]);
const diagnosticsLoading = ref(false);

const navigation = [
  { path: '/', label: '概览', icon: AppstoreOutlined },
  { path: '/connections', label: '连接', icon: ApiOutlined },
  { path: '/requests', label: '请求', icon: SendOutlined },
  { path: '/browser', label: '实时浏览器', icon: DesktopOutlined },
  { path: '/settings', label: '设置', icon: SettingOutlined }
];

const currentTitle = computed(() => navigation.find(item => item.path === route.path)?.label || 'WebAI2API');

function navigate(path) {
  router.push(path);
  mobileNav.value = false;
}

async function authenticate() {
  await settings.fetchAuthStatus();
  if (!settings.authEnabled) {
    loginVisible.value = false;
    ready.value = true;
    return;
  }
  const valid = settings.token && await settings.checkAuth();
  loginVisible.value = !valid;
  ready.value = true;
}

async function openDiagnostics() {
  diagnosticsOpen.value = true;
  diagnosticsLoading.value = true;
  try {
    const response = await fetch('/admin/logs?lines=240', { headers: settings.getHeaders() });
    const data = response.ok ? await response.json() : {};
    logs.value = data.logs || data.lines || [];
  } finally {
    diagnosticsLoading.value = false;
  }
}

function signOut() {
  settings.setToken('');
  loginVisible.value = true;
}

function escapeHandler(event) {
  if (event.key === 'Escape') {
    mobileNav.value = false;
    diagnosticsOpen.value = false;
  }
}

onMounted(() => {
  authenticate();
  window.addEventListener('keydown', escapeHandler);
});
onUnmounted(() => window.removeEventListener('keydown', escapeHandler));
</script>

<template>
  <div v-if="!ready" class="boot-screen">
    <div class="boot-mark">W4</div>
    <span>正在连接服务</span>
  </div>

  <template v-else>
    <LoginModal v-model:visible="loginVisible" @success="authenticate" />
    <div class="app-shell">
      <aside class="sidebar" :class="{ open: mobileNav }">
        <div class="brand-block">
          <div class="brand-mark">W4</div>
          <div>
            <strong>WebAI2API</strong>
            <span>Browser operations</span>
          </div>
          <button class="icon-button mobile-only" aria-label="关闭导航" @click="mobileNav = false"><CloseOutlined /></button>
        </div>

        <nav class="primary-nav" aria-label="主导航">
          <button v-for="item in navigation" :key="item.path" :class="{ active: route.path === item.path }" @click="navigate(item.path)">
            <component :is="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <div class="sidebar-footer">
          <button class="quiet-button" @click="openDiagnostics"><BugOutlined />诊断</button>
          <button v-if="settings.authEnabled" class="quiet-button" @click="signOut"><LogoutOutlined />退出</button>
          <div class="version-note">v4.0.0</div>
        </div>
      </aside>

      <div v-if="mobileNav" class="nav-scrim" @click="mobileNav = false" />

      <main class="main-stage">
        <header class="topbar">
          <button class="icon-button mobile-only" aria-label="打开导航" @click="mobileNav = true"><MenuOutlined /></button>
          <div>
            <span class="eyebrow">OPERATIONS</span>
            <h1>{{ currentTitle }}</h1>
          </div>
          <div class="topbar-actions">
            <span class="service-dot"><i />服务已连接</span>
            <button class="icon-button" aria-label="打开诊断" @click="openDiagnostics"><BugOutlined /></button>
          </div>
        </header>

        <div v-if="!settings.authEnabled" class="security-banner" role="status">
          <span>未设置访问令牌</span>
          <small>仅在可信网络中开放此服务。</small>
        </div>

        <section class="route-stage"><router-view /></section>
      </main>
    </div>

    <div v-if="diagnosticsOpen" class="drawer-scrim" @click.self="diagnosticsOpen = false">
      <aside class="diagnostics-drawer" aria-label="诊断">
        <header>
          <div><span class="eyebrow">DIAGNOSTICS</span><h2>最近日志</h2></div>
          <button class="icon-button" aria-label="关闭诊断" @click="diagnosticsOpen = false"><CloseOutlined /></button>
        </header>
        <div v-if="diagnosticsLoading" class="empty-state">正在读取日志</div>
        <pre v-else class="log-stream">{{ Array.isArray(logs) ? logs.join('\n') : logs }}</pre>
      </aside>
    </div>
  </template>
</template>
