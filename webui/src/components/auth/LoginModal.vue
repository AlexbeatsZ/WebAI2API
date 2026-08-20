<script setup>
import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';

defineProps({ visible: { type: Boolean, required: true } });
const emit = defineEmits(['update:visible', 'success']);
const settings = useSettingsStore();
const token = ref(settings.token);
const loading = ref(false);
const error = ref('');

async function submit() {
  if (!token.value) return;
  loading.value = true;
  error.value = '';
  const previous = settings.token;
  settings.setToken(token.value);
  if (await settings.checkAuth()) {
    emit('success');
    emit('update:visible', false);
  } else {
    settings.setToken(previous);
    error.value = '访问令牌无效';
  }
  loading.value = false;
}
</script>

<template>
  <div v-if="visible" class="modal-scrim">
    <section class="modal-card" style="max-width:420px" role="dialog" aria-modal="true" aria-label="访问服务">
      <header><div><span class="eyebrow">ACCESS</span><h2 style="margin:4px 0 0">连接 WebAI2API</h2></div></header>
      <div class="modal-content">
        <p style="margin:0 0 17px;color:var(--muted);line-height:1.6">输入此服务配置的访问令牌。</p>
        <div class="field"><label>访问令牌</label><input v-model="token" type="password" autofocus placeholder="sk-…" @keyup.enter="submit" /></div>
        <div v-if="error" class="inline-warning" style="color:var(--danger);background:var(--danger-soft)">{{ error }}</div>
      </div>
      <footer class="modal-actions"><button class="button primary" :disabled="loading || !token" @click="submit">{{ loading ? '正在验证' : '继续' }}</button></footer>
    </section>
  </div>
</template>
