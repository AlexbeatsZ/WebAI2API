<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { ApiOutlined, ReloadOutlined } from '@ant-design/icons-vue';

const settings = useSettingsStore();
const status = ref({ runtime: { profiles: [], slots: [], capacity: { healthy: 0, idle: 0, running: 0, total: 0 } } });
const stats = ref({ success: 0, failed: 0 });
const loading = ref(false);
let timer;

const capacity = computed(() => status.value.runtime?.capacity || { healthy: 0, idle: 0, running: 0, total: 0 });
const profiles = computed(() => status.value.runtime?.profiles || []);
const queue = computed(() => status.value.queue || { processing: capacity.value.running, queueLength: 0 });
const successRate = computed(() => {
  const total = (stats.value.success || 0) + (stats.value.failed || 0);
  return total ? `${Math.round(stats.value.success / total * 100)}%` : '—';
});
const stateLabels = { online: '正常', degraded: '部分异常', offline: '离线', starting: '启动中', stopping: '停止中' };

function siteSlots(profile, siteId) {
  return (profile.slots || []).filter(slot => slot.siteId === siteId);
}

async function load() {
  loading.value = true;
  try {
    const [statusResponse, statsResponse] = await Promise.all([
      fetch('/admin/status', { headers: settings.getHeaders() }),
      fetch('/admin/stats', { headers: settings.getHeaders() })
    ]);
    if (statusResponse.ok) status.value = await statusResponse.json();
    if (statsResponse.ok) stats.value = await statsResponse.json();
  } finally {
    loading.value = false;
  }
}

async function restart(profileId) {
  await fetch(`/admin/runtime/profiles/${encodeURIComponent(profileId)}/restart`, {
    method: 'POST', headers: settings.getHeaders()
  });
  await load();
}

function duration(seconds = 0) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

onMounted(() => {
  load();
  timer = setInterval(load, 5000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div>
    <div class="page-intro">
      <div>
        <span class="eyebrow">LIVE CAPACITY</span>
        <h2>浏览器正在处理什么</h2>
        <p>每个方块是一张可独立接单的网页。连接、网站和并发页之间的关系直接显示在这里。</p>
      </div>
      <button class="button ghost" :disabled="loading" @click="load"><ReloadOutlined />刷新</button>
    </div>

    <div class="metric-grid">
      <article class="metric"><span>健康容量</span><strong class="healthy">{{ capacity.healthy }}/{{ capacity.total }}</strong><small>{{ capacity.idle }} 个空闲页</small></article>
      <article class="metric"><span>正在运行</span><strong :class="capacity.running ? 'warning' : ''">{{ capacity.running }}</strong><small>{{ queue.queueLength || 0 }} 个请求等待</small></article>
      <article class="metric"><span>今日成功率</span><strong>{{ successRate }}</strong><small>{{ stats.success || 0 }} 成功 · {{ stats.failed || 0 }} 失败</small></article>
      <article class="metric"><span>运行时间</span><strong>{{ duration(status.uptime) }}</strong><small>WebAI2API v{{ status.version || '4.0.0' }}</small></article>
    </div>

    <section class="panel">
      <header class="panel-header">
        <div><h3>运行拓扑</h3><p>浏览器连接 → 网站 → 并发页</p></div>
        <span class="status-pill" :class="status.safeMode?.enabled ? 'offline' : 'online'">{{ status.safeMode?.enabled ? '维护中' : '运行中' }}</span>
      </header>
      <div class="panel-body">
        <div v-if="!profiles.length" class="empty-state">尚未启动浏览器连接</div>
        <div v-else class="topology-list">
          <article v-for="profile in profiles" :key="profile.id" class="profile-node">
            <header class="profile-head">
              <div class="profile-title">
                <span class="node-icon"><ApiOutlined /></span>
                <div><strong>{{ profile.name }}</strong><small>{{ profile.id }} · {{ profile.display?.display || '无远程画面' }}</small></div>
              </div>
              <div class="actions">
                <span class="status-pill" :class="profile.state">{{ stateLabels[profile.state] || profile.state }}</span>
                <button v-if="profile.state !== 'online'" class="button ghost" @click="restart(profile.id)">重新启动</button>
              </div>
            </header>
            <div class="site-rows">
              <div v-for="site in profile.sites" :key="site.id" class="site-row">
                <span class="site-name">{{ site.id }}</span>
                <div class="slot-track">
                  <span v-for="slot in siteSlots(profile, site.id)" :key="slot.id" class="slot" :class="slot.state" :title="slot.lastError || slot.id">{{ slot.index }}</span>
                </div>
                <span class="status-pill">{{ siteSlots(profile, site.id).filter(slot => slot.state === 'idle').length }}/{{ site.pages }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>
