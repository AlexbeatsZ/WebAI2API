<script setup>
import { computed, onMounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { SendOutlined, ReloadOutlined } from '@ant-design/icons-vue';

const settings = useSettingsStore();
const models = ref([]);
const modelId = ref('');
const prompt = ref('');
const reasoning = ref(true);
const attachments = ref([]);
const sending = ref(false);
const refreshingModels = ref(false);
const result = ref('');
const error = ref('');
const history = ref([]);
const statusLabels = { success: '成功', failed: '失败', pending: '处理中' };

const selectedModel = computed(() => models.value.find(model => model.id === modelId.value));
const supportsImages = computed(() => selectedModel.value?.capabilities?.input?.includes('image') ?? selectedModel.value?.image_policy !== 'forbidden');
const groupedModels = computed(() => {
  const groups = new Map();
  for (const model of models.value) {
    const site = model.owned_by || model.id.split('/')[0];
    if (!groups.has(site)) groups.set(site, []);
    groups.get(site).push(model);
  }
  return [...groups.entries()];
});
const availabilityLabels = { available: '可用', unavailable: '不可用', unknown: '待确认' };

async function load() {
  const [modelResponse, historyResponse] = await Promise.all([
    fetch('/v1/models', { headers: settings.getHeaders() }),
    fetch('/admin/history?page=1&pageSize=20', { headers: settings.getHeaders() })
  ]);
  if (modelResponse.ok) {
    const data = await modelResponse.json();
    models.value = data.data || [];
    if (!modelId.value && models.value.length) modelId.value = models.value[0].id;
  }
  if (historyResponse.ok) history.value = (await historyResponse.json()).items || [];
}

async function refreshModels() {
  refreshingModels.value = true;
  error.value = '';
  try {
    const siteIds = [...new Set(models.value.map(model => model.owned_by || model.id.split('/')[0]))];
    const responses = await Promise.all(siteIds.map(siteId => fetch(`/admin/sites/${encodeURIComponent(siteId)}/models/refresh`, {
      method: 'POST', headers: settings.getHeaders()
    })));
    const failed = responses.find(response => !response.ok);
    if (failed) {
      const data = await failed.json().catch(() => ({}));
      throw new Error(data.error?.message || `模型发现失败: HTTP ${failed.status}`);
    }
    await load();
  } catch (refreshError) {
    error.value = refreshError.message;
  } finally {
    refreshingModels.value = false;
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pickFiles(event) {
  attachments.value = [];
  for (const file of [...event.target.files].slice(0, 5)) {
    attachments.value.push({ name: file.name, data: await readFile(file) });
  }
}

async function send() {
  if (!modelId.value || !prompt.value.trim()) return;
  sending.value = true;
  result.value = '';
  error.value = '';
  try {
    const content = attachments.value.length
      ? [{ type: 'text', text: prompt.value }, ...attachments.value.map(file => ({ type: 'image_url', image_url: { url: file.data } }))]
      : prompt.value;
    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: settings.getHeaders(),
      body: JSON.stringify({ model: modelId.value, messages: [{ role: 'user', content }], reasoning: reasoning.value, stream: false })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
    const message = data.choices?.[0]?.message || {};
    result.value = [message.reasoning_content ? `Reasoning\n${message.reasoning_content}` : '', message.content || ''].filter(Boolean).join('\n\n');
    await load();
  } catch (requestError) {
    error.value = requestError.message;
  } finally {
    sending.value = false;
  }
}

function formatDuration(value) {
  return value ? `${(value / 1000).toFixed(1)}s` : '—';
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-intro">
      <div><span class="eyebrow">REQUESTS</span><h2>发送请求并查看结果</h2><p>模型按网站组织。模型 ID 与 API 使用的值完全一致，不再显示重复别名。</p></div>
      <div class="actions"><button class="button ghost" @click="load"><ReloadOutlined />刷新列表</button><button class="button" :disabled="refreshingModels || !models.length" @click="refreshModels">{{ refreshingModels ? '正在发现' : '重新发现模型' }}</button></div>
    </div>

    <div class="split-grid">
      <section class="panel">
        <header class="panel-header"><div><h3>新请求</h3><p>POST /v1/chat/completions</p></div><div v-if="selectedModel" class="actions"><span class="status-pill">{{ selectedModel.owned_by }}</span><span class="status-pill" :class="selectedModel.availability === 'available' ? 'online' : selectedModel.availability === 'unavailable' ? 'offline' : ''">{{ availabilityLabels[selectedModel.availability] || selectedModel.availability }}</span></div></header>
        <div class="panel-body request-composer">
          <div class="field"><label>模型</label><select v-model="modelId"><optgroup v-for="[site, siteModels] in groupedModels" :key="site" :label="site"><option v-for="model in siteModels" :key="model.id" :value="model.id">{{ model.id }}</option></optgroup></select></div>
          <div v-if="selectedModel" class="slot-track"><span v-for="input in selectedModel.capabilities?.input || []" :key="input" class="slot idle">输入 {{ input }}</span><span v-for="output in selectedModel.capabilities?.output || []" :key="output" class="slot">输出 {{ output }}</span></div>
          <div class="field"><label>提示词</label><textarea v-model="prompt" placeholder="输入要发送的内容" /></div>
          <label v-if="supportsImages" class="drop-zone">附加图片（最多 5 张）<input type="file" accept="image/*" multiple style="display:block;margin-top:10px" @change="pickFiles" /><small v-if="attachments.length">{{ attachments.map(file => file.name).join(' · ') }}</small></label>
          <div class="switch-row"><div><strong style="font-size:12px">返回推理内容</strong><small style="display:block;color:var(--faint);margin-top:3px">仅在网页实际提供时返回。</small></div><button class="switch" aria-label="返回推理内容" :aria-pressed="reasoning" :class="{ on: reasoning }" @click="reasoning = !reasoning"><i /></button></div>
          <button class="button primary" :disabled="sending || !modelId || !prompt.trim()" @click="send"><SendOutlined />{{ sending ? '正在等待网页' : '发送请求' }}</button>
          <div v-if="error" class="inline-warning" style="color:var(--danger);background:var(--danger-soft)">{{ error }}</div>
          <pre v-if="result" class="result-box">{{ result }}</pre>
        </div>
      </section>

      <section class="panel">
        <header class="panel-header"><div><h3>最近请求</h3><p>{{ history.length }} 条记录</p></div></header>
        <div v-if="!history.length" class="empty-state">还没有请求记录</div>
        <div v-else class="table-scroll">
          <table class="data-table"><thead><tr><th>模型</th><th>状态</th><th>耗时</th></tr></thead><tbody><tr v-for="record in history" :key="record.id"><td><span class="model-id">{{ record.modelId || record.model }}</span></td><td><span class="status-pill" :class="record.status === 'success' ? 'online' : record.status === 'failed' ? 'offline' : ''">{{ statusLabels[record.status] || record.status }}</span></td><td>{{ formatDuration(record.durationMs) }}</td></tr></tbody></table>
        </div>
      </section>
    </div>
  </div>
</template>
