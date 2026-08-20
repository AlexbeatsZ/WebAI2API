<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { DesktopOutlined, DisconnectOutlined, ExpandOutlined, ReloadOutlined } from '@ant-design/icons-vue';

const settings = useSettingsStore();
const runtime = ref({ profiles: [] });
const profileId = ref('');
const vncStatus = ref(null);
const connectionState = ref('disconnected');
const error = ref('');
const container = ref(null);
let rfb = null;
let RFB = null;

const profiles = computed(() => runtime.value.profiles || []);
const selectedProfile = computed(() => profiles.value.find(profile => profile.id === profileId.value));
const stateLabels = { online: '正常', degraded: '部分异常', offline: '离线', starting: '启动中', stopping: '停止中' };

async function load() {
  const response = await fetch('/admin/runtime/slots', { headers: settings.getHeaders() });
  if (response.ok) runtime.value = await response.json();
  if (!profileId.value && profiles.value.length) profileId.value = profiles.value[0].id;
  if (profileId.value) await loadVncStatus();
}

async function loadVncStatus() {
  disconnect();
  if (!profileId.value) return;
  const response = await fetch(`/admin/profiles/${encodeURIComponent(profileId.value)}/vnc/status`, { headers: settings.getHeaders() });
  vncStatus.value = response.ok ? await response.json() : { enabled: false };
}

async function connect() {
  if (!vncStatus.value?.enabled || !container.value) return;
  connectionState.value = 'connecting';
  error.value = '';
  try {
    if (!RFB) RFB = (await import('@novnc/novnc/core/rfb.js')).default;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/admin/profiles/${encodeURIComponent(profileId.value)}/vnc?token=${encodeURIComponent(settings.token || '')}`;
    rfb = new RFB(container.value, url, { wsProtocols: ['binary'] });
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.resizeSession = false;
    rfb.viewOnly = false;
    rfb.addEventListener('connect', () => { connectionState.value = 'connected'; });
    rfb.addEventListener('disconnect', event => {
      connectionState.value = 'disconnected';
      if (!event.detail.clean) error.value = '远程画面连接中断';
      rfb = null;
    });
    rfb.addEventListener('credentialsrequired', () => rfb.sendCredentials({ password: '' }));
  } catch (connectError) {
    connectionState.value = 'error';
    error.value = connectError.message;
  }
}

function disconnect() {
  if (rfb) rfb.disconnect();
  rfb = null;
  connectionState.value = 'disconnected';
}

async function restart() {
  disconnect();
  await fetch(`/admin/runtime/profiles/${encodeURIComponent(profileId.value)}/restart`, { method: 'POST', headers: settings.getHeaders() });
  await load();
}

function fullscreen() {
  container.value?.requestFullscreen();
}

watch(profileId, loadVncStatus);
onMounted(load);
onUnmounted(disconnect);
</script>

<template>
  <div>
    <div class="page-intro">
      <div><span class="eyebrow">LIVE BROWSER</span><h2>登录与维护</h2><p>每个连接都有自己的远程画面。这里的鼠标和窗口只属于所选浏览器，不会与其他连接混在同一桌面。</p></div>
      <button class="button ghost" @click="load"><ReloadOutlined />刷新</button>
    </div>

    <section class="panel">
      <div class="panel-body">
        <div class="browser-toolbar">
          <div class="field"><label>浏览器连接</label><select v-model="profileId"><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} · {{ stateLabels[profile.state] || profile.state }}</option></select></div>
          <div class="actions"><button v-if="connectionState !== 'connected'" class="button primary" :disabled="!vncStatus?.enabled || connectionState === 'connecting'" @click="connect"><DesktopOutlined />{{ connectionState === 'connecting' ? '正在连接' : '打开画面' }}</button><button v-else class="button danger" @click="disconnect"><DisconnectOutlined />断开</button><button class="button" :disabled="connectionState !== 'connected'" @click="fullscreen"><ExpandOutlined />全屏</button><button class="button ghost" :disabled="!profileId" @click="restart">重启连接</button></div>
        </div>

        <div v-if="selectedProfile" class="slot-track" style="margin-bottom:12px"><span class="status-pill" :class="selectedProfile.state">{{ stateLabels[selectedProfile.state] || selectedProfile.state }}</span><span v-for="site in selectedProfile.sites" :key="site.id" class="slot">{{ site.id }} · {{ site.pages }}</span><span v-if="vncStatus?.display" class="slot idle">{{ vncStatus.display }}</span></div>
        <div ref="container" class="browser-stage">
          <div v-if="connectionState !== 'connected'" class="browser-placeholder"><DesktopOutlined /><template v-if="!profiles.length">没有可用的浏览器连接</template><template v-else-if="!vncStatus?.enabled">此连接没有远程画面</template><template v-else>打开画面后可完成登录或处理网页验证</template><div v-if="error" style="margin-top:10px;color:var(--danger)">{{ error }}</div></div>
        </div>
      </div>
    </section>
  </div>
</template>
