<template>
  <div v-if="result" class="conn-result" :class="result.success ? 'ok' : 'bad'">
    <div class="conn-summary">
      <i :class="result.success ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'"></i>
      <span>{{ result.success ? 'Connection OK' : 'Issues found' }}</span>
    </div>
    <ul class="conn-checks">
      <li v-for="check in result.checks" :key="check.id">
        <span class="dot" :class="check.ok ? 'dot-ok' : 'dot-bad'"></span>
        <span class="check-label">{{ check.label }}:</span>
        <span class="check-msg" :class="{ 'msg-bad': !check.ok }">{{ check.message }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { LtiConnectionTestResult } from '../api';

defineProps<{ result?: LtiConnectionTestResult }>();
</script>

<style scoped>
.conn-result {
  margin-top: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 12px;
  background: #f8fafc;
}
.conn-result.ok { border-color: #bbf7d0; background: #f0fdf4; }
.conn-result.bad { border-color: #fecdd3; background: #fff1f2; }
.conn-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 8px;
}
.conn-result.ok .conn-summary { color: #166534; }
.conn-result.bad .conn-summary { color: #9f1239; }
.conn-checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.conn-checks li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: #475569;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: 0 0 auto;
  transform: translateY(1px);
}
.dot-ok { background: #22c55e; }
.dot-bad { background: #ef4444; }
.check-label { font-weight: 700; color: #334155; }
.msg-bad { color: #9f1239; }
</style>
