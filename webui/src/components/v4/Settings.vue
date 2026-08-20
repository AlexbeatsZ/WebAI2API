<script setup>
import { onMounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const server = ref({ port: 3000, authToken: '', queueBuffer: 2, imageLimit: 5, requestTimeoutMs: 120000, maxRetries: 2, imageMarkdown: false, keepaliveMode: 'comment', logLevel: 'info' });
const browser = ref({ path: '', headless: false, fission: true, humanizeCursor: true, cssInject: { animation: false, filter: false, font: false } });
const saving = ref(false);

async function load() {
  const [serverResponse, browserResponse] = await Promise.all([
    fetch('/admin/config/server', { headers: settings.getHeaders() }),
    fetch('/admin/config/browser', { headers: settings.getHeaders() })
  ]);
  if (serverResponse.ok) server.value = { ...server.value, ...await serverResponse.json() };
  if (browserResponse.ok) browser.value = { ...browser.value, ...await browserResponse.json() };
}

async function save() {
  saving.value = true;
  try {
    const responses = await Promise.all([
      fetch('/admin/config/server', { method: 'POST', headers: settings.getHeaders(), body: JSON.stringify(server.value) }),
      fetch('/admin/config/browser', { method: 'POST', headers: settings.getHeaders(), body: JSON.stringify(browser.value) })
    ]);
    for (const response of responses) {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message || `HTTP ${response.status}`);
      }
    }
    window.alert('设置已保存。重新启动服务后生效。');
  } catch (error) {
    window.alert(error.message);
  } finally {
    saving.value = false;
  }
}

async function restart() {
  if (!window.confirm('现在重新启动服务？正在处理的请求会中断。')) return;
  await fetch('/admin/restart', { method: 'POST', headers: settings.getHeaders(), body: '{}' });
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-intro">
      <div><span class="eyebrow">SETTINGS</span><h2>服务与浏览器</h2><p>常用安全和排队选项放在前面；影响指纹或资源占用的设置集中在浏览器部分。</p></div>
      <div class="actions"><button class="button ghost" @click="restart">重新启动</button><button class="button primary" :disabled="saving" @click="save">{{ saving ? '正在保存' : '保存设置' }}</button></div>
    </div>

    <div class="settings-stack">
      <section class="settings-section">
        <h3>访问与响应</h3><p>访问令牌同时保护 API 和管理界面。留空仅适合可信网络。</p>
        <div v-if="!server.authToken" class="inline-warning">当前任何能访问此地址的设备都可以调用服务。</div>
        <div class="field-grid">
          <div class="field"><label>端口</label><input v-model.number="server.port" type="number" min="1" max="65535" /></div>
          <div class="field"><label>访问令牌</label><input v-model="server.authToken" type="password" placeholder="留空则不验证" /></div>
          <div class="field"><label>流式心跳</label><select v-model="server.keepaliveMode"><option value="comment">SSE 注释</option><option value="content">空内容片段</option></select></div>
          <div class="field"><label>日志级别</label><select v-model="server.logLevel"><option value="debug">Debug</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select></div>
          <div class="field full"><div class="switch-row"><div><label>图片使用 Markdown</label><small>生成结果以图片链接形式写入 message.content。</small></div><button class="switch" aria-label="图片使用 Markdown" :aria-pressed="server.imageMarkdown" :class="{ on: server.imageMarkdown }" @click="server.imageMarkdown = !server.imageMarkdown"><i /></button></div></div>
        </div>
      </section>

      <section class="settings-section">
        <h3>排队与恢复</h3><p>实际同时运行的数量由健康并发页决定。</p>
        <div class="field-grid">
          <div class="field"><label>额外排队数</label><input v-model.number="server.queueBuffer" type="number" min="0" max="1000" /><small>设为 0 时不限制等待队列。</small></div>
          <div class="field"><label>图片上限</label><input v-model.number="server.imageLimit" type="number" min="1" max="10" /></div>
          <div class="field"><label>请求超时（毫秒）</label><input v-model.number="server.requestTimeoutMs" type="number" min="1000" step="1000" /></div>
          <div class="field"><label>跨页重试</label><input v-model.number="server.maxRetries" type="number" min="0" max="10" /></div>
        </div>
      </section>

      <section class="settings-section">
        <h3>浏览器行为</h3><p>这些选项会应用到全部浏览器连接。</p>
        <div class="field-grid">
          <div class="field full"><label>浏览器路径</label><input v-model="browser.path" placeholder="留空使用容器内置 Camoufox" /></div>
          <div class="field"><label>鼠标轨迹</label><select v-model="browser.humanizeCursor"><option :value="true">拟人轨迹</option><option value="camou">Camoufox 内置</option><option :value="false">原生点击</option></select></div>
          <div class="field"><div class="switch-row"><div><label>站点隔离</label><small>建议保持开启。</small></div><button class="switch" aria-label="站点隔离" :aria-pressed="browser.fission" :class="{ on: browser.fission }" @click="browser.fission = !browser.fission"><i /></button></div></div>
          <div class="field"><div class="switch-row"><div><label>无头运行</label><small>开启后无法使用实时浏览器。</small></div><button class="switch" aria-label="无头运行" :aria-pressed="browser.headless" :class="{ on: browser.headless }" @click="browser.headless = !browser.headless"><i /></button></div></div>
          <div class="field"><div class="switch-row"><div><label>减少网页动画</label><small>降低无 GPU 环境的持续占用。</small></div><button class="switch" aria-label="减少网页动画" :aria-pressed="browser.cssInject?.animation" :class="{ on: browser.cssInject?.animation }" @click="browser.cssInject.animation = !browser.cssInject.animation"><i /></button></div></div>
        </div>
      </section>
    </div>
  </div>
</template>
