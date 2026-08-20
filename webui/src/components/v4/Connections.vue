<script setup>
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { PlusOutlined, EditOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons-vue';

const settings = useSettingsStore();
const profiles = ref([]);
const availableSites = ref([]);
const editorOpen = ref(false);
const editingIndex = ref(-1);
const saving = ref(false);
const form = ref(null);
const siteToAdd = ref('');

const siteNames = computed(() => Object.fromEntries(availableSites.value.map(site => [site.id, site.name])));
const addableSites = computed(() => availableSites.value.filter(site => !form.value?.sites?.some(item => item.id === site.id)));
const clone = value => JSON.parse(JSON.stringify(value));

function freshProfile() {
  const suffix = profiles.value.length + 1;
  return {
    id: `browser-${suffix}`,
    name: `Browser ${suffix}`,
    userDataDir: suffix === 1 ? 'camoufoxUserData' : `camoufoxUserData_${suffix}`,
    proxy: { enabled: false, type: 'http', host: 'host.docker.internal', port: 7897 },
    sites: []
  };
}

async function load() {
  const [profileResponse, siteResponse] = await Promise.all([
    fetch('/admin/profiles', { headers: settings.getHeaders() }),
    fetch('/admin/sites', { headers: settings.getHeaders() })
  ]);
  if (profileResponse.ok) profiles.value = await profileResponse.json();
  if (siteResponse.ok) availableSites.value = await siteResponse.json();
}

function openCreate() {
  editingIndex.value = -1;
  form.value = freshProfile();
  siteToAdd.value = '';
  editorOpen.value = true;
}

function openEdit(profile, index) {
  editingIndex.value = index;
  form.value = clone(profile);
  form.value.proxy ||= { enabled: false, type: 'http', host: '', port: 7897 };
  siteToAdd.value = '';
  editorOpen.value = true;
}

function addSite() {
  if (!siteToAdd.value) return;
  form.value.sites.push({ id: siteToAdd.value, pages: 1 });
  siteToAdd.value = '';
}

function removeSite(index) {
  form.value.sites.splice(index, 1);
}

function deleteProfile(index) {
  const profile = profiles.value[index];
  if (!window.confirm(`移除“${profile.name}”？登录数据不会被删除。`)) return;
  profiles.value.splice(index, 1);
}

function acceptEditor() {
  if (!form.value.name || !form.value.id || !form.value.userDataDir || !form.value.sites.length) return;
  if (editingIndex.value === -1) profiles.value.push(clone(form.value));
  else profiles.value[editingIndex.value] = clone(form.value);
  editorOpen.value = false;
}

async function saveAll() {
  saving.value = true;
  try {
    const response = await fetch('/admin/profiles', {
      method: 'PUT', headers: settings.getHeaders(), body: JSON.stringify(profiles.value)
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || `HTTP ${response.status}`);
    }
    window.alert('连接设置已保存。重新启动服务后生效。');
  } catch (error) {
    window.alert(error.message);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-intro">
      <div>
        <span class="eyebrow">BROWSER CONNECTIONS</span>
        <h2>账号与网站连接</h2>
        <p>一个连接保存一套登录状态、代理和浏览器进程。增加并发页可以并行处理；增加连接可以隔离账号或网络。</p>
      </div>
      <div class="actions"><button class="button" @click="openCreate"><PlusOutlined />添加连接</button><button class="button primary" :disabled="saving || !profiles.length" @click="saveAll">保存更改</button></div>
    </div>

    <div v-if="!profiles.length" class="panel"><div class="empty-state">没有连接。添加一个浏览器连接后即可选择网站。</div></div>
    <div v-else class="connection-grid">
      <article v-for="(profile, index) in profiles" :key="profile.id" class="connection-card">
        <header>
          <div class="profile-title"><span class="node-icon"><ApiOutlined /></span><div><h3>{{ profile.name }}</h3><div class="meta">{{ profile.id }} · {{ profile.proxy?.enabled ? `${profile.proxy.type}://${profile.proxy.host}:${profile.proxy.port}` : '直接连接' }}</div></div></div>
          <div class="actions"><button class="icon-button" aria-label="编辑连接" @click="openEdit(profile, index)"><EditOutlined /></button><button class="icon-button" aria-label="移除连接" @click="deleteProfile(index)"><DeleteOutlined /></button></div>
        </header>
        <div class="connection-sites">
          <div v-for="site in profile.sites" :key="site.id" class="connection-site"><span>{{ siteNames[site.id] || site.id }}</span><small>{{ site.pages }} 个并发页</small></div>
        </div>
      </article>
    </div>

    <div v-if="editorOpen" class="modal-scrim" @click.self="editorOpen = false" @keydown.esc="editorOpen = false">
      <section class="modal-card" role="dialog" aria-modal="true" aria-label="连接设置">
        <header><h2>{{ editingIndex === -1 ? '添加连接' : '编辑连接' }}</h2><button class="icon-button" aria-label="关闭" @click="editorOpen = false">×</button></header>
        <div class="modal-content">
          <div class="field-grid">
            <div class="field"><label>名称</label><input v-model="form.name" placeholder="Google" autofocus /></div>
            <div class="field"><label>连接 ID</label><input v-model="form.id" placeholder="google-main" pattern="[a-z0-9-]+" /><small>小写字母、数字和连字符</small></div>
            <div class="field full"><label>登录数据</label><input v-model="form.userDataDir" placeholder="camoufoxUserData_Google" /><small>每个连接必须使用不同目录；移除连接不会删除这里的数据。</small></div>
            <div class="field full"><div class="switch-row"><div><label>使用代理</label><small>该连接中的全部网站共用此代理。</small></div><button class="switch" aria-label="使用代理" :aria-pressed="form.proxy.enabled" :class="{ on: form.proxy.enabled }" @click="form.proxy.enabled = !form.proxy.enabled"><i /></button></div></div>
            <template v-if="form.proxy.enabled">
              <div class="field"><label>类型</label><select v-model="form.proxy.type"><option value="http">HTTP</option><option value="socks5">SOCKS5</option></select></div>
              <div class="field"><label>端口</label><input v-model.number="form.proxy.port" type="number" min="1" max="65535" /></div>
              <div class="field full"><label>主机</label><input v-model="form.proxy.host" placeholder="host.docker.internal" /></div>
            </template>
            <div class="field full">
              <label>网站与并发页</label>
              <div v-for="(site, siteIndex) in form.sites" :key="site.id" class="connection-site">
                <span>{{ siteNames[site.id] || site.id }}</span>
                <div class="actions"><input v-model.number="site.pages" aria-label="并发页" type="number" min="1" max="16" style="width:76px;min-height:34px;padding:5px 8px" /><button class="button danger" @click="removeSite(siteIndex)">移除</button></div>
              </div>
              <div class="actions" style="margin-top:9px"><select v-model="siteToAdd" class="select-control" style="flex:1"><option value="">选择网站</option><option v-for="site in addableSites" :key="site.id" :value="site.id">{{ site.name }}</option></select><button class="button" :disabled="!siteToAdd" @click="addSite">添加网站</button></div>
            </div>
          </div>
        </div>
        <footer class="modal-actions"><button class="button ghost" @click="editorOpen = false">取消</button><button class="button primary" :disabled="!form.name || !form.id || !form.sites.length" @click="acceptEditor">完成</button></footer>
      </section>
    </div>
  </div>
</template>
